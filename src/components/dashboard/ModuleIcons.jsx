/**
 * ModuleIcons — shared icon components used by both ModuleNavigationGrid
 * and the top nav buttons in MissionControlDashboardV2.
 *
 * Each export renders a full-size card icon by default.
 * Pass size="sm" for a compact 20px nav-button version.
 */

export function CommandCenterIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="8" />
      <line x1="12" y1="16" x2="12" y2="22" />
      <line x1="2" y1="12" x2="8" y2="12" />
      <line x1="16" y1="12" x2="22" y2="12" />
    </svg>
  );
  return (
    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border-2 border-cyan-400/50 flex items-center justify-center shadow-lg shadow-cyan-500/40">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="12" y1="2" x2="12" y2="8" />
        <line x1="12" y1="16" x2="12" y2="22" />
        <line x1="2" y1="12" x2="8" y2="12" />
        <line x1="16" y1="12" x2="22" y2="12" />
      </svg>
    </div>
  );
}

export function ReconIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <span style={{ fontSize: 16, lineHeight: 1, filter: 'drop-shadow(0 0 4px rgba(236,72,153,0.7))' }}>🧠</span>
  );
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

export function ScoutIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
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

export function HunterIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
  return (
    <div className="relative w-12 h-12 rounded-full border-[3px] border-pink-400 flex items-center justify-center group-hover:border-pink-300 transition-colors">
      <div className="w-px h-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors" />
      <div className="h-px w-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors" />
      <div className="w-4 h-4 rounded-full border-2 border-pink-400 group-hover:border-pink-300 transition-colors" />
      <div className="w-1 h-1 rounded-full bg-pink-400 group-hover:bg-pink-300 transition-colors animate-pulse absolute" />
    </div>
  );
}

export function SniperIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <circle cx="12" cy="12" r="2" fill="#14b8a6" />
    </svg>
  );
  return (
    <div className="relative w-12 h-12 rounded-full border-[3px] border-teal-500/60 flex items-center justify-center bg-black/60">
      <div className="w-px h-full bg-teal-500/60 absolute" />
      <div className="h-px w-full bg-teal-500/60 absolute" />
      <div className="w-3 h-3 rounded-full bg-teal-500/60" />
    </div>
  );
}

export function HomebaseIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
  return (
    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500/30 to-emerald-600/30 border-2 border-green-400/50 flex items-center justify-center shadow-lg shadow-green-500/40">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    </div>
  );
}

export function ReinforcementsIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
  return (
    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-orange-500/30 to-red-600/30 border-2 border-orange-400/50 flex items-center justify-center shadow-lg shadow-orange-500/40">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    </div>
  );
}

export function FallbackIcon({ size = 'md' }) {
  if (size === 'sm') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-4.5" />
    </svg>
  );
  return (
    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-red-500/30 to-rose-700/30 border-2 border-red-400/50 flex items-center justify-center shadow-lg shadow-red-500/40">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 .49-4.5" />
      </svg>
    </div>
  );
}
