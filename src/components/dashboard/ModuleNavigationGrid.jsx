import { CommandCenterIcon, ReconIcon, ScoutIcon, HunterIcon, SniperIcon, HomebaseIcon, ReinforcementsIcon, FallbackIcon } from './ModuleIcons';

/**
 * ModuleNavigationGrid — 7-card module launcher in two rows + footer card.
 *
 * Row 1: Scout, Hunter, Sniper
 * Row 2: Homebase, Command Center, Recon
 * Row 3: Reinforcements (full width)
 *
 * Props:
 *   stats        — { scoutCompanies, scoutContacts, reconCompletion, hunterMissions }
 *   onScoutClick — () => void   (handles Scout deep-link logic)
 *   onNavigate   — (route: string) => void
 */
export default function ModuleNavigationGrid({ stats = {}, onScoutClick, onNavigate }) {
  const {
    scoutCompanies = 0,
    scoutContacts = 0,
    reconCompletion = 0,
    hunterMissions = 0,
  } = stats;

  // ── Module definitions ──────────────────────────────────────────────

  const modules = [
    // ── Row 1: Scout, Hunter, Sniper ──
    {
      id: 'scout',
      label: 'SCOUT',
      description: 'Discover & track ideal customers',
      stat: scoutContacts > 0
        ? `${scoutContacts} contact${scoutContacts !== 1 ? 's' : ''} tracked`
        : scoutCompanies > 0
          ? `${scoutCompanies} compan${scoutCompanies !== 1 ? 'ies' : 'y'} saved`
          : 'No contacts yet — start scouting',
      badge: scoutContacts > 0
        ? { label: 'ACTIVE', color: 'green' }
        : scoutCompanies > 0
          ? { label: 'IN PROGRESS', color: 'amber' }
          : null,
      accent: '#06b6d4',
      borderClass: 'border-cyan-500/50 hover:border-cyan-400',
      glowStyle: { boxShadow: '0 0 32px rgba(6, 182, 212, 0.25), inset 0 0 24px rgba(6, 182, 212, 0.04)' },
      gradientClass: 'from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500',
      shadowClass: 'shadow-cyan-500/40',
      bgGradient: 'from-cyan-500/10 to-blue-600/5',
      icon: <ScoutIcon />,
      btnLabel: 'Enter Scout →',
      onClick: onScoutClick,
    },
    {
      id: 'hunter',
      label: 'HUNTER',
      description: 'Automated outreach campaigns',
      stat: hunterMissions > 0
        ? `${hunterMissions} active mission${hunterMissions !== 1 ? 's' : ''}`
        : 'No missions running',
      badge: hunterMissions > 0
        ? { label: 'RUNNING', color: 'green' }
        : { label: 'IDLE', color: 'amber' },
      accent: '#ec4899',
      borderClass: 'border-pink-500/50 hover:border-pink-400',
      glowStyle: { boxShadow: '0 0 32px rgba(236, 72, 153, 0.25), inset 0 0 24px rgba(236, 72, 153, 0.04)' },
      gradientClass: 'from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500',
      shadowClass: 'shadow-pink-500/40',
      bgGradient: 'from-pink-500/10 to-purple-600/5',
      icon: <HunterIcon />,
      btnLabel: 'Launch Hunter →',
      onClick: () => onNavigate('/hunter'),
    },
    {
      id: 'sniper',
      label: 'SNIPER',
      description: 'Post-demo conversion pipeline',
      stat: 'Convert warm prospects to customers',
      badge: null,
      accent: '#14b8a6',
      borderClass: 'border-teal-500/40 hover:border-teal-400',
      glowStyle: { boxShadow: '0 0 18px rgba(20, 184, 166, 0.2)' },
      gradientClass: 'from-teal-500 to-teal-700 hover:from-teal-400 hover:to-teal-600',
      shadowClass: 'shadow-teal-500/40',
      bgGradient: 'from-teal-900/10 to-transparent',
      icon: <SniperIcon />,
      btnLabel: 'Open Sniper →',
      onClick: () => onNavigate('/sniper'),
    },

    // ── Row 2: Homebase, Command Center, Recon ──
    {
      id: 'homebase',
      label: 'HOMEBASE',
      description: 'Your mission command & settings',
      stat: 'Configure your base of operations',
      badge: null,
      accent: '#22c55e',
      borderClass: 'border-green-500/50 hover:border-green-400',
      glowStyle: { boxShadow: '0 0 32px rgba(34, 197, 94, 0.2), inset 0 0 24px rgba(34, 197, 94, 0.04)' },
      gradientClass: 'from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500',
      shadowClass: 'shadow-green-500/40',
      bgGradient: 'from-green-500/10 to-emerald-600/5',
      icon: <HomebaseIcon />,
      btnLabel: 'Enter Homebase →',
      onClick: () => onNavigate('/basecamp'),
    },
    {
      id: 'command-center',
      label: 'COMMAND CENTER',
      description: 'Your people & relationship hub',
      stat: 'Manage contacts & connections',
      badge: null,
      accent: '#06b6d4',
      borderClass: 'border-cyan-500/50 hover:border-cyan-400',
      glowStyle: { boxShadow: '0 0 32px rgba(6, 182, 212, 0.25), inset 0 0 24px rgba(6, 182, 212, 0.04)' },
      gradientClass: 'from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500',
      shadowClass: 'shadow-cyan-500/40',
      bgGradient: 'from-cyan-500/10 to-blue-600/5',
      icon: <CommandCenterIcon />,
      btnLabel: 'Enter Command Center →',
      onClick: () => onNavigate('/command-center'),
    },
    {
      id: 'recon',
      label: 'RECON',
      description: 'Train your AI assistant',
      stat: reconCompletion >= 100
        ? 'Fully trained'
        : reconCompletion > 0
          ? `${reconCompletion}% training complete`
          : 'Training not started',
      badge: reconCompletion >= 100
        ? { label: 'COMPLETE', color: 'green' }
        : reconCompletion > 0
          ? { label: `${reconCompletion}%`, color: 'amber' }
          : { label: 'NOT STARTED', color: 'red' },
      accent: '#a855f7',
      borderClass: 'border-purple-500/50 hover:border-purple-400',
      glowStyle: { boxShadow: '0 0 32px rgba(168, 85, 247, 0.25), inset 0 0 24px rgba(168, 85, 247, 0.04)' },
      gradientClass: 'from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500',
      shadowClass: 'shadow-purple-500/40',
      bgGradient: 'from-purple-500/10 to-pink-600/5',
      icon: <ReconIcon />,
      btnLabel: 'Train AI →',
      onClick: () => onNavigate('/mission-control-v2/recon'),
    },
  ];

  // Fallback is full-width at the top
  const fallback = {
    id: 'fallback',
    label: 'FALLBACK',
    description: 'Closed lost companies & contacts — re-engage dormant pipeline and recover lost deals',
    stat: 'Review closed lost accounts and contacts ready for a second chance',
    badge: null,
    accent: '#ef4444',
    borderClass: 'border-red-500/50 hover:border-red-400',
    glowStyle: { boxShadow: '0 0 32px rgba(239, 68, 68, 0.2), inset 0 0 24px rgba(239, 68, 68, 0.04)' },
    gradientClass: 'from-red-500 to-rose-700 hover:from-red-400 hover:to-rose-600',
    shadowClass: 'shadow-red-500/40',
    bgGradient: 'from-red-500/10 to-rose-700/5',
    icon: <FallbackIcon />,
    btnLabel: 'Enter Fallback →',
    onClick: () => onNavigate('/fallback'),
  };

  // Reinforcements is full-width at the bottom
  const reinforcements = {
    id: 'reinforcements',
    label: 'REINFORCEMENTS',
    description: 'Referrals & network intelligence — activate your referral network',
    stat: 'Call in your network to accelerate pipeline growth',
    badge: null,
    accent: '#f97316',
    borderClass: 'border-orange-500/50 hover:border-orange-400',
    glowStyle: { boxShadow: '0 0 32px rgba(249, 115, 22, 0.2), inset 0 0 24px rgba(249, 115, 22, 0.04)' },
    gradientClass: 'from-orange-500 to-red-600 hover:from-orange-400 hover:to-red-500',
    shadowClass: 'shadow-orange-500/40',
    bgGradient: 'from-orange-500/10 to-red-600/5',
    icon: <ReinforcementsIcon />,
    btnLabel: 'Call Reinforcements →',
    onClick: () => onNavigate('/reinforcements'),
  };

  return (
    <section className="mb-12" aria-label="Module navigation">
      {/* Section heading */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <div className="h-px w-24 bg-gradient-to-r from-transparent to-cyan-500/60" />
        <h2 className="text-xl font-mono font-bold text-white tracking-widest uppercase">
          Modules
        </h2>
        <div className="h-px w-24 bg-gradient-to-l from-transparent to-cyan-500/60" />
      </div>

      {/* 3-col grid: rows 1 & 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
        {modules.map((mod) => (
          <ActiveModuleCard key={mod.id} mod={mod} />
        ))}
      </div>

      {/* Reinforcements — full-width */}
      <div className="mb-5">
        <ActiveModuleCard mod={reinforcements} fullWidth />
      </div>

      {/* Fallback — full-width at bottom */}
      <ActiveModuleCard mod={fallback} fullWidth />
    </section>
  );
}

/* ── Active module card ───────────────────────────────────────────────── */

function ActiveModuleCard({ mod, fullWidth = false }) {
  return (
    <div
      onClick={mod.onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && mod.onClick?.()}
      aria-label={`Open ${mod.label}`}
      className={`
        group cursor-pointer
        bg-black/50 backdrop-blur-xl rounded-2xl
        border-2 ${mod.borderClass}
        transition-all duration-300
        hover:scale-[1.02] active:scale-[0.99]
        relative overflow-hidden
        flex ${fullWidth ? 'flex-col md:flex-row md:items-center md:gap-6' : 'flex-col'}
        select-none
        p-6
      `}
      style={mod.glowStyle}
    >
      {/* Hover glow overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br ${mod.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-2xl`} />

      {/* Status badge — top-right, only rendered when present */}
      {mod.badge && (
        <div className="absolute top-4 right-4">
          <StatusBadge badge={mod.badge} />
        </div>
      )}

      {/* Icon */}
      <div className={`${fullWidth ? 'shrink-0 mb-4 md:mb-0' : 'mb-4'} h-14 flex items-center`}>
        {mod.icon}
      </div>

      {/* Text content */}
      <div className={fullWidth ? 'flex-1 min-w-0' : ''}>
        <h3 className="font-mono text-2xl font-bold text-white mb-1 tracking-wide">
          {mod.label}
        </h3>
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          {mod.description}
        </p>

        {/* Key stat */}
        <div
          className="rounded-xl p-4 mb-5 border"
          style={{
            background: `${mod.accent}10`,
            borderColor: `${mod.accent}25`,
          }}
        >
          <p
            className="font-mono text-sm font-semibold leading-snug"
            style={{ color: mod.accent }}
          >
            {mod.stat}
          </p>
        </div>
      </div>

      {/* Full-width CTA */}
      <button
        className={`
          ${fullWidth ? 'shrink-0 w-full md:w-auto md:px-8' : 'w-full'} py-3 rounded-xl
          bg-gradient-to-r ${mod.gradientClass}
          text-white font-mono text-sm font-bold
          transition-all shadow-lg ${mod.shadowClass}
        `}
        tabIndex={-1}
        aria-hidden="true"
      >
        {mod.btnLabel}
      </button>
    </div>
  );
}

/* ── Status badge ─────────────────────────────────────────────────────── */

function StatusBadge({ badge }) {
  const styles = {
    green: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
    amber: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
    red:   'bg-red-500/20 text-red-400 border border-red-500/40',
  };
  return (
    <span className={`text-[10px] px-2.5 py-1 rounded-full font-mono font-bold ${styles[badge.color] || styles.green}`}>
      {badge.label}
    </span>
  );
}

