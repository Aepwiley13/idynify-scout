/**
 * BottomNav.jsx — Mobile bottom navigation bar.
 *
 * Primary tabs: Scout, Hunter, Sniper, Basecamp + More sheet for everything else
 * (Recon, Game, Reinforcements, etc.).
 *
 * Thumb-zone optimised: 56px bar height + iOS safe-area-inset-bottom padding.
 */
import { useNavigate, useLocation } from 'react-router-dom';
import { Star, Target, Crosshair, Tent, MoreHorizontal } from 'lucide-react';
import './BottomNav.css';

const NAV_ITEMS = [
  {
    id: 'scout',
    label: 'Scout',
    icon: Star,
    path: '/scout',
    search: '?tab=all-leads',
  },
  {
    id: 'hunter',
    label: 'Hunter',
    icon: Target,
    path: '/hunter',
    search: '?tab=dashboard',
  },
  {
    id: 'sniper',
    label: 'Sniper',
    icon: Crosshair,
    path: '/sniper',
  },
  {
    id: 'basecamp',
    label: 'Basecamp',
    icon: Tent,
    path: '/basecamp',
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
      return (location.pathname === '/scout' || location.pathname.startsWith('/scout/')) &&
        !location.pathname.startsWith('/scout/game');
    }
    if (item.id === 'hunter')   return location.pathname === '/hunter'   || location.pathname.startsWith('/hunter/');
    if (item.id === 'sniper')   return location.pathname === '/sniper'   || location.pathname.startsWith('/sniper/');
    if (item.id === 'basecamp') return location.pathname === '/basecamp' || location.pathname.startsWith('/basecamp/');
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
