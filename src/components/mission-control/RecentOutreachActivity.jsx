import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Mail, Eye, MessageCircle } from 'lucide-react';
import { STATUS } from '../../theme/tokens';
import usePriorityNavigation from './usePriorityNavigation';

const MAX_EVENTS = 10;

function normalizeToDate(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  if (val.seconds) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function formatRelative(date) {
  const now = new Date();
  const diffMs = now - date;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

const EVENT_ICONS = {
  sent: Mail,
  opened: Eye,
  replied: MessageCircle,
};

/**
 * A reply is the only event on this panel that asks the user to do something.
 * Sent and opened stay muted (null falls back to T.textMuted) so the one that
 * matters is findable in a ten-row scan instead of reading identically to the
 * nine around it.
 */
const EVENT_COLORS = {
  sent: null,
  opened: null,
  replied: STATUS.green,
};

function extractEvents(cadences) {
  const events = [];

  for (const cadence of cadences) {
    const contacts = cadence.contacts || [];
    const cadenceName = cadence.name || 'Cadence';

    for (const c of contacts) {
      const name = c.name || c.email || 'Unknown';
      // Written by BulkComposeModal / BulkSendExecutor as `contact.id` — the
      // same id /contact/:contactId takes. Carried through rather than dropped
      // so the row can open the person it is talking about. May be absent on
      // cadences written before that field existed; EventRow handles it.
      const contactId = c.contactId || null;

      if (c.status === 'sent' && c.sentAt) {
        const date = normalizeToDate(c.sentAt);
        if (date) events.push({ type: 'sent', name, contactId, cadenceName, date, label: `Sent to ${name}` });
      }

      if (c.opened && c.openedAt) {
        const date = normalizeToDate(c.openedAt);
        if (date) events.push({ type: 'opened', name, contactId, cadenceName, date, label: `Opened by ${name}` });
      }

      if (c.replied && c.repliedAt) {
        const date = normalizeToDate(c.repliedAt);
        if (date) events.push({ type: 'replied', name, contactId, cadenceName, date, label: `${name} replied` });
      }
    }
  }

  events.sort((a, b) => b.date - a.date);
  return events.slice(0, MAX_EVENTS);
}

/**
 * One activity row.
 *
 * Interactive when the event knows which contact it is about, inert when it
 * does not. This panel announces the highest-value thing that happens in the
 * product — a prospect replied — and used to announce it as plain text, so the
 * only way to reach that person was to leave Mission Control and search for
 * them by name. Today's Priorities, 200px up the same page, has always been
 * clickable; this was the one contact-bearing list here that was not.
 *
 * The inert branch is not a fallback nobody hits: cadences written before
 * `contactId` was stored have no id to open, and a row that looks clickable
 * and is not would be worse than one that plainly is not. Pointer cursor and
 * hover appear only on the branch that actually navigates.
 */
function EventRow({ event, T, onOpen }) {
  const Icon = EVENT_ICONS[event.type] || Mail;
  const iconColor = EVENT_COLORS[event.type] || T.textMuted;

  const body = (
    <>
      <div style={{
        width: 30, height: 30, borderRadius: '50%',
        background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={14} color={iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{event.label}</div>
        <div style={{ fontSize: 11, color: T.textFaint }}>{event.cadenceName}</div>
      </div>
      <div style={{ fontSize: 11, color: T.textMuted, flexShrink: 0 }}>
        {formatRelative(event.date)}
      </div>
    </>
  );

  const layout = {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
    borderBottom: `1px solid ${T.border}`,
  };

  if (!event.contactId) {
    return <div style={layout}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      aria-label={`${event.label} — open contact`}
      style={{
        width: '100%', background: 'none', border: 'none',
        // Spread AFTER the border reset, so the row keeps its separator: a
        // blanket `border: none` would otherwise win and the list would lose
        // every divider the moment its rows became clickable.
        ...layout,
        font: 'inherit', color: 'inherit', cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = T.rowHov || T.surface; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
    >
      {body}
    </button>
  );
}

export default function RecentOutreachActivity({ userId, T }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  // The same hook Today's Priorities and the right rail use, so all three
  // contact openings on this screen carry identical intent: entry point,
  // reason, and a Back pinned to Mission Control. No second navigation path.
  const openPriority = usePriorityNavigation();

  useEffect(() => {
    const uid = userId || auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, 'users', uid, 'cadences'));
        const cadences = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!cancelled) setEvents(extractEvents(cadences));
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 32px 24px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 14 }}>
        Recent Outreach Activity
      </div>
      <div style={{
        padding: '4px 20px', borderRadius: 12, background: T.cardBg,
        border: `1px solid ${T.border}`,
      }}>
        {loading ? (
          [0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: T.surface2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ width: '60%', height: 12, borderRadius: 6, background: T.surface2, marginBottom: 6 }} />
                <div style={{ width: '40%', height: 10, borderRadius: 6, background: T.surface2 }} />
              </div>
            </div>
          ))
        ) : events.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: T.textMuted }}>
            No outreach activity yet. Start a cadence in Scout.
          </div>
        ) : (
          events.map((event, i) => (
            <EventRow
              key={`${event.type}-${event.name}-${i}`}
              event={event}
              T={T}
              onOpen={e => openPriority({
                entityType: 'contact',
                entityId: e.contactId,
                // The event type IS the reason this row exists. Passing it
                // means the arrival banner and Barry know the user came from a
                // reply rather than from a generic list.
                reasonCode: e.type,
              })}
            />
          ))
        )}
      </div>
    </div>
  );
}
