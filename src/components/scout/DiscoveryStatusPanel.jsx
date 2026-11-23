/**
 * What Daily Discoveries shows when there is no company to review (#006.1).
 *
 * One panel, driven by describeDiscovery(): searching, found, no new matches,
 * all reviewed, failed, still working, or unknown — never an "empty queue" for a
 * failed search, never a retry while a search is running. Actions are the page's
 * existing ones: onRetry → handleManualRefresh, onCheck → re-read status and
 * queue, onEditIcp → ICP Settings.
 */
import { AlertCircle, CheckCircle2, Loader, RefreshCw, Search, Settings, Sparkles } from 'lucide-react';
import { BRAND } from '../../theme/tokens';
import { STATUS } from '../../utils/discoveryStatus';

const ICONS = {
  [STATUS.SEARCHING]: Search,
  [STATUS.FOUND]: Sparkles,
  [STATUS.NO_NEW_MATCHES]: Search,
  [STATUS.ALL_REVIEWED]: CheckCircle2,
  [STATUS.FAILED]: AlertCircle,
  [STATUS.STILL_WORKING]: Loader,
  [STATUS.UNKNOWN]: Search,
};

const PRIMARY = {
  padding: '10px 22px', borderRadius: 10, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
  background: `linear-gradient(135deg,#d1176f,#be185d)`, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 8,
};

export default function DiscoveryStatusPanel({ status, T, busy = false, onRetry, onCheck, onEditIcp }) {
  const Icon = ICONS[status.kind] || Search;
  const spinning = status.kind === STATUS.SEARCHING || status.kind === STATUS.STILL_WORKING || status.kind === STATUS.FOUND;
  const failed = status.kind === STATUS.FAILED;
  const run = status.action === 'retry' ? onRetry : status.action === 'check' ? onCheck : null;

  return (
    <div
      role={failed ? 'alert' : 'status'}
      data-discovery-status={status.kind}
      style={{ textAlign: 'center', padding: 50, color: T.textMuted }}
    >
      <Icon
        size={36}
        aria-hidden="true"
        style={{
          margin: '0 auto 12px', display: 'block',
          color: failed ? 'color-mix(in srgb, #ef4444 70%, var(--text-primary))' : BRAND.pink,
          animation: spinning && Icon === Loader ? 'spin 1s linear infinite' : 'none',
        }}
      />
      <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: '0 0 8px' }}>{status.title}</h2>
      <p style={{ fontSize: 13, color: T.textMuted, margin: '0 auto 16px', maxWidth: 360, lineHeight: 1.5 }}>{status.body}</p>

      {spinning && status.kind !== STATUS.STILL_WORKING && (
        <Loader size={20} aria-hidden="true" style={{ animation: 'spin 1s linear infinite', color: BRAND.pink, margin: '0 auto 16px', display: 'block' }} />
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {run && (
          <button type="button" onClick={run} disabled={busy} aria-busy={busy || undefined} style={{ ...PRIMARY, opacity: busy ? 0.7 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy
              ? <Loader size={14} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} />
              : <RefreshCw size={14} aria-hidden="true" />}
            {status.actionLabel}
          </button>
        )}
        {status.secondary === 'icp' && onEditIcp && (
          <button
            type="button"
            onClick={onEditIcp}
            style={{ ...PRIMARY, background: 'transparent', color: T.text, border: `1px solid ${T.border2 || T.border}` }}
          >
            <Settings size={14} aria-hidden="true" />
            Adjust targeting
          </button>
        )}
      </div>
    </div>
  );
}
