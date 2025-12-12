// Module 14: Lead Review & Accuracy Validation - LeadList Component

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';
import LeadDetail from './LeadDetail';
import NavigationBar from './NavigationBar';

export default function LeadList() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [filteredLeads, setFilteredLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'pending_review' | 'validated'
  const [selectedLead, setSelectedLead] = useState(null);

  useEffect(() => {
    loadLeads();
  }, []);

  useEffect(() => {
    applyFilter();
  }, [filter, leads]);

  const loadLeads = async () => {
    const user = auth.currentUser;
    if (!user) {
      setError('No authenticated user');
      setLoading(false);
      return;
    }

    try {
      const leadsPath = getPath.userLeads(user.uid);
      const leadsQuery = query(collection(db, leadsPath));
      const leadsSnapshot = await getDocs(leadsQuery);

      const leadsData = leadsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by enrichment date (newest first)
      leadsData.sort((a, b) => {
        const dateA = new Date(a.enriched_at || 0);
        const dateB = new Date(b.enriched_at || 0);
        return dateB - dateA;
      });

      setLeads(leadsData);
    } catch (err) {
      console.error('Error loading leads:', err);
      setError('Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    if (filter === 'all') {
      setFilteredLeads(leads);
    } else if (filter === 'pending_review') {
      setFilteredLeads(leads.filter(lead => lead.status === 'pending_review'));
    } else if (filter === 'validated') {
      setFilteredLeads(leads.filter(lead =>
        lead.status === 'accurate' || lead.status === 'inaccurate'
      ));
    }
  };

  const handleLeadClick = (lead) => {
    setSelectedLead(lead);
  };

  const handleCloseDetail = () => {
    setSelectedLead(null);
    // Reload leads to get updated status
    loadLeads();
  };

  if (loading) {
    return (
      <>
        <NavigationBar />
        <div className="min-h-screen bg-black text-white flex items-center justify-center">
          <div className="text-center">
            <div className="text-cyan-400 text-xl mb-4">Loading leads...</div>
            <div className="animate-pulse text-gray-400">Please wait</div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <NavigationBar />
        <div className="min-h-screen bg-black text-white flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-red-400 text-xl mb-4">Error</div>
            <p className="text-gray-400 mb-6">{error}</p>
            <button
              onClick={() => navigate('/scout')}
              className="px-6 py-3 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Go to Scout
            </button>
          </div>
        </div>
      </>
    );
  }

  // Show lead detail if one is selected
  if (selectedLead) {
    return (
      <>
        <NavigationBar />
        <LeadDetail lead={selectedLead} onClose={handleCloseDetail} />
      </>
    );
  }

  return (
    <>
      <NavigationBar />
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-cyan-400 mb-2">Lead Review</h1>
          <p className="text-gray-400">
            Review and validate your enriched leads
          </p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex gap-4">
          <button
            onClick={() => setFilter('all')}
            className={`px-6 py-3 rounded-lg transition-colors ${
              filter === 'all'
                ? 'bg-cyan-400 text-black'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All ({leads.length})
          </button>
          <button
            onClick={() => setFilter('pending_review')}
            className={`px-6 py-3 rounded-lg transition-colors ${
              filter === 'pending_review'
                ? 'bg-cyan-400 text-black'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Pending Review ({leads.filter(l => l.status === 'pending_review').length})
          </button>
          <button
            onClick={() => setFilter('validated')}
            className={`px-6 py-3 rounded-lg transition-colors ${
              filter === 'validated'
                ? 'bg-cyan-400 text-black'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Validated ({leads.filter(l => l.status === 'accurate' || l.status === 'inaccurate').length})
          </button>
        </div>

        {/* Leads List */}
        {filteredLeads.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg mb-4">No leads found</p>
            <button
              onClick={() => navigate('/scout')}
              className="px-6 py-3 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Find More Contacts
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredLeads.map((lead) => (
              <div
                key={lead.id}
                onClick={() => handleLeadClick(lead)}
                className="bg-gray-900 border border-gray-700 rounded-lg p-6 hover:border-cyan-400 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-2">
                      {lead.name}
                    </h3>
                    <div className="space-y-1">
                      <div className="text-gray-400 text-sm">
                        <span className="text-gray-500">Title:</span> {lead.title}
                      </div>
                      <div className="text-gray-400 text-sm">
                        <span className="text-gray-500">Company:</span> {lead.company_name}
                      </div>
                      <div className="text-gray-400 text-sm">
                        <span className="text-gray-500">Enriched:</span>{' '}
                        {new Date(lead.enriched_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        lead.status === 'accurate'
                          ? 'bg-green-600 text-white'
                          : lead.status === 'inaccurate'
                          ? 'bg-red-600 text-white'
                          : lead.status === 'in_progress'
                          ? 'bg-yellow-600 text-white'
                          : 'bg-gray-600 text-white'
                      }`}
                    >
                      {lead.status === 'pending_review'
                        ? 'Pending Review'
                        : lead.status === 'accurate'
                        ? 'Accurate'
                        : lead.status === 'inaccurate'
                        ? 'Inaccurate'
                        : lead.status === 'in_progress'
                        ? 'In Progress'
                        : lead.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </>
  );
}
