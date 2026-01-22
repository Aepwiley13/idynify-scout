import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { ArrowLeft, Target, Building2, Users, TrendingUp, Settings, UserPlus, Search } from 'lucide-react';
import SavedCompanies from './SavedCompanies';
import TotalMarket from './TotalMarket';
import ICPSettings from './ICPSettings';
import DailyLeads from './DailyLeads';
import AllLeads from './AllLeads';
import CompanySearch from './CompanySearch';
import ContactSearch from './ContactSearch';
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

  // Update active tab when location state changes (e.g., when navigating from Daily Leads)
  useEffect(() => {
    if (location.state?.activeTab) {
      setActiveTab(location.state.activeTab);
    }
  }, [location.state?.activeTab]);

  // Handle Scout+ tab - open modal instead of rendering content
  useEffect(() => {
    if (activeTab === 'scout-plus') {
      setShowAddContactModal(true);
      // Reset to daily-leads to avoid staying on scout-plus "tab"
      setActiveTab('daily-leads');
    }
  }, [activeTab]);

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
      {/* Tab Content - Navigation now handled by sidebar */}
      <div className="tab-content">
        {activeTab === 'company-search' && <CompanySearch />}
        {activeTab === 'contact-search' && <ContactSearch />}
        {activeTab === 'daily-leads' && <DailyLeads />}
        {activeTab === 'saved-companies' && <SavedCompanies />}
        {activeTab === 'all-leads' && <AllLeads />}
        {activeTab === 'total-market' && <TotalMarket />}
        {activeTab === 'icp-settings' && <ICPSettings />}
      </div>

      {/* Scout+ Modal */}
      {showAddContactModal && (
        <AddContactModal
          onClose={() => setShowAddContactModal(false)}
          onContactAdded={handleContactAdded}
        />
      )}
    </div>
  );
}
