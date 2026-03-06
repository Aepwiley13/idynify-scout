/**
 * ModuleNavigationGrid — Prominent 4-card module launcher.
 *
 * Sits above Attention Required on the Mission Control dashboard.
 * Each card shows the module name, one key stat, a status badge, and a
 * full-width launch button. Layout is responsive: 4-col desktop,
 * 2-col tablet, 1-col mobile.
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
    {
      id: 'scout',
      label: 'SCOUT',
      description: 'Discover & track ideal customers',
      // Single key stat
      stat: scoutContacts > 0
        ? `${scoutContacts} contact${scoutContacts !== 1 ? 's' : ''} tracked`
        : scoutCompanies > 0
          ? `${scoutCompanies} compan${scoutCompanies !== 1 ? 'ies' : 'y'} saved`
          : 'No contacts yet — start scouting',
      // Status badge: green=data present, amber=companies but no contacts, none if empty
      badge: scoutContacts > 0
        ? { label: 'ACTIVE', color: 'green' }
        : scoutCompanies > 0
          ? { label: 'IN PROGRESS', color: 'amber' }
          : null,
      // Color theme: cyan
      accent: '#06b6d4',
      accentAlt: '#2563eb',
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
      // Color theme: magenta / pink
      accent: '#ec4899',
      accentAlt: '#9333ea',
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
      // Color theme: purple → pink
      accent: '#a855f7',
      accentAlt: '#ec4899',
      borderClass: 'border-purple-500/50 hover:border-purple-400',
      glowStyle: { boxShadow: '0 0 32px rgba(168, 85, 247, 0.25), inset 0 0 24px rgba(168, 85, 247, 0.04)' },
      gradientClass: 'from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500',
      shadowClass: 'shadow-purple-500/40',
      bgGradient: 'from-purple-500/10 to-pink-600/5',
      icon: <ReconIcon />,
      btnLabel: 'Train AI →',
      onClick: () => onNavigate('/mission-control-v2/recon'),
    },
    {
      id: 'sniper',
      label: 'SNIPER',
      description: 'Post-demo conversion pipeline',
      stat: 'Convert warm prospects to customers',
      badge: null,
      accent: '#14b8a6',
      accentAlt: '#0f766e',
      borderClass: 'border-teal-500/40',
      glowStyle: { boxShadow: '0 0 18px rgba(20, 184, 166, 0.2)' },
      gradientClass: null,
      shadowClass: '',
      bgGradient: 'from-teal-900/10 to-transparent',
      icon: <SniperIcon />,
      btnLabel: 'Open SNIPER →',
      onClick: () => onNavigate('/sniper'),
      locked: false,
    },
  ];

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

      {/* Responsive grid: 1-col mobile → 2-col tablet → 4-col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {modules.map((mod) =>
          mod.locked ? (
            <LockedModuleCard key={mod.id} mod={mod} />
          ) : (
            <ActiveModuleCard key={mod.id} mod={mod} />
          )
        )}
      </div>
    </section>
  );
}

/* ── Active module card ───────────────────────────────────────────────── */

function ActiveModuleCard({ mod }) {
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
        flex flex-col
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
      <div className="mb-4 h-14 flex items-start">
        {mod.icon}
      </div>

      {/* Module name */}
      <h3 className="font-mono text-2xl font-bold text-white mb-1 tracking-wide">
        {mod.label}
      </h3>

      {/* Description */}
      <p className="text-xs text-gray-400 mb-4 leading-relaxed">
        {mod.description}
      </p>

      {/* Key stat — grows to fill space before the CTA */}
      <div
        className="flex-1 rounded-xl p-4 mb-5 border"
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

      {/* Full-width CTA */}
      <button
        className={`
          w-full py-3 rounded-xl
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

/* ── Locked / coming-soon card ───────────────────────────────────────── */

function LockedModuleCard({ mod }) {
  return (
    <div
      className={`
        bg-black/30 backdrop-blur-xl rounded-2xl
        border-2 ${mod.borderClass}
        opacity-60 cursor-not-allowed
        relative overflow-hidden
        flex flex-col
        select-none
        p-6
      `}
    >
      {/* Lock badge */}
      <div className="absolute top-4 right-4 text-xl">🔒</div>

      {/* Coming-soon chip */}
      <div className="absolute top-4 right-10">
        <span className="text-[10px] bg-teal-900/60 text-teal-400 border border-teal-700/40 px-2 py-0.5 rounded-full font-mono font-semibold">
          COMING SOON
        </span>
      </div>

      {/* Icon (greyscaled) */}
      <div className="mb-4 h-14 flex items-start grayscale opacity-40">
        {mod.icon}
      </div>

      {/* Module name */}
      <h3 className="font-mono text-2xl font-bold text-white mb-1 tracking-wide">
        {mod.label}
      </h3>

      {/* Description */}
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        {mod.description}
      </p>

      {/* Stat placeholder */}
      <div className="flex-1 rounded-xl p-4 mb-5 border border-teal-800/20 bg-teal-900/10">
        <p className="font-mono text-sm text-teal-600 leading-snug">
          {mod.stat}
        </p>
      </div>

      {/* Disabled CTA */}
      <button
        disabled
        className="w-full py-3 rounded-xl bg-gray-800/50 text-gray-500 font-mono text-sm font-bold cursor-not-allowed border border-gray-700/30"
      >
        🔒 Locked
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

/* ── Module icons ─────────────────────────────────────────────────────── */

function ScoutIcon() {
  return (
    <div className="relative">
      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border-2 border-cyan-400/50 transform rotate-3 shadow-lg shadow-cyan-500/40 flex items-center justify-center">
        <div className="w-px h-full bg-cyan-400/20 absolute" />
        <div className="h-px w-full bg-cyan-400/20 absolute" />
      </div>
      <div
        className="absolute -top-1 -right-1 text-xl"
        style={{ animation: 'qlBounce 2s ease-in-out infinite' }}
      >
        📍
      </div>
    </div>
  );
}

function HunterIcon() {
  return (
    <div className="relative w-12 h-12 rounded-full border-[3px] border-pink-400 flex items-center justify-center group-hover:border-pink-300 transition-colors">
      <div className="w-px h-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors" />
      <div className="h-px w-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors" />
      <div className="w-4 h-4 rounded-full border-2 border-pink-400 group-hover:border-pink-300 transition-colors" />
      <div className="w-1 h-1 rounded-full bg-pink-400 group-hover:bg-pink-300 transition-colors animate-pulse absolute" />
    </div>
  );
}

function ReconIcon() {
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-pink-500/20 rounded-full blur-md animate-pulse" />
      <div
        className="relative text-4xl"
        style={{
          filter: 'drop-shadow(0 0 6px rgba(236, 72, 153, 0.7))',
          animation: 'qlBrainPulse 2s ease-in-out infinite',
        }}
      >
        🧠
      </div>
    </div>
  );
}

function SniperIcon() {
  return (
    <div className="relative w-12 h-12 rounded-full border-[3px] border-teal-700/60 flex items-center justify-center bg-black/60">
      <div className="w-px h-full bg-teal-700/60 absolute" />
      <div className="h-px w-full bg-teal-700/60 absolute" />
      <div className="w-3 h-3 rounded-full bg-teal-700/60" />
    </div>
  );
}
