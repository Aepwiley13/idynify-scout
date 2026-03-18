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
  AlertTriangle,
  CalendarCheck,
  Inbox,
  Sparkles,
  BookOpen,
  Zap,
  LayoutDashboard
} from 'lucide-react';
import { useThemeCtx } from '../../theme/ThemeContext';
import { THEMES, ASSETS, BRAND } from '../../theme/tokens';
import BarryChat, { MODULE_CONFIG } from '../barry/BarryChat';
import { useBarryContext } from '../../context/barryContextStore';
import './Sidebar.css';

// Route → module mapping for Barry context
const SIDEBAR_ROUTE_MODULE_MAP = [
  { prefix: '/recon',          module: 'recon'          },
  { prefix: '/scout',          module: 'scout'          },
  { prefix: '/hunter',         module: 'hunter'         },
  { prefix: '/sniper',         module: 'sniper'         },
  { prefix: '/command-center', module: 'command-center' },
  { prefix: '/people',         module: 'command-center' },
  { prefix: '/basecamp',       module: 'homebase'       },
  { prefix: '/reinforcements', module: 'reinforcements' },
];

function getSidebarModule(pathname) {
  for (const { prefix, module } of SIDEBAR_ROUTE_MODULE_MAP) {
    if (pathname.startsWith(prefix)) return module;
  }
  return 'default';
}

const Sidebar = ({ mobileMenuOpen = false, onCloseMobileMenu = () => {} }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { themeId, setThemeId } = useThemeCtx();
  const isLightTheme = !THEMES[themeId]?.isDark;
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [barryOpen, setBarryOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    people: true,
    recon: true,
    scout: true,
    hunter: true,
    sniper: true,
    basecamp: true,
    reinforcements: true,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const barryCtx = useBarryContext();
  const barryModule = getSidebarModule(location.pathname);
  const barryCfg = MODULE_CONFIG[barryModule] || MODULE_CONFIG.default;

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
      const urlTab = new URLSearchParams(location.search).get('tab') || 'all';
      return location.pathname === '/hunter' && urlTab === tabName;
    }
    if (path === '/command-center' && tabName) {
      const urlTab = new URLSearchParams(location.search).get('tab') || 'people';
      return location.pathname === '/command-center' && urlTab === tabName;
    }
    if (path === '/sniper' && tabName) {
      const urlTab = new URLSearchParams(location.search).get('tab') || 'people';
      return location.pathname === '/sniper' && urlTab === tabName;
    }
    return location.pathname === path;
  };

  const isPathActive = (path) => {
    return location.pathname.startsWith(path);
  };

  const peopleItems = [
    {
      icon: Users,
      label: 'People',
      sublabel: 'Full contacts roster — all view',
      path: '/command-center',
      state: { activeTab: 'people' },
      isPrimary: true
    },
    {
      icon: Building2,
      label: 'Companies',
      sublabel: 'Full accounts roster — all view',
      path: '/command-center',
      state: { activeTab: 'companies' }
    },
    {
      icon: Zap,
      label: 'Missions',
      sublabel: 'Create and manage campaigns',
      path: '/command-center',
      state: { activeTab: 'missions' }
    },
    {
      icon: Crosshair,
      label: 'Weapons',
      sublabel: 'Channel selector, message builder',
      path: '/command-center',
      state: { activeTab: 'weapons' }
    },
    {
      icon: Package,
      label: 'Arsenal',
      sublabel: 'Saved message templates library',
      path: '/command-center',
      state: { activeTab: 'arsenal' }
    },
    {
      icon: BarChart3,
      label: 'Outcomes',
      sublabel: 'Mission performance analytics',
      path: '/command-center',
      state: { activeTab: 'outcomes' }
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
      icon: Users,
      label: 'People',
      sublabel: 'My Leads',
      path: '/scout',
      state: { activeTab: 'all-leads' },
      isPrimary: true
    },
    {
      icon: Star,
      label: 'Daily Discoveries',
      sublabel: 'Review Queue',
      path: '/scout',
      state: { activeTab: 'daily-leads' }
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
      label: 'All People',
      sublabel: 'Engagement card feed — work your board',
      path: '/hunter',
      state: { activeTab: 'all' },
      isPrimary: true
    },
    {
      icon: AlertTriangle,
      label: 'Follow Up Now',
      sublabel: 'Overdue engagement queue',
      path: '/hunter',
      state: { activeTab: 'followup' }
    },
    {
      icon: CalendarCheck,
      label: "Today's Actions",
      sublabel: 'Due follow-ups & priority contacts',
      path: '/hunter',
      state: { activeTab: 'today' }
    },
    {
      icon: Inbox,
      label: 'Replied',
      sublabel: 'Contacts who have responded',
      path: '/hunter',
      state: { activeTab: 'replied' }
    },
    {
      icon: Zap,
      label: 'Active',
      sublabel: 'Currently in a sequence',
      path: '/hunter',
      state: { activeTab: 'active' }
    },
    {
      icon: Sparkles,
      label: 'New (Unengaged)',
      sublabel: 'Fresh contacts, not yet touched',
      path: '/hunter',
      state: { activeTab: 'new' }
    },
    {
      icon: Settings,
      label: 'Settings',
      path: '/settings',
      isSettings: true
    }
  ];

  const sniperItems = [
    {
      icon: Users,
      label: 'People',
      sublabel: 'Add to pipeline',
      path: '/sniper',
      state: { activeTab: 'people' },
      isPrimary: true
    },
    {
      icon: Building2,
      label: 'Companies',
      sublabel: 'Saved companies',
      path: '/sniper',
      state: { activeTab: 'companies' }
    },
    {
      icon: Target,
      label: 'Pipeline',
      sublabel: 'Conversion board',
      path: '/sniper',
      state: { activeTab: 'pipeline' }
    },
    {
      icon: Crosshair,
      label: 'Targets',
      sublabel: 'All contacts',
      path: '/sniper',
      state: { activeTab: 'targets' }
    },
    {
      icon: Activity,
      label: 'Touches',
      sublabel: 'Follow-up log',
      path: '/sniper',
      state: { activeTab: 'touches' }
    },
    {
      icon: BookOpen,
      label: 'Playbooks',
      sublabel: 'Conversion sequences',
      path: '/sniper',
      state: { activeTab: 'playbooks' }
    },
    {
      icon: BarChart3,
      label: 'Outcomes',
      sublabel: 'Win/loss analytics',
      path: '/sniper',
      state: { activeTab: 'outcomes' }
    }
  ];

  const basecampItems = [
    {
      icon: Home,
      label: 'Basecamp',
      sublabel: 'Mission command',
      path: '/basecamp',
      isPrimary: true
    }
  ];

  const reinforcementsItems = [
    {
      icon: Users,
      label: 'Reinforcements',
      sublabel: 'Referral network',
      path: '/reinforcements',
      isPrimary: true
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
    const pillarActive =
      id === 'people'         ? isPathActive('/command-center') || isPathActive('/people') :
      id === 'recon'          ? isPathActive('/recon') :
      id === 'scout'          ? isPathActive('/scout') :
      id === 'hunter'         ? isPathActive('/hunter') :
      id === 'sniper'         ? isPathActive('/sniper') :
      id === 'basecamp'       ? isPathActive('/basecamp') :
      id === 'reinforcements' ? isPathActive('/reinforcements') :
      false;

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
        {renderPillar('people',         'COMMAND CENTER',  Users,     'pillar-cyan',   peopleItems)}
        {renderPillar('scout',          'SCOUT',           Search,    'pillar-cyan',   scoutItems)}
        {renderPillar('hunter',         'HUNTER',          Crosshair, 'pillar-purple', hunterItems)}
        {renderPillar('sniper',         'SNIPER',          Target,    'pillar-cyan',   sniperItems)}
        {renderPillar('basecamp',       'BASECAMP',        Home,      'pillar-cyan',   basecampItems)}
        {renderPillar('reinforcements', 'REINFORCEMENTS',  Users,     'pillar-purple', reinforcementsItems)}
        {renderPillar('recon',          'RECON',           Brain,     'pillar-purple', reconItems)}
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

      {/* Barry Nav Button */}
      <button
        className={`settings-toggle ${isCollapsed ? 'collapsed' : ''} ${barryOpen ? 'active' : ''}`}
        onClick={() => setBarryOpen(o => !o)}
        title={isCollapsed ? 'Barry AI' : ''}
        aria-label="Open Barry chat"
        style={{ borderColor: barryOpen ? barryCfg.color : undefined, position: 'relative' }}
      >
        <div style={{ position: 'relative', flexShrink: 0, width: 16, height: 16 }}>
          <img
            src={ASSETS.barryAvatar}
            alt="Barry"
            style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
          <div style={{
            position: 'absolute', bottom: -1, right: -1,
            width: 7, height: 7, borderRadius: '50%',
            background: barryCfg.color,
            border: `1.5px solid ${isLightTheme ? '#fff' : '#0d1117'}`,
          }} />
        </div>
        {!isCollapsed && <span className="settings-toggle-label">Barry</span>}
      </button>

      {barryOpen && (
        <BarryChat
          module={barryModule}
          context={barryCtx}
          onClose={() => setBarryOpen(false)}
        />
      )}

      {/* Theme Picker */}
      <div style={{ position: 'relative' }}>
        {/* Panel — opens above the button */}
        {themePanelOpen && (
          <div style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            width: 220,
            background: isLightTheme ? '#ffffff' : '#0d1117',
            border: `1px solid ${isLightTheme ? '#e5e7eb' : 'rgba(0,196,212,0.3)'}`,
            borderRadius: 12,
            padding: '12px 10px 10px',
            boxShadow: isLightTheme
              ? '0 12px 40px rgba(0,0,0,0.15)'
              : '0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
            zIndex: 9999,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 800, letterSpacing: 2.5,
              color: '#00c4d4', marginBottom: 10,
              fontFamily: 'Orbitron, sans-serif', textTransform: 'uppercase',
            }}>
              ⚡ Choose Theme
            </div>
            {/* Standard themes */}
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: isLightTheme ? '#9ca3af' : '#6b7280', marginBottom: 5, textTransform: 'uppercase' }}>
              Standard
            </div>
            {Object.values(THEMES).filter(t => !t.starWars).map(theme => (
              <div
                key={theme.id}
                onClick={() => { setThemeId(theme.id); setThemePanelOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 7px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
                  background: themeId === theme.id ? 'rgba(250,170,32,0.12)' : 'transparent',
                  border: `1px solid ${themeId === theme.id ? 'rgba(250,170,32,0.35)' : 'transparent'}`,
                }}
              >
                <div style={{ width: 26, height: 17, borderRadius: 4, background: theme.swatchBg, border: '1px solid rgba(0,0,0,0.15)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? '#faaa20' : (isLightTheme ? '#374151' : '#e5e7eb') }}>
                  {theme.icon} {theme.label}
                </span>
                {themeId === theme.id && <span style={{ marginLeft: 'auto', color: '#faaa20', fontSize: 11 }}>✓</span>}
              </div>
            ))}
            {/* Star Wars themes */}
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#00c4d4', marginTop: 8, marginBottom: 5, fontFamily: 'Orbitron, sans-serif' }}>
              ⚡ Star Wars
            </div>
            {Object.values(THEMES).filter(t => t.starWars).map(theme => (
              <div
                key={theme.id}
                onClick={() => { setThemeId(theme.id); setThemePanelOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 7px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
                  background: themeId === theme.id ? 'rgba(0,196,212,0.12)' : 'transparent',
                  border: `1px solid ${themeId === theme.id ? 'rgba(0,196,212,0.35)' : 'transparent'}`,
                }}
              >
                <div style={{ width: 26, height: 17, borderRadius: 4, background: theme.swatchBg, border: '1px solid rgba(0,0,0,0.15)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: themeId === theme.id ? '#00c4d4' : (isLightTheme ? '#374151' : '#e5e7eb') }}>
                  {theme.icon} {theme.label}
                </span>
                {themeId === theme.id && <span style={{ marginLeft: 'auto', color: '#00c4d4', fontSize: 11 }}>✓</span>}
              </div>
            ))}
          </div>
        )}

        {/* Trigger button */}
        <button
          className={`theme-toggle ${isCollapsed ? 'collapsed' : ''}`}
          onClick={() => setThemePanelOpen(o => !o)}
          title="Change theme"
          aria-label="Change theme"
        >
          <span className="theme-toggle-icon">⚡</span>
          {!isCollapsed && (
            <span className="theme-toggle-label">Change theme</span>
          )}
        </button>
      </div>

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
