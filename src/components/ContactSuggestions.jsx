// Module 9: Contact Suggestions - ContactSuggestions Component

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';
import { callNetlifyFunction } from '../utils/apiClient';
import ContactCard from './ContactCard';
import LearningToast from './LearningToast';
import NavigationBar from './NavigationBar';
import QuotaDisplay from './QuotaDisplay';
import CreditBalance from './CreditBalance';
import UpgradeModal from './UpgradeModal';

export default function ContactSuggestions() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [currentContactIndex, setCurrentContactIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [userWeights, setUserWeights] = useState(null);
  const [excludedIds, setExcludedIds] = useState([]);

  // Quota tracking
  const [dailyQuota, setDailyQuota] = useState({ used: 0, limit: 5 });

  // Credit tracking (Module 15)
  const [userCredits, setUserCredits] = useState(0);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Toast state
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    initialize();
  }, []);

  const initialize = async () => {
    const user = auth.currentUser;
    if (!user) {
      setError('No authenticated user');
      setLoading(false);
      return;
    }

    try {
      // Load user data (including credits) - Module 15
      const userDocRef = doc(db, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        setUserCredits(userData.credits || 0);
      }

      // Load user weights
      const weightsPath = getPath.userWeightsCurrent(user.uid);
      const weightsRef = doc(db, weightsPath);
      const weightsDoc = await getDoc(weightsRef);

      let weights = null;
      if (weightsDoc.exists()) {
        weights = weightsDoc.data();
      }
      setUserWeights(weights);

      // Load first selected company
      const companiesPath = getPath.userCompanies(user.uid);
      const companiesQuery = query(collection(db, companiesPath));
      const companiesSnapshot = await getDocs(companiesQuery);

      if (companiesSnapshot.empty) {
        setError('No companies selected. Please select companies first.');
        setLoading(false);
        return;
      }

      const firstCompany = {
        ...companiesSnapshot.docs[0].data(),
        id: companiesSnapshot.docs[0].id
      };
      setSelectedCompany(firstCompany);

      // Load quota for this company
      await loadQuota(user.uid, firstCompany.apollo_company_id);

      // Fetch contacts for this company
      await fetchContacts(firstCompany.apollo_company_id, weights);

    } catch (err) {
      console.error('Error initializing:', err);
      setError(err.message || 'Failed to initialize');
    } finally {
      setLoading(false);
    }
  };

  const loadQuota = async (userId, companyId) => {
    try {
      // Load daily quota for this company
      const today = new Date().toISOString().split('T')[0];
      const quotaPath = `${getPath.userQuotas(userId)}/daily_enrichments`;
      const quotaRef = doc(db, quotaPath);
      const quotaDoc = await getDoc(quotaRef);

      if (quotaDoc.exists()) {
        const quotaData = quotaDoc.data();
        const companyQuota = quotaData[companyId] || {};
        const todayCount = companyQuota[today] || 0;

        setDailyQuota({ used: todayCount, limit: 5 });
      }
    } catch (err) {
      console.error('Error loading quota:', err);
    }
  };

  const fetchContacts = async (companyId, weights) => {
    try {
      const result = await callNetlifyFunction('apolloContactSuggest', {
        apollo_company_id: companyId,
        user_weights: weights,
        excludeIds: excludedIds
      });

      setContacts(result.contacts || []);
      setCurrentContactIndex(0);
    } catch (err) {
      console.error('Error fetching contacts:', err);
      throw err;
    }
  };

  const handleAccept = async () => {
    // Module 11 + Module 15: Accept Contact → Check Credits → Enrich → Learn
    const user = auth.currentUser;
    if (!user || !selectedCompany) return;

    // Module 15: Check if user has enough credits (10 credits per enrichment)
    if (userCredits < 10) {
      setShowUpgradeModal(true);
      return;
    }

    const currentContact = contacts[currentContactIndex];
    setProcessing(true);

    try {
      // Call apolloContactEnrich
      const result = await callNetlifyFunction('apolloContactEnrich', {
        apollo_person_id: currentContact.apollo_person_id,
        user_id: user.uid,
        company_id: selectedCompany.apollo_company_id,
        contact_data: currentContact
      });

      if (result.success) {
        // Update quota display
        if (result.daily_quota) {
          setDailyQuota(result.daily_quota);
        }

        // Module 15: Update credits if returned
        if (typeof result.creditsRemaining === 'number') {
          setUserCredits(result.creditsRemaining);
        }

        // Show learning toast
        setToastMessage('Barry updated your targeting preferences based on your action');
        setShowToast(true);

        // Move to next contact
        if (currentContactIndex < contacts.length - 1) {
          setCurrentContactIndex(currentContactIndex + 1);
        } else {
          alert('No more contacts to show. Great work!');
          navigate('/lead-review');
        }
      } else if (result.error === 'quota_exceeded') {
        // Show quota exceeded modal/message
        alert(`${result.message}\n\nUpgrade to increase your limits.`);
      } else {
        alert('Failed to enrich contact. Please try again.');
      }
    } catch (err) {
      console.error('Error accepting contact:', err);
      alert('An error occurred. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    // Module 12: Reject Contact → Learn
    const user = auth.currentUser;
    if (!user || !selectedCompany) return;

    const currentContact = contacts[currentContactIndex];
    setProcessing(true);

    try {
      // Log event to Firestore (using client SDK since no enrichment needed)
      const { doc: firestoreDoc, setDoc: firestoreSetDoc } = await import('firebase/firestore');

      const eventId = `event_${Date.now()}_reject`;
      const eventPath = getPath.userEvent(user.uid, eventId);
      const eventRef = firestoreDoc(db, eventPath);

      await firestoreSetDoc(eventRef, {
        event_id: eventId,
        action_type: 'reject_contact',
        apollo_person_id: currentContact.apollo_person_id,
        title: currentContact.title,
        company_name: currentContact.company_name,
        company_id: selectedCompany.apollo_company_id,
        industry: selectedCompany.industry || '',
        company_size: selectedCompany.size || '',
        timestamp: new Date().toISOString()
      });

      // Call learning engine
      await callNetlifyFunction('learningEngine', {
        user_id: user.uid,
        action_type: 'reject_contact',
        lead_data: {
          contact_id: currentContact.apollo_person_id
        }
      });

      // Show learning toast
      setToastMessage('Barry updated your targeting preferences based on your action');
      setShowToast(true);

      // Move to next contact
      if (currentContactIndex < contacts.length - 1) {
        setCurrentContactIndex(currentContactIndex + 1);
      } else {
        alert('No more contacts to show. Great work!');
        navigate('/lead-review');
      }
    } catch (err) {
      console.error('Error rejecting contact:', err);
      alert('An error occurred. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleRequestAlternates = async () => {
    if (!selectedCompany) return;

    setProcessing(true);
    try {
      // Add current contact to excluded list
      const currentContact = contacts[currentContactIndex];
      const newExcludedIds = [...excludedIds, currentContact.apollo_person_id];
      setExcludedIds(newExcludedIds);

      // Fetch new contacts excluding the ones already shown
      await fetchContacts(selectedCompany.apollo_company_id, userWeights);
    } catch (err) {
      console.error('Error requesting alternates:', err);
      alert('Failed to fetch alternate contacts');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-cyan-400 text-xl mb-4">Loading contacts...</div>
          <div className="animate-pulse text-gray-400">Please wait</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-400 text-xl mb-4">Error</div>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => navigate('/companies')}
            className="px-6 py-3 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors"
          >
            Go to Companies
          </button>
        </div>
      </div>
    );
  }

  const currentContact = contacts[currentContactIndex];

  return (
    <>
      {/* Module 15: Navigation Bar */}
      <NavigationBar />

      {/* Module 15: Upgrade Modal */}
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        currentCredits={userCredits}
      />

      <div className="min-h-screen bg-black text-white p-8">
        {/* Learning Toast */}
        {showToast && (
          <LearningToast
            message={toastMessage}
            onDismiss={() => setShowToast(false)}
          />
        )}

        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-cyan-400 mb-2">Scout</h1>
            <p className="text-gray-400">
              Finding the best contacts at {selectedCompany?.name}
            </p>
          </div>

          {/* Module 15: Credit and Quota Display */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <CreditBalance showDetails={false} size="medium" />
            <QuotaDisplay
              companyId={selectedCompany?.apollo_company_id}
              companyName={selectedCompany?.name}
            />
          </div>

        {/* Contact Card */}
        {contacts.length > 0 && currentContact ? (
          <div>
            <div className="mb-4 text-gray-400 text-sm">
              Contact {currentContactIndex + 1} of {contacts.length}
            </div>

            <ContactCard
              contact={currentContact}
              onAccept={handleAccept}
              onReject={handleReject}
              onRequestAlternates={handleRequestAlternates}
              isProcessing={processing}
            />
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg mb-4">No contacts available</p>
            <button
              onClick={() => navigate('/companies')}
              className="px-6 py-3 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Select More Companies
            </button>
          </div>
        )}
        </div>
      </div>
    </>
  );
}
