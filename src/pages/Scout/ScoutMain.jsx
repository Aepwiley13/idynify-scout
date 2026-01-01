import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { ArrowLeft, Target, Building2, Users, TrendingUp, Settings, UserPlus } from 'lucide-react';
import SavedCompanies from './SavedCompanies';
import TotalMarket from './TotalMarket';
import ICPSettings from './ICPSettings';
import DailyLeads from './DailyLeads';
import AllLeads from './AllLeads';
import AddContactModal from '../../components/scout/AddContactModal';
import './ScoutMain.css';

export default function ScoutMain() {
  const navigate = useNavigate();
  const location = useLocation();

  // Check if redirected with specific tab state
  const initialTab = location.state?.activeTab || 'daily-leads';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [contactCount, setContactCount] = useState(0);
  const [showAddContactModal, setShowAddContactModal] = useState(false);

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

  function handleContactAdded(contacts) {
    console.log('✅ Contacts added:', contacts.length);
    // Reload contact count
    loadContactCount();
    // Switch to All Leads tab to show new contacts
    setActiveTab('all-leads');
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
            <ArrowLeft className="w-4 h-4" />
            <span>Mission Control</span>
          </button>
        </div>

        <div className="header-right">
          <button
            className="add-contact-btn"
            onClick={() => setShowAddContactModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.625rem 1.25rem',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '0.75rem',
              fontWeight: '600',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              marginRight: '1rem'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Contact</span>
          </button>
          <div className="scout-branding">
            <Target className="w-5 h-5" />
            <span>Scout</span>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="scout-tabs">
        <div className="tabs-container">
          <button
            className={`tab ${activeTab === 'daily-leads' ? 'active' : ''}`}
            onClick={() => setActiveTab('daily-leads')}
          >
            <Target className="w-4 h-4" />
            <span>Daily Leads</span>
          </button>

          <button
            className={`tab ${activeTab === 'saved-companies' ? 'active' : ''}`}
            onClick={() => setActiveTab('saved-companies')}
          >
            <Building2 className="w-4 h-4" />
            <span>Saved Companies</span>
          </button>

          <button
            className={`tab ${activeTab === 'all-leads' ? 'active' : ''}`}
            onClick={() => setActiveTab('all-leads')}
          >
            <Users className="w-4 h-4" />
            <span>All Leads</span>
            {contactCount > 0 && <span className="tab-badge">{contactCount}</span>}
          </button>

          <button
            className={`tab ${activeTab === 'total-market' ? 'active' : ''}`}
            onClick={() => setActiveTab('total-market')}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Total Market</span>
          </button>

          <button
            className={`tab ${activeTab === 'icp-settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('icp-settings')}
          >
            <Settings className="w-4 h-4" />
            <span>ICP Settings</span>
          </button>
        </div>
      </nav>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'daily-leads' && <DailyLeads />}
        {activeTab === 'saved-companies' && <SavedCompanies />}
        {activeTab === 'all-leads' && <AllLeads />}
        {activeTab === 'total-market' && <TotalMarket />}
        {activeTab === 'icp-settings' && <ICPSettings />}
      </div>

      {/* Add Contact Modal */}
      {showAddContactModal && (
        <AddContactModal
          onClose={() => setShowAddContactModal(false)}
          onContactAdded={handleContactAdded}
        />
      )}
    </div>
  );
}
