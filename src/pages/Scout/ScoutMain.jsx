import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import SavedCompanies from './SavedCompanies';
import TotalMarket from './TotalMarket';
import ICPSettings from './ICPSettings';
import DailyLeads from './DailyLeads';
import AllLeads from './AllLeads';
import './ScoutMain.css';

export default function ScoutMain() {
  const navigate = useNavigate();
  const location = useLocation();

  // Check if redirected with specific tab state
  const initialTab = location.state?.activeTab || 'daily-leads';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [contactCount, setContactCount] = useState(0);

  // Load contact count for All Leads tab badge
  useEffect(() => {
    loadContactCount();
  }, []);

  async function loadContactCount() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const contactsSnapshot = await getDocs(
        collection(db, 'users', user.uid, 'contacts')
      );
      setContactCount(contactsSnapshot.size);
    } catch (error) {
      console.error('Error loading contact count:', error);
    }
  }

  return (
    <div className="scout-main">
      {/* Scout Header */}
      <header className="scout-header">
        <div className="header-left">
          <button
            className="back-btn"
            onClick={() => navigate('/mission-control-v2')}
          >
            ← Mission Control
          </button>
          <h1>🎯 SCOUT</h1>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="scout-tabs">
        <button
          className={`tab ${activeTab === 'daily-leads' ? 'active' : ''}`}
          onClick={() => setActiveTab('daily-leads')}
        >
          📱 Daily Leads
        </button>

        <button
          className={`tab ${activeTab === 'saved-companies' ? 'active' : ''}`}
          onClick={() => setActiveTab('saved-companies')}
        >
          🏢 Saved Companies
        </button>

        <button
          className={`tab ${activeTab === 'all-leads' ? 'active' : ''}`}
          onClick={() => setActiveTab('all-leads')}
        >
          👥 All Leads {contactCount > 0 && `(${contactCount})`}
        </button>

        <button
          className={`tab ${activeTab === 'total-market' ? 'active' : ''}`}
          onClick={() => setActiveTab('total-market')}
        >
          📊 Total Market
        </button>

        <button
          className={`tab ${activeTab === 'icp-settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('icp-settings')}
        >
          ⚙️ ICP Settings
        </button>
      </nav>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'daily-leads' && <DailyLeads />}
        {activeTab === 'saved-companies' && <SavedCompanies />}
        {activeTab === 'all-leads' && <AllLeads />}
        {activeTab === 'total-market' && <TotalMarket />}
        {activeTab === 'icp-settings' && <ICPSettings />}
      </div>
    </div>
  );
}
