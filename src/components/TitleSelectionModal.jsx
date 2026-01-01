import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { X, Search, Target, CheckCircle, ChevronUp, ChevronDown } from 'lucide-react';
import './TitleSelectionModal.css';

// Comprehensive B2B job titles list
const JOB_TITLES = [
  // Executive
  'CEO', 'President', 'COO', 'CFO', 'CRO', 'CMO', 'CTO', 'CIO', 'CISO',

  // Sales Leadership
  'VP Sales', 'VP Business Development', 'VP Revenue', 'Chief Revenue Officer',
  'Director of Sales', 'Director of Business Development', 'Head of Sales',

  // Sales Operations
  'Sales Manager', 'Business Development Manager', 'Regional Sales Manager',
  'Account Executive', 'Senior Account Executive', 'Enterprise Account Executive',
  'Sales Development Rep (SDR)', 'Business Development Rep (BDR)',

  // Marketing
  'VP Marketing', 'Director of Marketing', 'Head of Marketing',
  'Marketing Manager', 'Demand Generation Manager', 'Growth Manager',

  // Operations
  'VP Operations', 'Director of Operations', 'Operations Manager',

  // Finance
  'VP Finance', 'Finance Director', 'Controller', 'Accounting Manager',

  // Technical
  'VP Engineering', 'Director of Engineering', 'Engineering Manager',

  // HR/People
  'VP Human Resources', 'HR Director', 'People Operations Manager',

  // Legal/Compliance
  'General Counsel', 'VP Legal', 'Compliance Officer', 'Risk Manager',

  // Customer Success
  'VP Customer Success', 'Customer Success Manager', 'Account Manager'
];

export default function TitleSelectionModal({ company, onClose, onConfirm }) {
  const [selectedTitles, setSelectedTitles] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  // Toggle title selection
  const toggleTitle = (title) => {
    if (selectedTitles.find(t => t.title === title)) {
      // Remove title
      setSelectedTitles(selectedTitles.filter(t => t.title !== title));
    } else {
      // Add title (max 10)
      if (selectedTitles.length >= 10) {
        alert('You can select up to 10 titles maximum');
        return;
      }

      const newTitle = {
        title,
        rank: selectedTitles.length + 1,
        score: 100 - (selectedTitles.length * 10)
      };
      setSelectedTitles([...selectedTitles, newTitle]);
    }
  };

  // Move title up in ranking
  const moveUp = (index) => {
    if (index === 0) return; // Already at top

    const newTitles = [...selectedTitles];
    const temp = newTitles[index - 1];
    newTitles[index - 1] = newTitles[index];
    newTitles[index] = temp;

    // Update ranks and scores
    updateRanks(newTitles);
  };

  // Move title down in ranking
  const moveDown = (index) => {
    if (index === selectedTitles.length - 1) return; // Already at bottom

    const newTitles = [...selectedTitles];
    const temp = newTitles[index + 1];
    newTitles[index + 1] = newTitles[index];
    newTitles[index] = temp;

    // Update ranks and scores
    updateRanks(newTitles);
  };

  // Update ranks and scores after reordering
  const updateRanks = (titles) => {
    const updated = titles.map((t, idx) => ({
      ...t,
      rank: idx + 1,
      score: 100 - (idx * 10)
    }));
    setSelectedTitles(updated);
  };

  // Save titles to Firestore and confirm
  const handleSearchContacts = async () => {
    if (selectedTitles.length === 0) {
      alert('Please select at least one job title');
      return;
    }

    setSaving(true);

    try {
      const userId = auth.currentUser.uid;

      // Save selected titles to company document
      await updateDoc(doc(db, 'users', userId, 'companies', company.id), {
        selected_titles: selectedTitles,
        titles_updated_at: new Date().toISOString()
      });

      console.log('✅ Titles saved for company:', company.name);
      console.log('📋 Selected titles:', selectedTitles);

      // Call onConfirm callback
      onConfirm(selectedTitles);
    } catch (error) {
      console.error('❌ Failed to save titles:', error);
      alert('Failed to save titles. Please try again.');
      setSaving(false);
    }
  };

  // Filter titles by search term
  const filteredTitles = JOB_TITLES.filter(title =>
    title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="title-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="header-content">
            <div className="header-icon">
              <Target className="w-6 h-6" />
            </div>
            <div className="header-text">
              <h2>Browse Common Titles</h2>
              <p className="company-name">{company.name}</p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instructions */}
        <div className="modal-instructions">
          <p className="instruction-main">Select and rank the job titles you want to target at this company.</p>
          <p className="instruction-note">
            <Target className="w-4 h-4" />
            <span>Top 3 titles will be prioritized in the search</span>
          </p>
        </div>

        {/* Search Bar */}
        <div className="search-bar">
          <Search className="search-icon-modal" />
          <input
            type="text"
            placeholder="Search titles..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Two Column Layout */}
        <div className="modal-content">
          {/* Left: Available Titles */}
          <div className="available-titles">
            <h3>Available Titles</h3>
            <div className="titles-list">
              {filteredTitles.map(title => {
                const isSelected = selectedTitles.find(t => t.title === title);
                return (
                  <label key={title} className={`title-checkbox ${isSelected ? 'selected' : ''}`}>
                    <div className="checkbox-custom">
                      {isSelected && <CheckCircle className="w-5 h-5" />}
                    </div>
                    <span className="title-label">{title}</span>
                    <input
                      type="checkbox"
                      checked={!!isSelected}
                      onChange={() => toggleTitle(title)}
                      style={{ display: 'none' }}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {/* Right: Selected & Ranked Titles */}
          <div className="selected-titles">
            <h3>Selected Titles ({selectedTitles.length}/10)</h3>

            {selectedTitles.length === 0 ? (
              <div className="empty-selection">
                <Target className="w-12 h-12" />
                <p className="empty-title">No titles selected yet</p>
                <p className="empty-hint">Select titles from the left to get started</p>
              </div>
            ) : (
              <div className="ranked-list">
                {selectedTitles.map((item, index) => (
                  <div key={item.title} className="ranked-title">
                    <span className="rank-number">#{item.rank}</span>
                    <span className="title-text">{item.title}</span>
                    <div className="rank-controls">
                      <button
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className="arrow-btn"
                        title="Move up"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveDown(index)}
                        disabled={index === selectedTitles.length - 1}
                        className="arrow-btn"
                        title="Move down"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedTitles.length > 0 && (
              <div className="priority-note">
                <div className="priority-header">
                  <Target className="w-4 h-4" />
                  <span>Top 3 Prioritized Titles</span>
                </div>
                {selectedTitles.slice(0, 3).map((t, idx) => (
                  <div key={t.title} className="priority-item">
                    <span className="priority-rank">#{idx + 1}</span>
                    <span>{t.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="confirm-btn"
            onClick={handleSearchContacts}
            disabled={selectedTitles.length === 0 || saving}
          >
            {saving ? (
              <>
                <div className="loading-spinner-small"></div>
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                <span>Search Contacts</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
