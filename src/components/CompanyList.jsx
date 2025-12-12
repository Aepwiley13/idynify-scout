// Module 6: Company Matching - CompanyList Component

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';
import { callNetlifyFunction } from '../utils/apiClient';
import CompanyCard from './CompanyCard';
import NavigationBar from './NavigationBar';

export default function CompanyList() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    const user = auth.currentUser;
    if (!user) {
      setError('No authenticated user');
      setLoading(false);
      return;
    }

    try {
      // Load ICP data from Firestore
      const icpPath = getPath.userICP(user.uid);
      const icpRef = doc(db, icpPath);
      const icpDoc = await getDoc(icpRef);

      if (!icpDoc.exists()) {
        setError('Please complete the ICP Builder first');
        setLoading(false);
        return;
      }

      const icpData = icpDoc.data();

      // Call Apollo Company Lookup function
      const result = await callNetlifyFunction('apolloCompanyLookup', {
        industries: icpData.industries,
        sizes: icpData.companySizes,
        keywords: icpData.targetTitles // Using titles as keywords
      });

      setCompanies(result.companies || []);

      // Load previously selected companies if any
      const companiesPath = getPath.userCompanies(user.uid);
      // Note: This would need to iterate through subcollection, for now starting fresh

    } catch (err) {
      console.error('Error fetching companies:', err);
      setError(err.message || 'Failed to fetch companies');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleCompany = (company) => {
    const isSelected = selectedCompanies.some(
      (c) => c.apollo_company_id === company.apollo_company_id
    );

    if (isSelected) {
      setSelectedCompanies(
        selectedCompanies.filter((c) => c.apollo_company_id !== company.apollo_company_id)
      );
    } else {
      setSelectedCompanies([...selectedCompanies, company]);
    }
  };

  const handleSaveCompanies = async () => {
    const user = auth.currentUser;
    if (!user || selectedCompanies.length === 0) return;

    setSaving(true);

    try {
      // Save each selected company to Firestore
      const savePromises = selectedCompanies.map(async (company) => {
        const companyPath = getPath.userCompany(user.uid, company.apollo_company_id);
        const companyRef = doc(db, companyPath);

        return setDoc(companyRef, {
          ...company,
          selectedAt: new Date().toISOString()
        });
      });

      await Promise.all(savePromises);

      alert(`${selectedCompanies.length} companies saved successfully!`);

      // Navigate to next step or dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('Error saving companies:', err);
      alert('Failed to save companies. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <NavigationBar />
        <div className="min-h-screen bg-black text-white flex items-center justify-center">
          <div className="text-center">
            <div className="text-cyan-400 text-xl mb-4">Finding companies that match your ICP...</div>
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
              onClick={() => navigate('/icp')}
              className="px-6 py-3 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Go to ICP Builder
            </button>
        </div>
      </div>
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
          <h1 className="text-4xl font-bold text-cyan-400 mb-2">Company Matches</h1>
          <p className="text-gray-400">
            We found {companies.length} companies matching your ICP. Select the ones you want to target.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="mb-6 flex gap-4 justify-between items-center">
          <div className="flex gap-4">
            <button
              onClick={() => navigate('/add-company')}
              className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              Add Manual Company
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition-colors"
            >
              Upgrade to Scout
            </button>
          </div>

          {selectedCompanies.length > 0 && (
            <button
              onClick={handleSaveCompanies}
              disabled={saving}
              className={`px-8 py-3 rounded-lg transition-colors font-bold ${
                saving
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-cyan-400 text-black hover:bg-cyan-300'
              }`}
            >
              {saving ? 'Saving...' : `Save ${selectedCompanies.length} Companies`}
            </button>
          )}
        </div>

        {/* Company Grid */}
        {companies.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">No companies found matching your criteria.</p>
            <button
              onClick={() => navigate('/add-company')}
              className="mt-6 px-6 py-3 bg-cyan-400 text-black rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Add Company Manually
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {companies.map((company) => (
              <CompanyCard
                key={company.apollo_company_id}
                company={company}
                isSelected={selectedCompanies.some(
                  (c) => c.apollo_company_id === company.apollo_company_id
                )}
                onToggle={() => handleToggleCompany(company)}
              />
            ))}
          </div>
        )}

        {/* Footer Info */}
        {companies.length > 0 && (
          <div className="mt-8 text-center text-gray-500 text-sm">
            Showing up to 20 companies. Save your selections to continue.
          </div>
        )}
        </div>
      </div>
    </>
  );
}
