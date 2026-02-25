/**
 * BottomNav.jsx — Mobile bottom navigation bar.
 *
 * Renders on screens ≤768px only. Provides one-tap access to the five primary
 * destinations: RECON, Discoveries (Scout), Hunter, Game Mode, and a More
 * sheet for sub-items. Replaces the 4-tap hamburger → sidebar → item → close
 * flow on mobile.
 *
 * Thumb-zone optimised: 56px bar height + iOS safe-area-inset-bottom padding.
 * Primary actions sit in the bottom third of the screen where thumbs rest.
 */
import { useNavigate, useLocation } from 'react-router-dom';
import { Brain, Star, Target, Zap, MoreHorizontal } from 'lucide-react';
import './BottomNav.css';

const NAV_ITEMS = [
  {
    id: 'recon',
    label: 'RECON',
    icon: Brain,
    path: '/recon',
  },
  {
    id: 'scout',
    label: 'Discover',
    icon: Star,
    path: '/scout',
    search: '?tab=daily-leads',
  },
  {
    id: 'hunter',
    label: 'Hunter',
    icon: Target,
    path: '/hunter',
    search: '?tab=dashboard',
  },
  {
    id: 'game',
    label: 'Game',
    icon: Zap,
    path: '/scout/game',
  },
  {
    id: 'more',
    label: 'More',
    icon: MoreHorizontal,
    path: null, // opens sheet
  },
];

export default function BottomNav({ onOpenMore }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item) => {
    if (!item.path) return false;
    if (item.id === 'scout') {
      return location.pathname === '/scout' || location.pathname.startsWith('/scout/') && item.id !== 'game';
    }
    if (item.id === 'game') return location.pathname === '/scout/game';
    if (item.id === 'recon') return location.pathname === '/recon' || location.pathname.startsWith('/recon/');
    if (item.id === 'hunter') return location.pathname === '/hunter' || location.pathname.startsWith('/hunter/');
    return location.pathname === item.path;
  };

  const handleTap = (item) => {
    if (item.id === 'more') {
      onOpenMore?.();
      return;
    }
    const dest = item.search ? `${item.path}${item.search}` : item.path;
    navigate(dest);
  };

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item);
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`bottom-nav-item ${active ? 'active' : ''}`}
            onClick={() => handleTap(item)}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} />
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
