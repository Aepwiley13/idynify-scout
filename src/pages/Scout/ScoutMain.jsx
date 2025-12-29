import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SavedCompanies from './SavedCompanies';
import TotalMarket from './TotalMarket';
import ICPSettings from './ICPSettings';
import DailyLeads from './DailyLeads';
import './ScoutMain.css';

export default function ScoutMain() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('daily-leads'); // Default tab

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
        {activeTab === 'total-market' && <TotalMarket />}
        {activeTab === 'icp-settings' && <ICPSettings />}
      </div>
    </div>
  );
}
