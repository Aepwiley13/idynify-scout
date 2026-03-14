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
  Zap,
  LayoutDashboard
} from 'lucide-react';
import { useThemeCtx } from '../../theme/ThemeContext';
import { THEMES } from '../../theme/tokens';
import './Sidebar.css';

const Sidebar = ({ mobileMenuOpen = false, onCloseMobileMenu = () => {} }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { themeId, setThemeId } = useThemeCtx();
  const isLightTheme = !THEMES[themeId]?.isDark;
  const handleThemeToggle = () => setThemeId(isLightTheme ? 'mission' : 'workspace');
  const [expandedSections, setExpandedSections] = useState({
    people: true,
    recon: true,
    scout: true,
    hunter: true
  });
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigation = (path, state = {}) => {
    // If state contains an activeTab, encode it as a URL search param instead
    // so that tab selection survives page refresh and can be deep-linked.
    if (state?.activeTab) {
      navigate(`${path}?tab=${state.activeTab}`);
    } else {
      navigate(path);
    }
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
      const urlTab = new URLSearchParams(location.search).get('tab') || 'all-leads';
      return location.pathname === '/scout' && urlTab === tabName;
    }
    if (path === '/hunter' && tabName) {
      const urlTab = new URLSearchParams(location.search).get('tab') || 'dashboard';
      return location.pathname === '/hunter' && urlTab === tabName;
    }
    return location.pathname === path;
  };

  const isPathActive = (path) => {
    return location.pathname.startsWith(path);
  };

  const peopleItems = [
    {
      icon: Users,
      label: 'All People',
      sublabel: 'Overview',
      path: '/people',
      isPrimary: true
    }
  ];

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
      label: 'Daily Discoveries',
      sublabel: 'Review Queue',
      path: '/scout',
      state: { activeTab: 'daily-leads' },
      isPrimary: true
    },
    {
      icon: Building2,
      label: 'Saved Companies',
      path: '/scout',
      state: { activeTab: 'saved-companies' }
    },
    {
      icon: Users,
      label: 'People',
      path: '/scout',
      state: { activeTab: 'all-leads' }
    },
    {
      icon: UserPlus,
      label: 'Scout+',
      path: '/scout',
      state: { activeTab: 'scout-plus' }
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
    },
    {
      icon: Zap,
      label: 'Game Mode - Beta',
      sublabel: '15 in 30',
      path: '/scout/game',
      isPrimary: true
    },
    {
      icon: Settings,
      label: 'Settings',
      path: '/settings',
      isSettings: true
    }
  ];

  const hunterItems = [
    {
      icon: Users,
      label: 'People',
      sublabel: 'Active missions',
      path: '/hunter',
      state: { activeTab: 'people' },
      isPrimary: true
    },
    {
      icon: Mail,
      label: 'Weapons',
      path: '/hunter',
      state: { activeTab: 'weapons' }
    },
    {
      icon: Crosshair,
      label: 'Missions',
      path: '/hunter',
      state: { activeTab: 'missions' }
    },
    {
      icon: Package,
      label: 'Arsenal',
      path: '/hunter',
      state: { activeTab: 'arsenal' }
    },
    {
      icon: LayoutDashboard,
      label: 'Dashboard',
      sublabel: 'Operational View',
      path: '/hunter',
      state: { activeTab: 'dashboard' }
    },
    {
      icon: BarChart3,
      label: 'Outcomes',
      path: '/hunter',
      state: { activeTab: 'outcomes' }
    },
    {
      icon: Settings,
      label: 'Settings',
      path: '/settings',
      isSettings: true
    }
  ];

  const renderNavItem = (item) => {
    const active = item.state
      ? isActive(item.path, item.state?.activeTab)
      : isActive(item.path);

    return (
      <li key={item.label + (item.state?.activeTab || '')}>
        <button
          className={`nav-item ${item.isPrimary ? 'primary-item' : ''} ${item.isSettings ? 'settings-item' : ''} ${active ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
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
    const pillarActive = id === 'people'
      ? isPathActive('/people')
      : id === 'recon'
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
        {renderPillar('people', 'COMMAND CENTER', Users, 'pillar-cyan', peopleItems)}
        {renderPillar('recon', 'RECON', Brain, 'pillar-purple', reconItems)}
        {renderPillar('scout', 'SCOUT', Search, 'pillar-cyan', scoutItems)}
        {renderPillar('hunter', 'HUNTER', Crosshair, 'pillar-purple', hunterItems)}
      </nav>

      {/* Settings Link */}
      <button
        className={`settings-toggle ${isCollapsed ? 'collapsed' : ''} ${isActive('/settings') ? 'active' : ''}`}
        onClick={() => handleNavigation('/settings')}
        title={isCollapsed ? 'Settings' : ''}
        aria-label="Settings"
      >
        <Settings size={16} />
        {!isCollapsed && <span className="settings-toggle-label">Settings</span>}
      </button>

      {/* Theme Toggle */}
      <button
        className={`theme-toggle ${isCollapsed ? 'collapsed' : ''}`}
        onClick={handleThemeToggle}
        title={isLightTheme ? 'Switch to dark mode' : 'Switch to light mode'}
        aria-label={isLightTheme ? 'Switch to dark mode' : 'Switch to light mode'}
      >
        <span className="theme-toggle-icon">{isLightTheme ? '🌙' : '☀️'}</span>
        {!isCollapsed && (
          <span className="theme-toggle-label">
            {isLightTheme ? 'Dark mode' : 'Light mode'}
          </span>
        )}
      </button>

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
