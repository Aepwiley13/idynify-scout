/**
 * Shared color token system for Idynify Scout.
 *
 * Color rules — enforce in code reviews:
 *
 *   Green  (#1D9E75) — Barry CTAs, completed milestones, generate buttons, active dot
 *   Red    (#E24B4A) — Follow-Up Due banner, overdue states ONLY
 *   Amber  (#EF9F27) — Going Cold warning, pending referral ask, approaching follow-up
 *   Blue   (#378ADD) — Timeline system events, info state badges
 *   Purple (#534AB7) — Stage tab UI chrome, engagement count pills, module nav icons
 *   Gray   (#888780) — Inactive stages, future arc positions, muted timestamps
 *
 * NEVER use Purple on Barry CTA buttons.
 * NEVER use Red on completed milestones or arc positions.
 */

export const COLORS = {
  // Barry / positive actions / completed states
  BARRY:        '#1D9E75',
  BARRY_BG:     '#E1F5EE',
  BARRY_BORDER: '#9FE1CB',
  BARRY_TEXT:   '#0F6E56',

  // Danger — overdue only. Nothing else.
  DANGER:        '#E24B4A',
  DANGER_BG:     '#FCEBEB',
  DANGER_BORDER: '#F7C1C1',
  DANGER_TEXT:   '#A32D2D',

  // Warning — going cold, pending, follow-up states
  WARNING:        '#EF9F27',
  WARNING_BG:     '#FAEEDA',
  WARNING_BORDER: '#FAC775',
  WARNING_TEXT:   '#854F0B',

  // Info — system events, read-only data, timeline system items
  INFO:        '#378ADD',
  INFO_BG:     '#E6F1FB',
  INFO_BORDER: '#B5D4F4',
  INFO_TEXT:   '#185FA5',

  // UI chrome — stage tabs, engagement count pills, module nav. NEVER on Barry CTAs.
  CHROME:        '#534AB7',
  CHROME_BG:     '#EEEDFE',
  CHROME_BORDER: '#CECBF6',
  CHROME_TEXT:   '#3C3489',

  // Neutral — inactive stages, muted metadata, future arc positions
  NEUTRAL:        '#888780',
  NEUTRAL_BG:     '#F1EFE8',
  NEUTRAL_BORDER: '#D3D1C7',
  NEUTRAL_TEXT:   '#5F5E5A',
};
