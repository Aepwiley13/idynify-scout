/**
 * BottomNav — mobile section navigation for the module you are in.
 *
 * It used to list MODULES: Scout · Hunter · Sniper · Basecamp · More. That is
 * the hamburger's job, so global navigation appeared in two places, and every
 * module compensated by rendering a horizontal strip of its own sections just
 * under the top bar — putting module navigation in the one place a phone user's
 * thumb cannot comfortably reach.
 *
 * Now the bar changes with the module. Inside Hunter it is Blitz · All People ·
 * Companies · Follow Up. Inside Scout it is Daily · Saved · People · Scout+.
 * The module strips are gone, and the hamburger is the only place modules are
 * listed.
 *
 * The active item takes the module's colour, so which workspace you are in is
 * legible without reading a word.
 *
 * On Mission Control, Settings, and anything with no module sections, it falls
 * back to the global module list — see the note in constants/mobileNavigation.
 *
 * Thumb-zone optimised: 56px bar height + iOS safe-area-inset-bottom padding.
 */
import { useNavigate, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { resolveModule } from '../../constants/navigationModel';
import { bottomNavFor, moduleColorFor, GLOBAL_BOTTOM_NAV } from '../../constants/mobileNavigation';
import './BottomNav.css';

/**
 * Which item is active, given where we are.
 *
 * Compares against the item's full destination: `?tab=` modules match on the
 * tab param, path-based ones (Recon) on the pathname. Longest pathname match
 * wins so /recon/messaging does not also light up /recon's Overview.
 */
function activeIdFor(items, location) {
  const tab = new URLSearchParams(location.search).get('tab');

  let best = null;
  for (const item of items) {
    const [path, query] = item.to.split('?');
    const itemTab = query ? new URLSearchParams(query).get('tab') : null;

    if (itemTab) {
      if (location.pathname === path && tab === itemTab) return item.id;
      continue;
    }

    if (location.pathname === path || location.pathname.startsWith(path + '/')) {
      if (!best || path.length > best.path.length) best = { id: item.id, path };
    }
  }
  return best?.id ?? null;
}

/**
 * What a bare module URL means on the bottom bar.
 *
 * /hunter with no ?tab= renders Hunter's default view, so the bar has to light
 * the item that matches it rather than lighting nothing — an unlit bar reads as
 * "you are nowhere".
 */
const DEFAULT_ITEM = {
  scout: 'daily',
  hunter: 'all',
  sniper: 'people',
  basecamp: 'people',
  reinforcements: 'dashboard',
  fallback: 'comeback',
  'command-center': 'people',
};

export default function BottomNav({ onOpenMore, moreButtonRef }) {
  const navigate = useNavigate();
  const location = useLocation();

  const module = resolveModule(location.pathname);
  const config = bottomNavFor(module.id);

  const items = config ? config.primary : GLOBAL_BOTTOM_NAV;
  const hasOverflow = Boolean(config?.overflow?.length);
  const accent = moduleColorFor(module.id);

  let activeId = activeIdFor(items, location);
  if (config && !activeId && !location.search) {
    // Bare module URL — light whichever item is the module's default view.
    const fallback = DEFAULT_ITEM[module.id];
    if (items.some(i => i.id === fallback)) activeId = fallback;
  }

  // With no module config the bar lists modules, so "active" means the module
  // you are in rather than the view.
  if (!config) activeId = items.some(i => i.id === module.id) ? module.id : null;

  const cells = [...items];
  if (hasOverflow || !config) {
    cells.push({ id: '__more', label: 'More', Icon: MoreHorizontal, to: null });
  }

  const handleTap = (item) => {
    if (item.id === '__more') { onOpenMore?.(); return; }
    navigate(item.to);
  };

  return (
    <nav
      className="bottom-nav"
      aria-label={config ? `${module.label} sections` : 'Main navigation'}
    >
      {cells.map((item) => {
        const active = activeId === item.id;
        const Icon = item.Icon;
        return (
          <button
            key={item.id}
            ref={item.id === '__more' ? moreButtonRef : null}
            className={`bottom-nav-item ${active ? 'active' : ''}`}
            onClick={() => handleTap(item)}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            // Inline rather than a class: the accent is per module, and nine
            // colour classes to express one value is nine chances to drift.
            style={active ? { color: accent } : undefined}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} />
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
