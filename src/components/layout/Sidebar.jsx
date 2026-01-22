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
  Home
} from 'lucide-react';
import './Sidebar.css';

const Sidebar = ({ mobileMenuOpen = false, onCloseMobileMenu = () => {} }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigation = (path, state = {}) => {
    navigate(path, { state });
    // Close mobile menu after navigation
    onCloseMobileMenu();
  };

  const isActive = (path, tabName) => {
    if (path === '/scout' && tabName) {
      return location.pathname === '/scout' &&
             (location.state?.activeTab === tabName ||
              (!location.state?.activeTab && tabName === 'daily-leads'));
    }
    return location.pathname === path;
  };

  const navItems = [
    {
      section: 'DAILY WORK',
      items: [
        {
          icon: Star,
          label: 'Daily Leads',
          sublabel: 'Review Queue',
          path: '/scout',
          state: { activeTab: 'daily-leads' },
          isPrimary: true
        }
      ]
    },
    {
      section: 'DISCOVER',
      items: [
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
        }
      ]
    },
    {
      section: 'MANAGE',
      items: [
        {
          icon: Building2,
          label: 'Companies',
          isParent: true,
          children: [
            {
              label: 'Saved Companies',
              path: '/scout',
              state: { activeTab: 'saved-companies' }
            }
          ]
        },
        {
          icon: Users,
          label: 'People',
          isParent: true,
          children: [
            {
              label: 'All Leads',
              path: '/scout',
              state: { activeTab: 'all-leads' }
            }
          ]
        }
      ]
    },
    {
      section: 'STRATEGY',
      items: [
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
      ]
    }
  ];

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
      {/* Sidebar Header */}
      <div className="sidebar-header">
        {!isCollapsed && (
          <button
            className="mission-control-link"
            onClick={() => navigate('/mission-control-v2')}
          >
            <Home size={20} />
            <span>Mission Control</span>
          </button>
        )}
        {isCollapsed && (
          <button
            className="mission-control-link collapsed"
            onClick={() => navigate('/mission-control-v2')}
            title="Mission Control"
          >
            <Home size={20} />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <nav className="sidebar-nav">
        {navItems.map((section, sectionIndex) => (
          <div key={sectionIndex} className="nav-section">
            {!isCollapsed && (
              <div className="section-label">{section.section}</div>
            )}
            <ul className="nav-items">
              {section.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {item.isParent ? (
                    // Parent item with children
                    <>
                      <div className={`nav-item parent ${isCollapsed ? 'collapsed' : ''}`}>
                        <item.icon size={20} />
                        {!isCollapsed && <span>{item.label}</span>}
                      </div>
                      {!isCollapsed && item.children && (
                        <ul className="nav-children">
                          {item.children.map((child, childIndex) => (
                            <li key={childIndex}>
                              <button
                                className={`nav-item child ${
                                  isActive(child.path, child.state?.activeTab)
                                    ? 'active'
                                    : ''
                                }`}
                                onClick={() => handleNavigation(child.path, child.state)}
                              >
                                <span>{child.label}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    // Regular nav item
                    <button
                      className={`nav-item ${
                        item.isPrimary ? 'primary' : ''
                      } ${
                        isActive(item.path, item.state?.activeTab) ? 'active' : ''
                      } ${isCollapsed ? 'collapsed' : ''}`}
                      onClick={() => handleNavigation(item.path, item.state)}
                      title={isCollapsed ? item.label : ''}
                    >
                      <item.icon size={20} />
                      {!isCollapsed && (
                        <div className="nav-item-content">
                          <span className="nav-item-label">{item.label}</span>
                          {item.sublabel && (
                            <span className="nav-item-sublabel">{item.sublabel}</span>
                          )}
                        </div>
                      )}
                      {item.isPrimary && !isCollapsed && (
                        <div className="primary-badge">★</div>
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <button
        className="collapse-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>
    </div>
  );
};

export default Sidebar;
