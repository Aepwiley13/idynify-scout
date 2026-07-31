/**
 * ModuleSubNav — Layer 2. The module sub-nav panel.
 *
 * Scout's panel is the approved reference style, so this component IS that
 * panel, lifted out of ScoutMain unchanged. Every module migrating into the
 * shell renders this rather than hand-building a panel that looks nearly the
 * same — which is how nine copies of the module rail diverged before the shell
 * migration, and how "restyle to match Scout" would quietly drift again.
 *
 * The style is therefore not a convention to follow. It is a component to use.
 *
 * Migrating a module:
 *
 *   <ModuleSubNav
 *     title="HUNTER"
 *     tagline="Engage and follow up"
 *     items={HUNTER_ITEMS}          // { id, label, desc, Icon }
 *     activeId={activeTab}
 *     onSelect={switchTab}
 *     storageKey="hunter_subnav_collapsed"
 *   />
 *
 * Keep the module's existing sections and descriptions exactly as they are —
 * only the visual formatting comes from here.
 *
 * The parent must be `position: relative`: the expand affordance is pinned to
 * the content edge while the panel is collapsed.
 */

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './ModuleSubNav.css';

export default function ModuleSubNav({
  title,
  tagline,
  items,
  activeId,
  onSelect,
  storageKey,
}) {
  // Collapse state is per module and remembered, so collapsing Hunter's panel
  // does not collapse Scout's and each returns how the user left it.
  const [open, setOpen] = useState(() => {
    if (!storageKey) return true;
    try {
      return localStorage.getItem(storageKey) !== 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, open ? 'false' : 'true');
    } catch { /* storage disabled */ }
  }, [open, storageKey]);

  return (
    <>
      <aside
        className={`module-subnav ${open ? '' : 'collapsed'}`}
        aria-label={`${title} sections`}
      >
        <div className="module-subnav-inner">
          <div className="module-subnav-header">
            <div className="module-subnav-heading">
              <div className="module-subnav-title">{title}</div>
              {tagline && <div className="module-subnav-tagline">{tagline}</div>}
            </div>
            <button
              type="button"
              className="module-subnav-toggle"
              onClick={() => setOpen(false)}
              aria-label={`Collapse ${title} sections`}
              title="Collapse"
            >
              <ChevronLeft size={12} aria-hidden="true" />
            </button>
          </div>

          <div className="module-subnav-items">
            {items.map(item => {
              const active = activeId === item.id;
              const Icon = item.Icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`module-subnav-item ${active ? 'active' : ''}`}
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? 'true' : undefined}
                >
                  {Icon && <Icon size={13} aria-hidden="true" />}
                  <span className="module-subnav-item-text">
                    <span className="module-subnav-item-label">{item.label}</span>
                    {item.desc && (
                      <span className="module-subnav-item-desc">{item.desc}</span>
                    )}
                  </span>
                  {/* Optional count. Only Command Center uses one today (active
                      missions), and it is existing content — the panel has to
                      be able to carry it, or migrating the module would mean
                      dropping something it showed. */}
                  {item.badge ? (
                    <span className="module-subnav-item-badge">{item.badge}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {!open && (
        <button
          type="button"
          className="module-subnav-expand"
          onClick={() => setOpen(true)}
          aria-label={`Expand ${title} sections`}
          title="Expand"
        >
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
