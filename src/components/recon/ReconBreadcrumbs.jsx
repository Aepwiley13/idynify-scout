import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

/**
 * Dynamic breadcrumbs for all RECON pages.
 *
 * Hierarchy: Mission Control > RECON > [Module] > [Section]
 *
 * Automatically resolves the current page from the route,
 * including module names and section titles when available.
 */

const MODULE_LABELS = {
  'icp-intelligence': 'ICP Intelligence',
  'messaging': 'Messaging & Voice',
  'objections': 'Objections & Constraints',
  'competitive-intel': 'Competitive Intel',
  'buying-signals': 'Buying Signals',
  'barry-training': 'Barry Training'
};

const SECTION_TO_MODULE = {
  1: 'icp-intelligence',
  2: 'icp-intelligence',
  3: 'icp-intelligence',
  4: 'icp-intelligence',
  5: 'objections',
  6: 'objections',
  7: 'buying-signals',
  8: 'competitive-intel',
  9: 'messaging',
  10: 'buying-signals'
};

export default function ReconBreadcrumbs({ sectionTitle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  const crumbs = [];

  // Level 0: Mission Control (always present)
  crumbs.push({
    label: 'Mission Control',
    path: '/mission-control-v2',
    icon: Home
  });

  // Level 1: RECON (always present on RECON pages)
  crumbs.push({
    label: 'RECON',
    path: '/recon'
  });

  // Level 2: Module page (if on a module or section page)
  const moduleMatch = pathname.match(/^\/recon\/([a-z-]+)$/);
  const sectionMatch = pathname.match(/^\/recon\/section\/(\d+)$/);

  if (moduleMatch) {
    const moduleId = moduleMatch[1];
    const moduleLabel = MODULE_LABELS[moduleId];
    if (moduleLabel) {
      crumbs.push({
        label: moduleLabel,
        path: pathname,
        current: true
      });
    }
  }

  if (sectionMatch) {
    const sectionId = parseInt(sectionMatch[1]);
    const parentModuleId = SECTION_TO_MODULE[sectionId];
    const parentModuleLabel = MODULE_LABELS[parentModuleId];

    if (parentModuleLabel) {
      crumbs.push({
        label: parentModuleLabel,
        path: `/recon/${parentModuleId}`
      });
    }

    crumbs.push({
      label: sectionTitle || `Section ${sectionId}`,
      path: pathname,
      current: true
    });
  }

  // If we're on /recon exactly (overview), mark it as current
  if (pathname === '/recon') {
    crumbs[crumbs.length - 1].current = true;
  }

  // If we're on /recon/barry-training
  if (pathname === '/recon/barry-training') {
    crumbs.push({
      label: 'Barry Training',
      path: pathname,
      current: true
    });
  }

  return (
    <nav
      className="flex items-center gap-1 text-xs mb-4"
      aria-label="Breadcrumb"
    >
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        const IconComponent = crumb.icon;

        return (
          <span key={crumb.path + index} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight
                size={12}
                className="text-gray-300 flex-shrink-0"
                aria-hidden="true"
              />
            )}
            {isLast ? (
              <span
                className="font-semibold text-gray-900"
                aria-current="page"
              >
                {IconComponent && <IconComponent size={12} className="inline mr-1 text-gray-400" />}
                {crumb.label}
              </span>
            ) : (
              <button
                onClick={() => navigate(crumb.path)}
                className="text-gray-500 hover:text-purple-600 transition-colors font-medium"
                tabIndex={0}
              >
                {IconComponent && <IconComponent size={12} className="inline mr-1" />}
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
