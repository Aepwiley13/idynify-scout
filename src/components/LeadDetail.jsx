// Module 14: Lead Review & Accuracy Validation - LeadDetail Component

import React, { useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';
import { callNetlifyFunction } from '../utils/apiClient';
import LearningToast from './LearningToast';
import Papa from 'papaparse';

export default function LeadDetail({ lead, onClose }) {
  const [processing, setProcessing] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const handleAccurate = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setProcessing(true);

    try {
      // Update lead status
      const leadPath = getPath.userLead(user.uid, lead.lead_id);
      const leadRef = doc(db, leadPath);

      await updateDoc(leadRef, {
        status: 'accurate',
        validated_at: new Date().toISOString()
      });

      // Log event
      const eventId = `event_${Date.now()}_accurate`;
      const eventPath = getPath.userEvent(user.uid, eventId);
      const eventRef = doc(db, eventPath);

      await setDoc(eventRef, {
        event_id: eventId,
        action_type: 'lead_accuracy',
        validation: 'accurate',
        lead_id: lead.lead_id,
        apollo_person_id: lead.apollo_person_id,
        timestamp: new Date().toISOString()
      });

      // Call learning engine with +1 adjustment
      await callNetlifyFunction('learningEngine', {
        user_id: user.uid,
        action_type: 'lead_accuracy_accurate',
        lead_data: {
          lead_id: lead.lead_id,
          contact_id: lead.apollo_person_id
        }
      });

      // Show toast
      setToastMessage('Barry updated your targeting preferences');
      setShowToast(true);

      // Close after short delay
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Error marking lead as accurate:', err);
      alert('Failed to update lead. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleInaccurate = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setProcessing(true);

    try {
      // Update lead status
      const leadPath = getPath.userLead(user.uid, lead.lead_id);
      const leadRef = doc(db, leadPath);

      await updateDoc(leadRef, {
        status: 'inaccurate',
        validated_at: new Date().toISOString()
      });

      // Log event
      const eventId = `event_${Date.now()}_inaccurate`;
      const eventPath = getPath.userEvent(user.uid, eventId);
      const eventRef = doc(db, eventPath);

      await setDoc(eventRef, {
        event_id: eventId,
        action_type: 'lead_accuracy',
        validation: 'inaccurate',
        lead_id: lead.lead_id,
        apollo_person_id: lead.apollo_person_id,
        timestamp: new Date().toISOString()
      });

      // Call learning engine with -3 adjustment
      await callNetlifyFunction('learningEngine', {
        user_id: user.uid,
        action_type: 'lead_accuracy_inaccurate',
        lead_data: {
          lead_id: lead.lead_id,
          contact_id: lead.apollo_person_id
        }
      });

      // Show toast
      setToastMessage('Barry updated your targeting preferences');
      setShowToast(true);

      // Close after short delay
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Error marking lead as inaccurate:', err);
      alert('Failed to update lead. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleStillWorking = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setProcessing(true);

    try {
      // Update lead status (NO learning, NO event logging)
      const leadPath = getPath.userLead(user.uid, lead.lead_id);
      const leadRef = doc(db, leadPath);

      await updateDoc(leadRef, {
        status: 'in_progress',
        updated_at: new Date().toISOString()
      });

      alert('Lead marked as in progress');
      onClose();
    } catch (err) {
      console.error('Error updating lead:', err);
      alert('Failed to update lead. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleExportCSV = () => {
    const csvData = [{
      Name: lead.name,
      'First Name': lead.first_name,
      'Last Name': lead.last_name,
      Title: lead.title,
      Email: lead.email,
      Phone: lead.phone,
      Company: lead.company_name,
      Industry: lead.industry,
      'Company Size': lead.company_size,
      Location: lead.location,
      LinkedIn: lead.linkedin_url,
      'Enriched Date': new Date(lead.enriched_at).toLocaleDateString(),
      Status: lead.status
    }];

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `lead_${lead.name.replace(/\s+/g, '_')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCallNow = () => {
    if (lead.phone) {
      window.location.href = `tel:${lead.phone}`;
    } else {
      alert('No phone number available for this lead');
    }
  };

  return (
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
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-cyan-400 mb-2">{lead.name}</h1>
            <p className="text-gray-400">{lead.title} at {lead.company_name}</p>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            ← Back to List
          </button>
        </div>

        {/* Lead Details */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-8 mb-6">
          <h2 className="text-2xl font-bold text-white mb-6">Contact Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-gray-500 text-sm mb-1">Email</div>
              <div className="text-white">{lead.email || 'Not available'}</div>
            </div>

            <div>
              <div className="text-gray-500 text-sm mb-1">Phone</div>
              <div className="text-white">{lead.phone || 'Not available'}</div>
            </div>

            <div>
              <div className="text-gray-500 text-sm mb-1">Company</div>
              <div className="text-white">{lead.company_name}</div>
            </div>

            <div>
              <div className="text-gray-500 text-sm mb-1">Industry</div>
              <div className="text-white">{lead.industry || 'Not available'}</div>
            </div>

            <div>
              <div className="text-gray-500 text-sm mb-1">Company Size</div>
              <div className="text-white">{lead.company_size || 'Not available'}</div>
            </div>

            <div>
              <div className="text-gray-500 text-sm mb-1">Location</div>
              <div className="text-white">{lead.location || 'Not available'}</div>
            </div>

            <div>
              <div className="text-gray-500 text-sm mb-1">Enrichment Date</div>
              <div className="text-white">{new Date(lead.enriched_at).toLocaleDateString()}</div>
            </div>

            <div>
              <div className="text-gray-500 text-sm mb-1">Status</div>
              <div className="text-white capitalize">{lead.status.replace('_', ' ')}</div>
            </div>
          </div>

          {lead.linkedin_url && (
            <div className="mt-6">
              <div className="text-gray-500 text-sm mb-1">LinkedIn</div>
              <a
                href={lead.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 underline"
              >
                {lead.linkedin_url}
              </a>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <button
            onClick={handleAccurate}
            disabled={processing}
            className={`py-4 rounded-lg font-bold transition-colors ${
              processing
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-500'
            }`}
          >
            ✓ Lead Info Accurate
          </button>

          <button
            onClick={handleInaccurate}
            disabled={processing}
            className={`py-4 rounded-lg font-bold transition-colors ${
              processing
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-500'
            }`}
          >
            ✗ Lead Info Incorrect
          </button>

          <button
            onClick={handleStillWorking}
            disabled={processing}
            className={`py-4 rounded-lg font-bold transition-colors ${
              processing
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gray-600 text-white hover:bg-gray-500'
            }`}
          >
            ⏸ Still Working
          </button>

          <button
            onClick={handleExportCSV}
            className="py-4 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors font-bold"
          >
            📄 Export to CSV
          </button>

          <button
            onClick={handleCallNow}
            disabled={!lead.phone}
            className={`py-4 rounded-lg font-bold transition-colors ${
              lead.phone
                ? 'bg-cyan-600 text-white hover:bg-cyan-500'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            📞 Call Now
          </button>

          <button
            onClick={onClose}
            className="py-4 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors font-bold"
          >
            💾 Save for Later
          </button>
        </div>
      </div>
    </div>
  );
}
