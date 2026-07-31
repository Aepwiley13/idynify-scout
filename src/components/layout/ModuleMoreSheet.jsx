/**
 * ModuleMoreSheet — overflow sections for the module you are in.
 *
 * There are two "More" surfaces on mobile now, and they must never be mistaken
 * for each other:
 *
 *   ≡  hamburger        → the platform. Modules, grouped. A full-height LEFT
 *                         drawer, neutral, with the wordmark at the top.
 *   ⋯  bottom bar More  → this. Sections of the CURRENT module only. A short
 *                         sheet from the BOTTOM, titled with the module name
 *                         and tinted with the module's colour.
 *
 * They differ in edge, height, title and colour, so the answer to "which one am
 * I in" is available before reading anything. A user who opens this expecting
 * the module list is one tap from being lost.
 *
 * This is a LIST, not the tile grid the global sheet uses. Sections have longer
 * names than modules ("Competitive Intel", "Today's Actions") and there can be
 * five of them; tiles would either truncate or wrap into a ragged grid.
 */

import { X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { resolveModule } from '../../constants/navigationModel';
import { bottomNavFor, moduleColorFor } from '../../constants/mobileNavigation';
import './ModuleMoreSheet.css';

export default function ModuleMoreSheet({ isOpen, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();

  const module = resolveModule(location.pathname);
  const config = bottomNavFor(module.id);
  const items = config?.overflow || [];

  if (!isOpen || items.length === 0) return null;

  const accent = moduleColorFor(module.id);

  return (
    <div className="module-more-backdrop" onClick={onClose}>
      <div
        className="module-more-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`More ${module.label} sections`}
      >
        <div className="module-more-handle" />

        <div className="module-more-header">
          {/* Named for the module, not "All Modules" — this sheet contains no
              modules, and the title is the fastest way to say so. */}
          <span className="module-more-title" style={{ color: accent }}>
            {module.label}
          </span>
          <button className="module-more-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="module-more-list">
          {items.map(item => {
            const Icon = item.Icon;
            return (
              <button
                key={item.id}
                className="module-more-item"
                onClick={() => { navigate(item.to); onClose(); }}
              >
                <Icon size={18} style={{ color: accent }} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
