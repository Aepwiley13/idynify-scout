import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Star,
  Search,
  UserPlus,
  Building2,
  Users,
  TrendingUp,
  Settings,
  ChevronLeft,
  ChevronRight,
  Home,
  Brain,
  Target,
  MessageSquare,
  Shield,
  Swords,
  Activity,
  Crosshair,
  Mail,
  Package,
  BarChart3,
  Zap
} from 'lucide-react';
import './Sidebar.css';

const Sidebar = ({ mobileMenuOpen = false, onCloseMobileMenu = () => {} }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    recon: true,
    scout: true,
    hunter: true
  });
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigation = (path, state = {}) => {
    navigate(path, { state });
    onCloseMobileMenu();
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const isActive = (path, tabName) => {
    if (path === '/scout' && tabName) {
      return location.pathname === '/scout' &&
             (location.state?.activeTab === tabName ||
              (!location.state?.activeTab && tabName === 'daily-leads'));
    }
    if (path === '/hunter' && tabName) {
      return location.pathname === '/hunter' &&
             (location.state?.activeTab === tabName ||
              (!location.state?.activeTab && tabName === 'missions'));
    }
    return location.pathname === path;
  };

  const isPathActive = (path) => {
    return location.pathname.startsWith(path);
  };

  const reconItems = [
    {
      icon: Brain,
      label: 'Overview',
      sublabel: 'Training Status',
      path: '/recon',
      isPrimary: true
    },
    {
      icon: Target,
      label: 'ICP Intelligence',
      path: '/recon/icp-intelligence'
    },
    {
      icon: MessageSquare,
      label: 'Messaging & Voice',
      path: '/recon/messaging'
    },
    {
      icon: Shield,
      label: 'Objections & Constraints',
      path: '/recon/objections'
    },
    {
      icon: Swords,
      label: 'Competitive Intel',
      path: '/recon/competitive-intel'
    },
    {
      icon: Zap,
      label: 'Buying Signals',
      path: '/recon/buying-signals'
    },
    {
      icon: Activity,
      label: 'Barry Training',
      path: '/recon/barry-training'
    }
  ];

  const scoutItems = [
    {
      icon: Star,
      label: 'Daily Leads',
      sublabel: 'Review Queue',
      path: '/scout',
      state: { activeTab: 'daily-leads' },
      isPrimary: true
    },
    {
      icon: Search,
      label: 'Company Search',
      path: '/scout',
      state: { activeTab: 'company-search' }
    },
    {
      icon: Users,
      label: 'Contact Search',
      path: '/scout',
      state: { activeTab: 'contact-search' }
    },
    {
      icon: UserPlus,
      label: 'Scout+',
      path: '/scout',
      state: { activeTab: 'scout-plus' }
    },
    {
      icon: Building2,
      label: 'Saved Companies',
      path: '/scout',
      state: { activeTab: 'saved-companies' }
    },
    {
      icon: Users,
      label: 'All Leads',
      path: '/scout',
      state: { activeTab: 'all-leads' }
    },
    {
      icon: TrendingUp,
      label: 'Total Market',
      path: '/scout',
      state: { activeTab: 'total-market' }
    },
    {
      icon: Settings,
      label: 'ICP Settings',
      path: '/scout',
      state: { activeTab: 'icp-settings' }
    }
  ];

  const hunterItems = [
    {
      icon: Crosshair,
      label: 'Missions',
      sublabel: 'Active Campaigns',
      path: '/hunter',
      state: { activeTab: 'missions' },
      isPrimary: true
    },
    {
      icon: Mail,
      label: 'Weapons',
      path: '/hunter',
      state: { activeTab: 'weapons' }
    },
    {
      icon: Package,
      label: 'Arsenal',
      path: '/hunter',
      state: { activeTab: 'arsenal' }
    },
    {
      icon: BarChart3,
      label: 'Outcomes',
      path: '/hunter',
      state: { activeTab: 'outcomes' }
    }
  ];

  const renderNavItem = (item) => {
    const active = item.state
      ? isActive(item.path, item.state?.activeTab)
      : isActive(item.path);

    return (
      <li key={item.label + (item.state?.activeTab || '')}>
        <button
          className={`nav-item ${item.isPrimary ? 'primary-item' : ''} ${active ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => handleNavigation(item.path, item.state)}
          title={isCollapsed ? item.label : ''}
        >
          <item.icon size={18} strokeWidth={2} />
          {!isCollapsed && (
            <div className="nav-item-content">
              <span className="nav-item-label">{item.label}</span>
              {item.sublabel && (
                <span className="nav-item-sublabel">{item.sublabel}</span>
              )}
            </div>
          )}
        </button>
      </li>
    );
  };

  const renderPillar = (id, label, icon, color, items) => {
    const IconComponent = icon;
    const isExpanded = expandedSections[id];
    const pillarActive = id === 'recon'
      ? isPathActive('/recon')
      : id === 'scout'
      ? isPathActive('/scout')
      : isPathActive('/hunter');

    return (
      <div className={`nav-pillar ${pillarActive ? 'pillar-active' : ''}`} data-pillar={id}>
        <button
          className={`pillar-header ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => isCollapsed ? handleNavigation(items[0].path, items[0].state) : toggleSection(id)}
          title={isCollapsed ? label : ''}
        >
          <div className={`pillar-icon ${color}`}>
            <IconComponent size={16} strokeWidth={2.5} />
          </div>
          {!isCollapsed && (
            <>
              <span className="pillar-label">{label}</span>
              <ChevronRight
                size={14}
                className={`pillar-chevron ${isExpanded ? 'expanded' : ''}`}
              />
            </>
          )}
        </button>
        {!isCollapsed && isExpanded && (
          <ul className="pillar-items">
            {items.map(renderNavItem)}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <button
          className={`mission-control-link ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => navigate('/mission-control-v2')}
          title={isCollapsed ? 'Mission Control' : ''}
        >
          <Home size={18} strokeWidth={2} />
          {!isCollapsed && <span>Mission Control</span>}
        </button>
      </div>

      {/* Navigation Pillars */}
      <nav className="sidebar-nav">
        {renderPillar('recon', 'RECON', Brain, 'pillar-purple', reconItems)}
        {renderPillar('scout', 'SCOUT', Search, 'pillar-cyan', scoutItems)}
        {renderPillar('hunter', 'HUNTER', Crosshair, 'pillar-pink', hunterItems)}
      </nav>

      {/* Collapse Toggle */}
      <button
        className="collapse-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </div>
  );
};

export default Sidebar;
