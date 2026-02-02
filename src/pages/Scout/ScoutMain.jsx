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
import './ScoutMain.css';

export default function ScoutMain() {
  const navigate = useNavigate();
  const location = useLocation();

  // Check if redirected with specific tab state
  const initialTab = location.state?.activeTab || 'daily-leads';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [contactCount, setContactCount] = useState(0);

  // Update active tab when location state changes (e.g., when navigating from Daily Leads)
  useEffect(() => {
    if (location.state?.activeTab) {
      setActiveTab(location.state.activeTab);
    }
  }, [location.state?.activeTab]);

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

    </div>
  );
}
