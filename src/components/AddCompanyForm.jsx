// Module 7: Manual Company Add - AddCompanyForm Component

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';
import { callNetlifyFunction } from '../utils/apiClient';
import CompanyCard from './CompanyCard';

export default function AddCompanyForm() {
  const navigate = useNavigate();
  const [searchType, setSearchType] = useState('domain'); // 'domain' or 'name'
  const [searchValue, setSearchValue] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();

    if (!searchValue.trim()) {
      setError('Please enter a domain or company name');
      return;
    }

    setSearching(true);
    setError(null);
    setSearchResults([]);

    try {
      // Call apolloCompanyLookup with domain or companyName
      const payload = searchType === 'domain'
        ? { domain: searchValue.trim() }
        : { companyName: searchValue.trim() };

      const result = await callNetlifyFunction('apolloCompanyLookup', payload);

      if (result.companies && result.companies.length > 0) {
        setSearchResults(result.companies);
      } else {
        setError('No companies found. Please try a different search.');
      }
    } catch (err) {
      console.error('Error searching for company:', err);
      setError(err.message || 'Failed to search for company');
    } finally {
      setSearching(false);
    }
  };

  const handleAddCompany = async (company) => {
    const user = auth.currentUser;
    if (!user) {
      setError('No authenticated user');
      return;
    }

    setSaving(true);

    try {
      // Save company to Firestore
      const companyPath = getPath.userCompany(user.uid, company.apollo_company_id);
      const companyRef = doc(db, companyPath);

      await setDoc(companyRef, {
        ...company,
        selectedAt: new Date().toISOString(),
        addedManually: true
      });

      // Navigate back to companies list
      navigate('/companies');
    } catch (err) {
      console.error('Error adding company:', err);
      setError('Failed to add company. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/companies')}
            className="text-gray-400 hover:text-white mb-4 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Companies
          </button>
          <h1 className="text-4xl font-bold text-cyan-400 mb-2">Add Company Manually</h1>
          <p className="text-gray-400">
            Search for a company by domain or name to add it to your list
          </p>
        </div>

        {/* Search Form */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 mb-8">
          <form onSubmit={handleSearch}>
            {/* Search Type Toggle */}
            <div className="flex gap-4 mb-4">
              <button
                type="button"
                onClick={() => setSearchType('domain')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  searchType === 'domain'
                    ? 'bg-cyan-400 text-black'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Search by Domain
              </button>
              <button
                type="button"
                onClick={() => setSearchType('name')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  searchType === 'name'
                    ? 'bg-cyan-400 text-black'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Search by Name
              </button>
            </div>

            {/* Search Input */}
            <div className="flex gap-4">
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={
                  searchType === 'domain'
                    ? 'e.g., acme.com'
                    : 'e.g., Acme Corporation'
                }
                className="flex-1 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={searching || !searchValue.trim()}
                className={`px-8 py-3 rounded-lg transition-colors font-bold ${
                  searching || !searchValue.trim()
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-cyan-400 text-black hover:bg-cyan-300'
                }`}
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-4 bg-red-900/20 border border-red-700 rounded-lg">
              <p className="text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-4">
              Search Results ({searchResults.length})
            </h2>

            <div className="space-y-4">
              {searchResults.map((company) => (
                <div key={company.apollo_company_id} className="relative">
                  <CompanyCard
                    company={company}
                    isSelected={false}
                    onToggle={() => {}}
                  />
                  <button
                    onClick={() => handleAddCompany(company)}
                    disabled={saving}
                    className={`absolute top-6 right-6 px-6 py-3 rounded-lg transition-colors font-bold ${
                      saving
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-cyan-400 text-black hover:bg-cyan-300'
                    }`}
                  >
                    {saving ? 'Adding...' : 'Add Company'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!searching && searchResults.length === 0 && !error && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <p className="text-gray-400 text-lg">
              Enter a domain or company name to search
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
