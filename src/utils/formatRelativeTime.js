/**
 * Compact relative time formatter — shared utility.
 * Used by AllLeads cards and HunterContactCard (resolves D3.09 format divergence).
 *
 * Returns compact format: 'Today', 'Yesterday', '3d ago', '2w ago', '1mo ago'
 */
export function formatRelativeTime(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}
