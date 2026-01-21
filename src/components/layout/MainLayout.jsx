import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { LogOut, User } from 'lucide-react';
import { auth } from '../../firebase/config';
import './MainLayout.css';

const MainLayout = ({ children, user }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await auth.signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Get page title based on current route
  const getPageTitle = () => {
    const pathname = location.pathname;
    const activeTab = location.state?.activeTab;

    if (pathname === '/mission-control-v2') {
      return 'Mission Control';
    }

    if (pathname === '/scout' || pathname.startsWith('/scout')) {
      if (activeTab === 'daily-leads' || !activeTab) {
        return 'Daily Lead Insights';
      }
      if (activeTab === 'company-search') return 'Company Search';
      if (activeTab === 'saved-companies') return 'Saved Companies';
      if (activeTab === 'all-leads') return 'All Leads';
      if (activeTab === 'total-market') return 'Total Market';
      if (activeTab === 'icp-settings') return 'ICP Settings';
      if (activeTab === 'scout-plus') return 'Scout+';
    }

    if (pathname === '/hunter') return 'Hunter';
    if (pathname.startsWith('/mission-control-v2/recon')) return 'Recon';
    if (pathname === '/admin') return 'Admin';

    return 'Idynify Scout';
  };

  return (
    <div className="main-layout">
      <Sidebar />

      <div className="main-content">
        {/* Top Bar */}
        <header className="top-bar">
          <div className="top-bar-left">
            <h1 className="page-title">{getPageTitle()}</h1>
          </div>

          <div className="top-bar-right">
            {user && (
              <>
                <div className="user-info">
                  <User size={16} />
                  <span>{user.email}</span>
                </div>
                <button
                  className="logout-button"
                  onClick={handleLogout}
                  title="Logout"
                >
                  <LogOut size={18} />
                  <span>Logout</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
