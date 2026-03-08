/**
 * src/theme/tokens.js
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for all Idynify design tokens.
 * Import from here — never hardcode hex values in components.
 *
 * Usage:
 *   import { BRAND, STATUS, BRIGADE, THEMES } from "@/theme/tokens";
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── BRAND (primary palette — from logo assets) ───────────────────────────────
export const BRAND = {
  pink:    "#e8197d",   // Primary CTA, active states, highlights
  purple:  "#7c3aed",   // Hunter module accent color
  cyan:    "#00c4cc",   // Secondary — borders, hover glows, tags
  navy:    "#1a1040",   // Deep base — dark backgrounds, depth layers
  black:   "#000000",   // Pure backgrounds on dark theme
};

// ─── STATUS (functional — never use as brand accents) ────────────────────────
export const STATUS = {
  green:   "#10b981",   // Match, success, active, verified
  red:     "#dc2626",   // Skip, error, danger, not a match
  amber:   "#f59e0b",   // Warning, awaiting reply, needs review
};

// ─── BRIGADE (contact classification tags) ───────────────────────────────────
export const BRIGADE = {
  purple:  "#7c3aed",   // Lead
  blue:    "#3b82f6",   // Network / contact links
  pink:    "#ec4899",   // Referral
};

// ─── ASSET PATHS ─────────────────────────────────────────────────────────────
export const ASSETS = {
  barryAvatar:  "/assets/barry_AI.jpg",          // Astronaut bear — circular crop
  logoFull:     "/assets/Idynify_logo1.png",     // Full wordmark — nav expanded / onboarding
  logoMark:     "/assets/Short_Logo_Idynify.png",// Pocket icon — collapsed rail / favicon
};

// ─── THEMES ───────────────────────────────────────────────────────────────────
// Each theme maps semantic role → resolved color.
// Components always use T.cardBg, T.text, T.accent — never raw hex.

export const THEMES = {

  mission: {
    id: "mission", label: "Mission Control", icon: "🌌",
    // Surfaces
    appBg:      "#000000",
    railBg:     "#06040f",
    navBg:      "#0b0818",
    cardBg:     "#110e1e",
    cardBg2:    "#0b0818",
    surface:    "#ffffff08",
    surface2:   "#ffffff0d",
    // Borders
    border:     "#ffffff0d",
    border2:    "#ffffff18",
    borderHov:  `${BRAND.pink}40`,
    // Text
    text:       "#f0eaff",
    textMuted:  "#9080b0",
    textFaint:  "#4a3870",
    textGhost:  "#2a1a50",
    // Input
    input:      "#ffffff08",
    // Accent (brand pink)
    accent:     BRAND.pink,
    accentBg:   `${BRAND.pink}15`,
    accentBdr:  `${BRAND.pink}35`,
    // Secondary (brand cyan)
    cyan:       BRAND.cyan,
    cyanBg:     `${BRAND.cyan}12`,
    cyanBdr:    `${BRAND.cyan}35`,
    // Flags
    isDark:     true,
    particles:  true,                            // Star field enabled
    // Theme picker swatch
    swatchBg:   "linear-gradient(135deg,#000000,#1a1040)",
    // Modal overrides
    modalBg:    "#110e1e",
    modalText:  "#f0eaff",
    modalMuted: "#9080b0",
    modalBdr:   "#ffffff0d",
    modalLine:  "#ffffff08",
    // Misc surfaces
    statBg:     "#ffffff06",
    tagBg:      "#ffffff08",
    tagText:    "#9080b0",
    rowHov:     "#ffffff03",
    rowSel:     `${BRAND.pink}08`,
  },

  workspace: {
    id: "workspace", label: "Clean Workspace", icon: "☀️",
    appBg:      "#f8f7fc",
    railBg:     "#ffffff",
    navBg:      "#ffffff",
    cardBg:     "#ffffff",
    cardBg2:    "#f3f0fa",
    surface:    "#ede9f8",
    surface2:   "#e4dff5",
    border:     "#e0d8f0",
    border2:    "#d0c8e8",
    borderHov:  `${BRAND.pink}40`,
    text:       "#12082a",
    textMuted:  "#5a4880",
    textFaint:  "#9080b0",
    textGhost:  "#c0b0d8",
    input:      "#ede9f8",
    accent:     BRAND.pink,
    accentBg:   `${BRAND.pink}12`,
    accentBdr:  `${BRAND.pink}30`,
    cyan:       BRAND.cyan,
    cyanBg:     `${BRAND.cyan}10`,
    cyanBdr:    `${BRAND.cyan}30`,
    isDark:     false,
    particles:  false,
    swatchBg:   "linear-gradient(135deg,#f8f7fc,#e4dff5)",
    modalBg:    "#ffffff",
    modalText:  "#12082a",
    modalMuted: "#5a4880",
    modalBdr:   "#e0d8f0",
    modalLine:  "#ede9f8",
    statBg:     "#ede9f8",
    tagBg:      "#ede9f8",
    tagText:    "#9080b0",
    rowHov:     "#f3f0fa",
    rowSel:     `${BRAND.pink}08`,
  },

  navy: {
    id: "navy", label: "Midnight Navy", icon: "🌊",
    appBg:      BRAND.navy,
    railBg:     "#120c30",
    navBg:      "#160e38",
    cardBg:     "#1e1450",
    cardBg2:    "#160e38",
    surface:    "#ffffff08",
    surface2:   "#ffffff0d",
    border:     "#2a1870",
    border2:    "#3a2880",
    borderHov:  `${BRAND.pink}50`,
    text:       "#e8e0ff",
    textMuted:  "#8070c0",
    textFaint:  "#4030a0",
    textGhost:  "#2a1870",
    input:      "#1e1450",
    accent:     BRAND.pink,
    accentBg:   `${BRAND.pink}15`,
    accentBdr:  `${BRAND.pink}35`,
    cyan:       BRAND.cyan,
    cyanBg:     `${BRAND.cyan}12`,
    cyanBdr:    `${BRAND.cyan}35`,
    isDark:     true,
    particles:  false,
    swatchBg:   "linear-gradient(135deg,#1a1040,#2a1880)",
    modalBg:    "#1e1450",
    modalText:  "#e8e0ff",
    modalMuted: "#8070c0",
    modalBdr:   "#2a1870",
    modalLine:  "#2a1870",
    statBg:     "#160e38",
    tagBg:      "#2a187020",
    tagText:    "#8070c0",
    rowHov:     "#ffffff03",
    rowSel:     `${BRAND.pink}08`,
  },

  sand: {
    id: "sand", label: "Warm Sand", icon: "🏜️",
    appBg:      "#faf6f0",
    railBg:     "#fff8f2",
    navBg:      "#fff8f2",
    cardBg:     "#ffffff",
    cardBg2:    "#fdf4ec",
    surface:    "#f5ece0",
    surface2:   "#ecddd0",
    border:     "#e8d8c4",
    border2:    "#ddc8a8",
    borderHov:  `${BRAND.pink}50`,
    text:       "#2a1810",
    textMuted:  "#8a6040",
    textFaint:  "#b09070",
    textGhost:  "#d0b898",
    input:      "#f5ece0",
    accent:     BRAND.pink,
    accentBg:   `${BRAND.pink}10`,
    accentBdr:  `${BRAND.pink}2a`,
    cyan:       "#00a0a8",               // Muted cyan for warm theme
    cyanBg:     "#00a0a810",
    cyanBdr:    "#00a0a828",
    isDark:     false,
    particles:  false,
    swatchBg:   "linear-gradient(135deg,#faf6f0,#e8d8c4)",
    modalBg:    "#ffffff",
    modalText:  "#2a1810",
    modalMuted: "#8a6040",
    modalBdr:   "#e8d8c4",
    modalLine:  "#f0e4d0",
    statBg:     "#f5ece0",
    tagBg:      "#f5ece0",
    tagText:    "#8a6040",
    rowHov:     "#fdf4ec",
    rowSel:     `${BRAND.pink}08`,
  },
};

// ─── STATUS BADGE MAP (component-ready) ───────────────────────────────────────
// Used by <StatusBadge status="awaiting_reply" /> etc.
export const STATUS_COLORS = {
  awaiting_reply: { c: STATUS.amber,    bg: `${STATUS.amber}18`,    border: `${STATUS.amber}35`    },
  engaged:        { c: BRIGADE.purple,  bg: `${BRIGADE.purple}18`,  border: `${BRIGADE.purple}35`  },
  in_pipeline:    { c: STATUS.green,    bg: `${STATUS.green}18`,    border: `${STATUS.green}35`    },
  snoozed:        { c: BRIGADE.blue,    bg: `${BRIGADE.blue}18`,    border: `${BRIGADE.blue}35`    },
  not_contacted:  { c: "#888",          bg: "#88888812",            border: "#88888828"            },
  follow_up:      { c: STATUS.green,    bg: `${STATUS.green}18`,    border: `${STATUS.green}35`    },
};

// ─── TYPOGRAPHY ───────────────────────────────────────────────────────────────
export const TYPE = {
  fontFamily: "Inter, system-ui, sans-serif",
  weights: {
    regular:   400,
    medium:    500,
    semibold:  600,
    bold:      700,
    extrabold: 800,
  },
};

// ─── ICON MAP (Lucide — import from lucide-react) ─────────────────────────────
// Documented here for team reference. Import the components directly in each file.
//
//  Section     → Icon component
//  ──────────────────────────────
//  Scout       → Radar
//  Hunter      → Crosshair
//  Recon       → Eye  (or Brain)
//  Sniper      → Target
//  Settings    → Settings
//  Theme       → Palette
//  Barry       → Use ASSETS.barryAvatar image, never an icon
//
//  Action icons (keep monochrome; pink ONLY on active state):
//  Follow Up   → Zap
//  Enrich      → Star
//  Campaign    → Rocket
//  Export      → Download
//  Search      → Search
//  Email       → Mail
//  Phone       → Phone
//  LinkedIn    → Linkedin
//  Website     → Globe
//  Back        → ArrowLeft
//  Close       → X
//  Check       → Check
//  Time        → Clock
