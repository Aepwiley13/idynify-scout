/**
 * CadencePickerModal — "Add to Cadence" for a group of contacts the user
 * already has in hand (the people a CSV import just created or matched).
 *
 * WHAT "ADD TO CADENCE" MEANS TODAY
 * ─────────────────────────────────
 * A cadence is a bulk send recorded as one users/{uid}/cadences doc; there is
 * no persistent enrollment or step schedule to join. So adding people to an
 * existing cadence means sending them that cadence's message through the
 * normal compose → Barry personalization → review → send flow, under the same
 * cadence name. The name is what ties the sends together: the compose step's
 * resend guard uses it to exclude anyone who already received it.
 *
 * This component only chooses the message. Composing, personalizing,
 * reviewing, testing and sending are BulkComposeModal's, unchanged.
 */

import { useEffect, useState } from 'react';
import { X, Plus, Loader, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import BulkComposeModal from '../scout/BulkComposeModal';
import { MAX_BULK_CONTACTS, cadenceTemplate, distinctCadencesForReuse } from '../../utils/cadenceSend';

function hasEmail(c) {
  return Boolean(c?.email || c?.work_email);
}

function formatDate(ts) {
  if (!ts) return null;
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CadencePickerModal({ contacts = [], onClose }) {
  const T = useT();
  const [cadences, setCadences] = useState(null); // null while loading
  const [loadError, setLoadError] = useState(false);
  const [compose, setCompose] = useState(null);   // { cadence|null }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = getEffectiveUser();
        if (!user) { setCadences([]); return; }
        const snap = await getDocs(collection(db, 'users', user.uid, 'cadences'));
        if (cancelled) return;
        setCadences(distinctCadencesForReuse(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
      } catch (err) {
        console.warn('[CadencePickerModal] could not load cadences', err?.message);
        if (!cancelled) { setLoadError(true); setCadences([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // A contact whose CSV email conflicts with its stored one is held back: the
  // send would go to the stored address, and only the user can say which is
  // right. They resolve it in People and send from there.
  //
  // Archived contacts are NOT held back. An uploaded list is a deliberate
  // choice of audience, so a person on it is sendable whatever their archive
  // state (the send does not reactivate them). Do not add an archive filter.
  const emailConflicts = contacts.filter((c) => c._emailConflict);
  const eligible = contacts.filter((c) => !c._emailConflict);
  const withEmail = eligible.filter(hasEmail);
  const recipients = withEmail.slice(0, MAX_BULK_CONTACTS);
  const overCap = withEmail.length - recipients.length;
  const noEmail = eligible.length - withEmail.length;

  if (compose) {
    const tpl = compose.cadence ? cadenceTemplate(compose.cadence) : null;
    return (
      <BulkComposeModal
        contacts={recipients}
        onClose={onClose}
        initialCadenceName={compose.cadence?.name || ''}
        initialSubject={tpl?.subject || ''}
        initialBody={tpl?.body || ''}
        initialCc={tpl?.cc || ''}
        initialPersonalize={tpl ? tpl.personalize : true}
      />
    );
  }

  const row = {
    width: '100%', textAlign: 'left', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px', borderRadius: 10,
    border: `1px solid ${T.border}`, background: T.surface, color: T.text,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Choose cadence"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.cardBg, borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${T.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Choose cadence</div>
            <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2 }}>
              {recipients.length} contact{recipients.length !== 1 ? 's' : ''} will be added to the send
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, display: 'flex' }}
          ><X size={18} /></button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {emailConflicts.length > 0 && (
            <div data-testid="picker-email-conflicts" style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 12, color: T.text,
              background: '#f59e0b14', border: '1px solid #f59e0b55', display: 'flex', gap: 8,
            }}>
              <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
              <span>
                {emailConflicts.length} contact{emailConflicts.length !== 1 ? 's are' : ' is'} not included — the email in your CSV differs from the one in IDYNIFY:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {emailConflicts.map((c) => (
                    <li key={c.id}>
                      {c.name}: CSV {c._emailConflict.csvEmail} · IDYNIFY {c._emailConflict.storedEmail} (matched by {c._emailConflict.signalLabel})
                    </li>
                  ))}
                </ul>
                Check the email in People, then send to them from there.
              </span>
            </div>
          )}

          {(noEmail > 0 || overCap > 0) && (
            <div style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 12, color: T.text,
              background: '#f59e0b14', border: '1px solid #f59e0b55', display: 'flex', gap: 8,
            }}>
              <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
              <span>
                {noEmail > 0 && <>{noEmail} imported contact{noEmail !== 1 ? 's have' : ' has'} no email and can't be emailed. </>}
                {overCap > 0 && <>Up to {MAX_BULK_CONTACTS} people can be sent at once — the other {overCap} can be sent from People afterward.</>}
              </span>
            </div>
          )}

          {cadences === null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textFaint, fontSize: 13, padding: 12 }}>
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading cadences…
            </div>
          )}

          {loadError && (
            <div style={{ fontSize: 12, color: BRAND.pink }}>Could not load your cadences. You can still create a new one.</div>
          )}

          {cadences?.map((c) => {
            const tpl = cadenceTemplate(c);
            const date = formatDate(c.createdAt || c.completedAt);
            return (
              <button
                key={c.id}
                style={row}
                disabled={recipients.length === 0}
                onClick={() => setCompose({ cadence: c })}
                data-testid="cadence-option"
              >
                <RefreshCw size={16} style={{ color: BRAND.pink, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tpl.subject || '(no subject)'}
                  </div>
                  <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
                    {[date && `Last sent ${date}`, tpl.hasAttachment && 'Re-attach the PDF before sending',
                      tpl.legacy && 'Older cadence — review the message before sending']
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: T.textFaint }} />
              </button>
            );
          })}

          <button
            style={{ ...row, borderStyle: 'dashed' }}
            disabled={recipients.length === 0}
            onClick={() => setCompose({ cadence: null })}
          >
            <Plus size={16} style={{ color: BRAND.cyan }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Create new cadence</span>
          </button>
        </div>
      </div>
    </div>
  );
}
