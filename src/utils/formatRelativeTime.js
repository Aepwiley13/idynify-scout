/**
 * Compact relative time formatter — shared utility.
 * Used by AllLeads cards and HunterContactCard (resolves D3.09 format divergence).
 *
 * Returns compact format:
 *   < 1 min  → 'Just now'
 *   < 1 hr   → 'Xm ago'
 *   < 24 hrs → 'Xh ago'
 *   1 day    → 'Yesterday'
 *   < 7 days → 'Xd ago'
 *   < 30 d   → 'Xw ago'
 *   30+ d    → 'Xmo ago'
 */
export function formatRelativeTime(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffMs = now - date;
  if (diffMs < 0) return 'Just now';
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}
