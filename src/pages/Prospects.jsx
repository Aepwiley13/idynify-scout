import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { collection, query, where, getDocs, updateDoc, doc, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import ProspectCard from '../components/ProspectCard';
import GenerateEmailModal from '../components/GenerateEmailModal';
import GenerateLinkedInModal from '../components/GenerateLinkedInModal';

export default function Prospects() {
  const navigate = useNavigate();
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, a, b, c
  const [statusFilter, setStatusFilter] = useState('all'); // all, new, contacted, replied, meeting
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showLinkedInModal, setShowLinkedInModal] = useState(false);
  const [icpData, setIcpData] = useState(null);

  useEffect(() => {
    loadProspectsAndICP();
  }, []);

  const loadProspectsAndICP = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Load ICP data for context
      const icpQuery = query(
        collection(db, 'icpData'),
        where('userId', '==', user.uid)
      );
      const icpSnapshot = await getDocs(icpQuery);
      if (!icpSnapshot.empty) {
        setIcpData(icpSnapshot.docs[0].data());
      }

      // Load accepted leads
      const leadsRef = collection(db, 'leads', user.uid, 'generatedLeads');
      const acceptedQuery = query(
        leadsRef,
        where('status', '==', 'accepted')
      );
      
      const snapshot = await getDocs(acceptedQuery);
      const loadedProspects = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Set defaults if fields don't exist
        priority: doc.data().priority || 'B',
        prospectStatus: doc.data().prospectStatus || 'new',
        notes: doc.data().notes || '',
        actions: doc.data().actions || []
      }));

      setProspects(loadedProspects);
      setLoading(false);
    } catch (error) {
      console.error('Error loading prospects:', error);
      setLoading(false);
    }
  };

  const updateProspect = async (prospectId, updates) => {
    try {
      const user = auth.currentUser;
      const prospectRef = doc(db, 'leads', user.uid, 'generatedLeads', prospectId);
      await updateDoc(prospectRef, {
        ...updates,
        updatedAt: serverTimestamp()
      });

      // Update local state
      setProspects(prospects.map(p => 
        p.id === prospectId ? { ...p, ...updates } : p
      ));
    } catch (error) {
      console.error('Error updating prospect:', error);
    }
  };

  const addAction = async (prospectId, actionType, actionData) => {
    try {
      const user = auth.currentUser;
      const prospectRef = doc(db, 'leads', user.uid, 'generatedLeads', prospectId);
      
      const newAction = {
        type: actionType,
        timestamp: new Date().toISOString(),
        ...actionData
      };

      const prospect = prospects.find(p => p.id === prospectId);
      const updatedActions = [...(prospect.actions || []), newAction];

      await updateDoc(prospectRef, {
        actions: updatedActions,
        updatedAt: serverTimestamp()
      });

      setProspects(prospects.map(p => 
        p.id === prospectId ? { ...p, actions: updatedActions } : p
      ));
    } catch (error) {
      console.error('Error adding action:', error);
    }
  };

  const handleGenerateEmail = (prospect) => {
    setSelectedProspect(prospect);
    setShowEmailModal(true);
  };

  const handleGenerateLinkedIn = (prospect) => {
    setSelectedProspect(prospect);
    setShowLinkedInModal(true);
  };

  const handleEnrichProfile = async (prospectId) => {
    // TODO: Call Apollo API for additional enrichment
    console.log('Enriching profile:', prospectId);
    addAction(prospectId, 'enriched', { source: 'apollo' });
  };

  const filteredProspects = prospects.filter(prospect => {
    // Priority filter
    if (filter !== 'all' && prospect.priority.toLowerCase() !== filter) {
      return false;
    }
    // Status filter
    if (statusFilter !== 'all' && prospect.prospectStatus !== statusFilter) {
      return false;
    }
    return true;
  });

  const getStatusCounts = () => {
    return {
      all: prospects.length,
      new: prospects.filter(p => p.prospectStatus === 'new').length,
      contacted: prospects.filter(p => p.prospectStatus === 'contacted').length,
      replied: prospects.filter(p => p.prospectStatus === 'replied').length,
      meeting: prospects.filter(p => p.prospectStatus === 'meeting').length
    };
  };

  const getPriorityCounts = () => {
    return {
      all: prospects.length,
      a: prospects.filter(p => p.priority === 'A').length,
      b: prospects.filter(p => p.priority === 'B').length,
      c: prospects.filter(p => p.priority === 'C').length
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mb-4"></div>
          <p className="text-purple-200">Loading prospects...</p>
        </div>
      </div>
    );
  }

  const statusCounts = getStatusCounts();
  const priorityCounts = getPriorityCounts();

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900">
      {/* Header */}
      <div className="bg-black/30 backdrop-blur-sm border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="text-purple-300 hover:text-purple-200 transition-colors"
              >
                ← Back to Dashboard
              </button>
              <div>
                <h1 className="text-2xl font-bold text-white">My Prospects</h1>
                <p className="text-purple-300 text-sm">
                  {prospects.length} accepted {prospects.length === 1 ? 'lead' : 'leads'}
                </p>
              </div>
            </div>
            <button
              onClick={() => auth.signOut()}
              className="px-4 py-2 bg-purple-600/20 text-purple-300 rounded-lg hover:bg-purple-600/30 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="mb-8 space-y-4">
          {/* Priority Filter */}
          <div className="bg-black/20 backdrop-blur-sm rounded-xl p-4 border border-purple-500/20">
            <h3 className="text-purple-200 text-sm font-semibold mb-3">Filter by Priority</h3>
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'all', label: 'All', count: priorityCounts.all },
                { key: 'a', label: 'A Priority', count: priorityCounts.a, color: 'red' },
                { key: 'b', label: 'B Priority', count: priorityCounts.b, color: 'yellow' },
                { key: 'c', label: 'C Priority', count: priorityCounts.c, color: 'blue' }
              ].map(({ key, label, count, color }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-4 py-2 rounded-lg transition-all ${
                    filter === key
                      ? color === 'red' ? 'bg-red-600 text-white'
                        : color === 'yellow' ? 'bg-yellow-600 text-white'
                        : color === 'blue' ? 'bg-blue-600 text-white'
                        : 'bg-purple-600 text-white'
                      : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30'
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div className="bg-black/20 backdrop-blur-sm rounded-xl p-4 border border-purple-500/20">
            <h3 className="text-purple-200 text-sm font-semibold mb-3">Filter by Status</h3>
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'all', label: 'All', count: statusCounts.all },
                { key: 'new', label: '🆕 New', count: statusCounts.new },
                { key: 'contacted', label: '📧 Contacted', count: statusCounts.contacted },
                { key: 'replied', label: '💬 Replied', count: statusCounts.replied },
                { key: 'meeting', label: '🗓️ Meeting Booked', count: statusCounts.meeting }
              ].map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-4 py-2 rounded-lg transition-all ${
                    statusFilter === key
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30'
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Prospects Grid */}
        {filteredProspects.length === 0 ? (
          <div className="bg-black/20 backdrop-blur-sm rounded-xl p-12 border border-purple-500/20 text-center">
            <p className="text-purple-300 text-lg mb-2">No prospects match your filters</p>
            <p className="text-purple-400 text-sm">Try adjusting your filters or accept more leads from the dashboard</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="mt-4 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredProspects.map(prospect => (
              <ProspectCard
                key={prospect.id}
                prospect={prospect}
                onUpdateProspect={updateProspect}
                onGenerateEmail={handleGenerateEmail}
                onGenerateLinkedIn={handleGenerateLinkedIn}
                onEnrichProfile={handleEnrichProfile}
                onAddAction={addAction}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showEmailModal && selectedProspect && (
        <GenerateEmailModal
          prospect={selectedProspect}
          icpData={icpData}
          onClose={() => {
            setShowEmailModal(false);
            setSelectedProspect(null);
          }}
          onGenerated={(email) => {
            addAction(selectedProspect.id, 'email_generated', { template: email });
          }}
        />
      )}

      {showLinkedInModal && selectedProspect && (
        <GenerateLinkedInModal
          prospect={selectedProspect}
          icpData={icpData}
          onClose={() => {
            setShowLinkedInModal(false);
            setSelectedProspect(null);
          }}
          onGenerated={(message) => {
            addAction(selectedProspect.id, 'linkedin_generated', { template: message });
          }}
        />
      )}
    </div>
  );
}