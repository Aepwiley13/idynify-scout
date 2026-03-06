/**
 * TouchesSection.jsx — Touch log and follow-up tracker for SNIPER.
 *
 * Shows all logged touches chronologically + contacts that are overdue
 * for follow-up. Central visibility layer for nurture activity.
 */
import { useState, useEffect } from 'react';
import {
  collection, getDocs, query, orderBy, limit
} from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import {
  Mail, Phone, Linkedin, MessageSquare, Calendar,
  Clock, AlertCircle, CheckCircle, Crosshair, User,
  Activity
} from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { BRAND } from '../../../theme/tokens';

const SNIPER_TEAL = '#14b8a6';

const TOUCH_TYPE_CONFIG = {
  email:    { label: 'Email',    Icon: Mail,           color: '#3b82f6' },
  call:     { label: 'Call',     Icon: Phone,          color: '#10b981' },
  linkedin: { label: 'LinkedIn', Icon: MessageSquare,  color: '#0077b5' },
  meeting:  { label: 'Meeting',  Icon: Calendar,       color: '#8b5cf6' },
  other:    { label: 'Other',    Icon: Activity,       color: SNIPER_TEAL },
};

function timeAgo(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function daysSince(ts) {
  if (!ts) return null;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function TouchesSection() {
  const T = useT();
  const [touches, setTouches] = useState([]);
  const [overdueContacts, setOverdueContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const [touchSnap, contactSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'users', user.uid, 'sniper_touches'),
            orderBy('createdAt', 'desc'),
            limit(50)
          )),
          getDocs(query(
            collection(db, 'users', user.uid, 'sniper_contacts'),
            orderBy('lastTouchAt', 'asc')
          )),
        ]);

        setTouches(touchSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        const contacts = contactSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const overdue = contacts.filter(c => {
          const days = daysSince(c.lastTouchAt);
          return days === null || days > 14;
        }).filter(c => c.stage !== 'won' && c.stage !== 'lost');
        setOverdueContacts(overdue);
      } catch (err) {
        console.error('Error loading touches:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', color: T.textFaint }}>
          <Crosshair size={28} color={SNIPER_TEAL} style={{ marginBottom: 10, opacity: 0.6 }} />
          <div style={{ fontSize: 12 }}>Loading touches...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 22px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Touches</div>
      <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 18 }}>
        Communication log + overdue follow-ups
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Overdue section */}
        {overdueContacts.length > 0 && (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              marginBottom: 10, padding: '8px 12px', borderRadius: 8,
              background: '#f59e0b0f', border: '1px solid #f59e0b25',
            }}>
              <AlertCircle size={14} color="#f59e0b" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>
                {overdueContacts.length} contact{overdueContacts.length !== 1 ? 's' : ''} need a touch
              </span>
              <span style={{ fontSize: 10, color: T.textFaint }}>(14+ days since last contact)</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {overdueContacts.map(contact => {
                const days = daysSince(contact.lastTouchAt);
                return (
                  <div key={contact.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 9,
                    background: T.cardBg, border: '1px solid #f59e0b25',
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: '#f59e0b15', border: '1.5px solid #f59e0b40',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#f59e0b',
                    }}>
                      {(contact.firstName?.[0] || '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {contact.firstName} {contact.lastName}
                        {contact.company && <span style={{ fontSize: 10, color: T.textFaint, fontWeight: 400 }}> · {contact.company}</span>}
                      </div>
                      {contact.nextTouchLabel && (
                        <div style={{ fontSize: 10, color: SNIPER_TEAL, marginTop: 1 }}>
                          Planned: {contact.nextTouchLabel}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#f59e0b', textAlign: 'right', flexShrink: 0 }}>
                      {days === null ? 'Never contacted' : `${days}d ago`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Touch log */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 1, marginBottom: 10 }}>
            TOUCH LOG
          </div>

          {touches.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '48px 24px', gap: 10, color: T.textFaint, textAlign: 'center',
            }}>
              <Activity size={28} color={SNIPER_TEAL} style={{ opacity: 0.4 }} />
              <div style={{ fontSize: 13, color: T.textFaint }}>No touches logged yet.</div>
              <div style={{ fontSize: 11, maxWidth: 240, lineHeight: 1.5 }}>
                Log a touch from the Targets view to track your outreach activity here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {touches.map(touch => {
                const config = TOUCH_TYPE_CONFIG[touch.type] || TOUCH_TYPE_CONFIG.other;
                const Icon = config.Icon;
                return (
                  <div key={touch.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '11px 14px', borderRadius: 9,
                    background: T.cardBg, border: `1px solid ${T.border2}`,
                  }}>
                    {/* Type icon */}
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      background: `${config.color}15`, border: `1px solid ${config.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={13} color={config.color} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                          {touch.contactName || 'Unknown Contact'}
                        </span>
                        <span style={{
                          padding: '2px 7px', borderRadius: 10, fontSize: 9, fontWeight: 600,
                          background: `${config.color}15`, color: config.color,
                        }}>
                          {config.label}
                        </span>
                        <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 'auto' }}>
                          {timeAgo(touch.createdAt)}
                        </span>
                      </div>
                      {touch.notes && (
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                          {touch.notes}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
