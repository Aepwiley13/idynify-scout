/**
 * Shared vocabulary for rendering a fit score.
 *
 * calculateICPScore returns null for "the ICP configures criteria, but nothing
 * on this company was measurable" (G1-06). Every surface that shows a score
 * needs the same answer to "is this a number, or an absence?", and needs to say
 * the same thing when it is an absence — otherwise one screen reports "Not
 * enough data" while another shows a red 0 for the same company.
 *
 * Lives outside the component file so it can be imported by anything without
 * tripping the fast-refresh rule against mixing component and non-component
 * exports.
 */

export const UNSCORED_TITLE = 'Not enough data to score this company';
export const UNSCORED_SHORT = '—';
export const UNSCORED_LABEL = 'Not enough data';

/**
 * True when a score represents an actual evaluation.
 *
 * 0 is scored: it means "we measured this and it does not fit". null and
 * undefined mean "we did not measure it". Collapsing the two is the defect.
 */
export function isScored(score) {
  return score !== null && score !== undefined;
}
