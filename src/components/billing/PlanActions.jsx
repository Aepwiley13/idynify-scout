/**
 * W3: what a paying customer can do with their plan, in Settings → Billing.
 *
 *   Starter  Upgrade to Pro: Stripe's own preview of what is due today (the rest of this period,
 *            prorated), then Confirm. The change is made on the customer's EXISTING subscription
 *            (netlify/functions/change-plan.js) and applies only once that payment succeeds. The
 *            page then waits for the account to show Pro, which the webhook sets with the extra
 *            credits. If the bank wants confirmation, Stripe's invoice page takes the payment.
 *   Both     Manage billing: Stripe's Customer Portal for payment methods, invoices, billing
 *            details and cancelling at the end of the period (create-portal-session.js).
 *   Pro      Moving to Starter goes through support for now.
 *
 * Nothing here writes billing data: the server and Stripe do, and this page reads the result.
 */
import { useEffect, useState } from 'react';
import { ArrowUpCircle, CreditCard, Mail } from 'lucide-react';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { billingRequestHeaders } from '../../services/billingSecurity';
import { supportMailto } from '../../constants/support';
import { PLAN_DETAILS } from '../../constants/plans';
import { planChangeMessage, formatMoney, PRO_EXTRA_CREDITS } from './planChange';

export const UPGRADE_POLL_MS = 2500;
export const UPGRADE_TIMEOUT_MS = 60000;
/** While the customer confirms a payment on Stripe's invoice page, keep checking this long. */
export const PAYMENT_WAIT_MS = 15 * 60 * 1000;

async function post(path, body) {
  const headers = await billingRequestHeaders(auth.currentUser);
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(typeof iso === 'number' ? iso * 1000 : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

export default function PlanActions({ plan, cancelAtPeriodEnd = false, currentPeriodEnd = null, autoOpenUpgrade = false, onChanged }) {
  // idle → previewing → confirm → upgrading → waiting → done | payment | error.
  // Arriving from a Scout "Upgrade to Pro" link (?upgrade=pro) starts at the preview.
  const [stage, setStage] = useState(() => (autoOpenUpgrade && plan === 'starter' && !cancelAtPeriodEnd ? 'previewing' : 'idle'));
  const [preview, setPreview] = useState(null);
  const [invoiceUrl, setInvoiceUrl] = useState(null);
  const [error, setError] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);

  const startUpgrade = () => {
    setError(null);
    setStage('previewing');
  };

  // Stripe's preview of what is due today.
  useEffect(() => {
    if (stage !== 'previewing') return undefined;
    let live = true;
    (async () => {
      try {
        const { ok, data } = await post('change-plan', { action: 'preview' });
        if (!live) return;
        if (!ok) { setError(planChangeMessage(data.error)); setStage('error'); return; }
        setPreview(data);
        setStage('confirm');
      } catch {
        if (live) { setError(planChangeMessage('network')); setStage('error'); }
      }
    })();
    return () => { live = false; };
  }, [stage]);

  // Paid (or being confirmed by the bank): wait for the account to show Pro.
  useEffect(() => {
    if (stage !== 'waiting' && stage !== 'payment') return undefined;
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    let live = true;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const snap = await getDocFromServer(doc(db, 'users', uid));
        if (!live) return;
        if (snap.exists() && snap.data()?.subscriptionTier === 'pro') {
          clearInterval(timer);
          setStage('done');
          onChanged?.();
          return;
        }
      } catch {
        // Try again on the next tick.
      }
      const limit = stage === 'waiting' ? UPGRADE_TIMEOUT_MS : PAYMENT_WAIT_MS;
      if (Date.now() - started > limit) {
        clearInterval(timer);
        if (live && stage === 'waiting') { setError(planChangeMessage('slow_confirmation')); setStage('error'); }
      }
    }, UPGRADE_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [stage, onChanged]);

  async function confirmUpgrade() {
    if (stage === 'upgrading') return;
    setStage('upgrading');
    setError(null);
    try {
      const { ok, data } = await post('change-plan', { action: 'upgrade', prorationDate: preview?.prorationDate });
      if (!ok) { setError(planChangeMessage(data.error)); setStage('error'); return; }
      if (data.status === 'payment_required') {
        setInvoiceUrl(data.invoiceUrl ?? null);
        setStage('payment');
        return;
      }
      setStage('waiting');
    } catch {
      setError(planChangeMessage('network'));
      setStage('error');
    }
  }

  async function openPortal() {
    if (portalBusy) return;
    setPortalBusy(true);
    setError(null);
    try {
      const { ok, data } = await post('create-portal-session');
      if (!ok || !data.url) { setError(planChangeMessage(data.error)); setPortalBusy(false); return; }
      window.location.href = data.url;
    } catch {
      setError(planChangeMessage('network'));
      setPortalBusy(false);
    }
  }

  const pro = PLAN_DETAILS.pro;
  const renews = formatDate(preview?.currentPeriodEnd ?? currentPeriodEnd);

  return (
    <div className="us-plan-actions">
      <div className="us-billing-plan-actions">
        {plan === 'starter' && !cancelAtPeriodEnd && (stage === 'idle' || stage === 'error') && (
          <button type="button" className="us-action-btn us-action-btn--primary" onClick={startUpgrade}>
            <ArrowUpCircle className="w-3.5 h-3.5" />
            Upgrade to Pro
          </button>
        )}
        <button type="button" className="us-action-btn" onClick={openPortal} disabled={portalBusy}>
          <CreditCard className="w-3.5 h-3.5" />
          {portalBusy ? 'Opening…' : 'Manage billing'}
        </button>
      </div>

      {plan === 'starter' && cancelAtPeriodEnd && (
        <p className="us-billing-plan-note">
          Your plan is set to end{renews ? ` on ${renews}` : ''}. To upgrade, first keep your plan in Manage billing.
        </p>
      )}

      {stage === 'previewing' && <p className="us-billing-plan-note" role="status">Checking what Pro would cost today…</p>}

      {stage === 'confirm' && preview && (
        <div className="us-plan-confirm" role="group" aria-label="Upgrade to Pro">
          <p className="us-billing-plan-note">
            <strong>{pro.name}</strong> is {pro.price}. You pay <strong>{formatMoney(preview.amountDue, preview.currency)}</strong> today
            for the rest of this billing period{renews ? `, then ${pro.price} from ${renews}` : ''}. Once the payment goes through,
            Pro is on and {PRO_EXTRA_CREDITS.toLocaleString()} more enrichment credits are added. Same subscription, nothing else changes.
          </p>
          <div className="us-billing-plan-actions">
            <button type="button" className="us-action-btn us-action-btn--primary" onClick={confirmUpgrade}>
              Confirm upgrade
            </button>
            <button type="button" className="us-action-btn" onClick={() => { setStage('idle'); setPreview(null); }}>
              Not now
            </button>
          </div>
        </div>
      )}

      {(stage === 'upgrading' || stage === 'waiting') && (
        <p className="us-billing-plan-note" role="status">Upgrading to Pro… this usually takes a few seconds.</p>
      )}

      {stage === 'payment' && (
        <div className="us-plan-confirm" role="alert">
          <p className="us-billing-plan-note">
            Your bank needs you to confirm this payment. You are still on Starter, and nothing changes until it is paid.
          </p>
          {invoiceUrl && (
            <a className="us-action-btn us-action-btn--primary" href={invoiceUrl} target="_blank" rel="noopener noreferrer">
              Confirm the payment
            </a>
          )}
        </div>
      )}

      {stage === 'done' && <p className="us-billing-plan-note" role="status">You are on {pro.name}. Your new credits are in your balance.</p>}

      {error && <p className="us-billing-plan-note" role="alert">{error}</p>}

      {plan === 'pro' && (
        <p className="us-billing-plan-note">
          Moving to Starter? <a href={supportMailto()}><Mail className="w-3.5 h-3.5" style={{ display: 'inline', verticalAlign: '-2px' }} /> Contact us</a> and we will set it for your next billing date.
        </p>
      )}
    </div>
  );
}
