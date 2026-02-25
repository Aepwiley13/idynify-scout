/**
 * QuickLaunchStrip — Horizontal scrollable carousel of module tiles.
 *
 * On click, calls onModuleSelect(moduleId) to open the inline MissionCardDeck
 * below — no full-page navigation. Receives live stats from Mission Control's
 * already-loaded loadDashboardStats() — no extra Firestore reads.
 *
 * Props:
 *   stats          — { scoutCompanies, scoutContacts, reconCompletion, hunterMissions }
 *   onModuleSelect — (moduleId: string) => void
 *   activeModule   — currently open module id or null
 */
export default function QuickLaunchStrip({ stats = {}, onModuleSelect, activeModule }) {

  const {
    scoutCompanies = 0,
    scoutContacts = 0,
    reconCompletion = 0,
    hunterMissions = 0
  } = stats;

  const cards = [
    {
      id: 'scout',
      label: 'SCOUT',
      route: '/scout',
      active: true,
      icon: <ScoutIcon />,
      badge: 'ACTIVE',
      badgeClass: 'bg-emerald-500 text-white',
      status: `${scoutCompanies} Companies · ${scoutContacts} Contacts`,
      glowClass: 'border-cyan-500/60',
      glowStyle: { boxShadow: '0 0 18px rgba(6, 182, 212, 0.25)' },
      btnClass: 'from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-cyan-500/40',
      btnLabel: 'Enter Scout →'
    },
    {
      id: 'hunter',
      label: 'HUNTER',
      route: '/hunter',
      active: true,
      icon: <HunterIcon />,
      badge: 'ACTIVE',
      badgeClass: 'bg-gradient-to-r from-pink-500 to-purple-600 text-white animate-pulse',
      status: `${hunterMissions} Mission${hunterMissions !== 1 ? 's' : ''} Running`,
      glowClass: 'border-pink-500/60',
      glowStyle: { boxShadow: '0 0 18px rgba(236, 72, 153, 0.25)' },
      btnClass: 'from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 shadow-pink-500/40',
      btnLabel: 'Launch Hunter →'
    },
    {
      id: 'recon',
      label: 'RECON',
      route: '/recon',
      active: true,
      icon: <ReconIcon />,
      badge: reconCompletion >= 100 ? '100% COMPLETE' : `${reconCompletion}% COMPLETE`,
      badgeClass: reconCompletion >= 100
        ? 'bg-emerald-500 text-white'
        : 'bg-purple-500/30 text-purple-300 border border-purple-500/40',
      status: reconCompletion >= 100 ? 'Fully trained' : `${reconCompletion}% complete`,
      glowClass: 'border-purple-500/60',
      glowStyle: { boxShadow: '0 0 18px rgba(168, 85, 247, 0.25)' },
      btnClass: 'from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 shadow-purple-500/40',
      btnLabel: 'Train AI →'
    },
    {
      id: 'sniper',
      label: 'SNIPER',
      route: null,
      active: false,
      icon: <SniperIcon />,
      badge: 'COMING SOON',
      badgeClass: 'bg-gray-600 text-gray-300',
      status: 'Coming Soon',
      glowClass: 'border-gray-600/30',
      glowStyle: {},
      btnClass: null,
      btnLabel: null
    }
  ];

  return (
    <section className="mb-12">
      {/* Constrained to match Barry panel width */}
      <div className="max-w-4xl mx-auto">
        {/* Section Label */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-px w-20 bg-gradient-to-r from-transparent to-cyan-500/50"></div>
          <span className="text-xs font-mono text-cyan-400/70 tracking-widest uppercase">Quick Launch</span>
          <div className="h-px w-20 bg-gradient-to-l from-transparent to-cyan-500/50"></div>
        </div>

        {/* Scroll container — horizontal snap row on all viewports */}
        <div
          className="
            flex flex-row gap-4
            overflow-x-auto pb-3
            snap-x snap-mandatory
            scroll-smooth
            [&::-webkit-scrollbar]:hidden
            [-ms-overflow-style:none]
            [scrollbar-width:none]
          "
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {cards.map((card) =>
            card.active ? (
              <ActiveCard
                key={card.id}
                card={card}
                isActive={activeModule === card.id}
                onClick={() => onModuleSelect && onModuleSelect(card.id)}
              />
            ) : (
              <LockedCard key={card.id} card={card} />
            )
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Active Card ──────────────────────────────────────────── */

function ActiveCard({ card, isActive, onClick }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-label={`Open ${card.label}`}
      aria-pressed={isActive}
      className={`
        group cursor-pointer
        flex-shrink-0 w-[260px]
        snap-start
        bg-black/50 backdrop-blur-xl rounded-2xl p-5
        min-h-[200px]
        border-2 ${isActive ? 'border-white/60' : card.glowClass}
        hover:scale-[1.02] active:scale-[0.98]
        transition-all duration-200
        relative overflow-hidden
        select-none
      `}
      style={isActive ? { boxShadow: '0 0 24px rgba(255,255,255,0.15)' } : card.glowStyle}
    >
      {/* Hover glow overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none"></div>

      {/* Icon */}
      <div className="mb-3 h-14 flex items-center">
        {card.icon}
      </div>

      {/* Module name */}
      <h4 className="font-mono text-lg font-bold text-white mb-2">{card.label}</h4>

      {/* Badge */}
      <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-mono font-semibold mb-3 ${card.badgeClass}`}>
        {card.badge}
      </span>

      {/* Live status */}
      <p className="text-xs text-gray-400 font-mono mb-4 leading-relaxed min-h-[2rem]">
        {card.status}
      </p>

      {/* Tap-to-open button */}
      <button
        className={`w-full py-2.5 rounded-xl bg-gradient-to-r ${card.btnClass} text-white font-mono text-xs font-bold transition-all shadow-lg`}
        tabIndex={-1}
        aria-hidden="true"
      >
        {isActive ? 'Close ↑' : card.btnLabel}
      </button>
    </div>
  );
}

/* ── Locked / Coming-Soon Card ────────────────────────────── */

function LockedCard({ card }) {
  return (
    <div
      className={`
        flex-shrink-0 w-[72vw] sm:w-[56vw] md:w-auto
        snap-start
        bg-black/30 backdrop-blur-xl rounded-2xl p-5
        md:min-h-[200px]
        border-2 ${card.glowClass}
        opacity-50 cursor-not-allowed
        relative overflow-hidden
        select-none
      `}
    >
      {/* Lock badge top-right */}
      <div className="absolute top-3 right-3 text-lg">🔒</div>

      {/* Icon */}
      <div className="mb-3 h-14 flex items-center grayscale opacity-50">
        {card.icon}
      </div>

      {/* Module name */}
      <h4 className="font-mono text-lg font-bold text-white mb-2">{card.label}</h4>

      {/* Badge */}
      <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-mono font-semibold mb-3 ${card.badgeClass}`}>
        {card.badge}
      </span>

      {/* Status */}
      <p className="text-xs text-gray-500 font-mono mb-4 min-h-[2rem]">
        {card.status}
      </p>

      {/* Disabled button */}
      <button
        disabled
        className="w-full py-2.5 rounded-xl bg-gray-700/40 text-gray-500 font-mono text-xs font-bold cursor-not-allowed border border-gray-600/30"
      >
        🔒 Locked
      </button>
    </div>
  );
}

/* ── Icons — match existing module cards exactly ─────────── */

function ScoutIcon() {
  return (
    <div className="relative">
      {/* Tactical map tile */}
      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border-2 border-cyan-400/50 transform rotate-3 shadow-lg shadow-cyan-500/40 flex items-center justify-center">
        <div className="w-px h-full bg-cyan-400/20 absolute"></div>
        <div className="h-px w-full bg-cyan-400/20 absolute"></div>
      </div>
      {/* Location pin */}
      <div className="absolute -top-1 -right-1 text-xl" style={{ animation: 'qlBounce 2s ease-in-out infinite' }}>📍</div>
    </div>
  );
}

function HunterIcon() {
  return (
    <div className="relative w-12 h-12 rounded-full border-[3px] border-pink-400 flex items-center justify-center group-hover:border-pink-300 transition-colors">
      <div className="w-px h-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors"></div>
      <div className="h-px w-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors"></div>
      <div className="w-4 h-4 rounded-full border-2 border-pink-400 group-hover:border-pink-300 transition-colors"></div>
      <div className="w-1 h-1 rounded-full bg-pink-400 group-hover:bg-pink-300 transition-colors animate-pulse absolute"></div>
    </div>
  );
}

function ReconIcon() {
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-pink-500/20 rounded-full blur-md animate-pulse"></div>
      <div
        className="relative text-4xl"
        style={{
          filter: 'drop-shadow(0 0 6px rgba(236, 72, 153, 0.7))',
          animation: 'qlBrainPulse 2s ease-in-out infinite'
        }}
      >
        🧠
      </div>
    </div>
  );
}

function SniperIcon() {
  return (
    <div className="relative w-12 h-12 rounded-full border-[3px] border-gray-600 flex items-center justify-center bg-black/60">
      <div className="w-px h-full bg-gray-600 absolute"></div>
      <div className="h-px w-full bg-gray-600 absolute"></div>
      <div className="w-3 h-3 rounded-full bg-gray-600"></div>
    </div>
  );
}
