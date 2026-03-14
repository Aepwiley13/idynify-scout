/**
 * BarryTrigger — Global bottom-left Barry icon.
 *
 * Renders on all routes EXCEPT Mission Control (/mission-control-v2).
 * Opens BarryChat drawer. Module and context are inferred from current route.
 *
 * Placement: rendered once inside App.jsx, outside the Routes tree,
 * so it persists across navigation without remounting.
 */

import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import BarryChat, { MODULE_CONFIG } from './BarryChat';
import { useBarryContext } from '../../context/barryContextStore';

// Route → module mapping
const ROUTE_MODULE_MAP = [
  { prefix: '/recon',           module: 'recon'           },
  { prefix: '/scout',           module: 'scout'           },
  { prefix: '/hunter',          module: 'hunter'          },
  { prefix: '/sniper',          module: 'sniper'          },
  { prefix: '/people',          module: 'command-center'  },
  { prefix: '/basecamp',        module: 'homebase'        },
  { prefix: '/reinforcements',  module: 'reinforcements'  },
  { prefix: '/fallback',        module: 'fallback'        },
];

// Routes where BarryTrigger is hidden
const HIDDEN_ROUTES = ['/mission-control-v2', '/login', '/signup', '/checkout', '/onboarding'];

function getModule(pathname) {
  for (const { prefix, module } of ROUTE_MODULE_MAP) {
    if (pathname.startsWith(prefix)) return module;
  }
  return 'default';
}

export default function BarryTrigger() {
  const location = useLocation();
  const T = useT();
  const [open, setOpen] = useState(false);
  const barryCtx = useBarryContext();

  // Hide on Mission Control + auth/payment routes
  const hidden = HIDDEN_ROUTES.some(r => location.pathname.startsWith(r));
  if (hidden) return null;

  const module = getModule(location.pathname);
  const cfg = MODULE_CONFIG[module] || MODULE_CONFIG.default;
  const chakra = cfg.color;

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Ask Barry"
        aria-label="Open Barry chat"
        style={{
          position: 'fixed',
          bottom: 20,
          left: 20,
          zIndex: 1990,
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: `2px solid ${chakra}60`,
          background: `linear-gradient(135deg,${BRAND.pink}cc,${chakra}cc)`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: `0 4px 20px ${chakra}50, 0 0 0 ${open ? '4px' : '0px'} ${chakra}30`,
          transition: 'border-color 0.3s ease, box-shadow 0.3s ease, transform 0.15s',
          transform: open ? 'scale(0.94)' : 'scale(1)',
          padding: 0,
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <img
          src={ASSETS.barryAvatar}
          alt="Barry"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
        />
        {/* Module chakra badge */}
        <div style={{
          position: 'absolute',
          bottom: 0, right: 0,
          width: 14, height: 14,
          borderRadius: '50%',
          background: chakra,
          border: `2px solid ${T.appBg || '#000'}`,
        }} />
      </button>

      {/* Drawer */}
      {open && (
        <BarryChat
          module={module}
          context={barryCtx}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
