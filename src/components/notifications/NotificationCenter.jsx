/**
 * NotificationCenter — Persistent notification drawer for Command Center.
 *
 * Bell icon with unread badge → slide-out panel with two tabs:
 *   - Tasks: follow_up_due, reminder_notification (actionable, "Mark as Done")
 *   - Relationship Events: referral_received, referral_converted, status_change ("View Profile")
 *
 * Backed by Firestore: users/{userId}/notifications
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  X,
  GitBranch,
  CheckCircle,
  AlertCircle,
  Clock,
  User,
  Thermometer,
  Check
} from 'lucide-react';
import {
  subscribeToNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  formatNotification,
  NOTIFICATION_CATEGORIES
} from '../../services/notificationService';

const ACCENT = '#00c4d4';
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'relationship', label: 'Relationship' },
  { id: 'task', label: 'Tasks' },
];

export default function NotificationCenter({ userId, T }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [activeTab, setActiveTab] = useState('all');

  // Subscribe to unread notifications
  useEffect(() => {
    if (!userId) return;
    const unsub = subscribeToNotifications(userId, setNotifications);
    return unsub;
  }, [userId]);

  const unreadCount = notifications.length;

  const filtered = activeTab === 'all'
    ? notifications
    : notifications.filter(n => n.category === activeTab);

  const handleAction = async (notification) => {
    const formatted = formatNotification(notification);
    if (formatted.action === 'view_profile' && notification.contactId) {
      navigate(`/scout/contact/${notification.contactId}`);
      setOpen(false);
    }
    await markNotificationRead(userId, notification.id);
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead(userId);
  };

  const iconForType = (type) => {
    switch (type) {
      case 'referral_received': return <GitBranch size={14} color="#8b5cf6" />;
      case 'referral_converted': return <CheckCircle size={14} color="#10b981" />;
      case 'contact_status_change': return <User size={14} color="#3b82f6" />;
      case 'contact_going_cold': return <Thermometer size={14} color="#6b7280" />;
      case 'follow_up_due': return <Clock size={14} color="#f59e0b" />;
      case 'reminder_notification': return <AlertCircle size={14} color="#f59e0b" />;
      default: return <Bell size={14} color={T.textFaint} />;
    }
  };

  const timeSince = (timestamp) => {
    if (!timestamp) return '';
    const ms = timestamp?.toMillis ? timestamp.toMillis() : new Date(timestamp).getTime();
    if (isNaN(ms)) return '';
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <>
      {/* Bell icon trigger */}
      <div
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          width: 34, height: 34, borderRadius: 9,
          background: open ? `${ACCENT}18` : T.accentBg,
          border: `1px solid ${open ? ACCENT : T.accentBdr}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.15s', position: 'relative',
        }}
      >
        <Bell size={16} color={open ? ACCENT : T.textFaint} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 16, height: 16, borderRadius: 8,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 700, padding: '0 4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(239,68,68,0.4)',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>

      {/* Notification drawer */}
      {open && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 380, maxWidth: '100vw', zIndex: 500,
          background: T.cardBg || '#fff',
          borderLeft: `1px solid ${T.border}`,
          boxShadow: `0 0 60px ${T.isDark ? '#00000080' : '#00000020'}`,
          display: 'flex', flexDirection: 'column',
          animation: 'slideInRight 0.2s ease',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          }}>
            <Bell size={18} color={ACCENT} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Notifications</div>
              <div style={{ fontSize: 11, color: T.textMuted }}>
                {unreadCount} unread
              </div>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  padding: '5px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
                  background: 'transparent', color: T.textMuted,
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Mark all read
              </button>
            )}
            <div
              onClick={() => setOpen(false)}
              style={{ cursor: 'pointer', padding: 4 }}
            >
              <X size={18} color={T.textMuted} />
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{
            display: 'flex', gap: 0, padding: '0 20px',
            borderBottom: `1px solid ${T.border}`, flexShrink: 0,
          }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 14px', border: 'none',
                  background: 'transparent',
                  color: activeTab === tab.id ? ACCENT : T.textMuted,
                  fontSize: 12, fontWeight: activeTab === tab.id ? 700 : 500,
                  cursor: 'pointer',
                  borderBottom: `2px solid ${activeTab === tab.id ? ACCENT : 'transparent'}`,
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                {tab.label}
                {tab.id === 'relationship' && notifications.filter(n => n.category === NOTIFICATION_CATEGORIES.RELATIONSHIP).length > 0 && (
                  <span style={{
                    marginLeft: 5, minWidth: 14, height: 14, borderRadius: 7,
                    background: '#8b5cf620', color: '#8b5cf6',
                    fontSize: 9, fontWeight: 700, padding: '0 4px',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {notifications.filter(n => n.category === NOTIFICATION_CATEGORIES.RELATIONSHIP).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Notification list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {filtered.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '60px 20px', gap: 12,
              }}>
                <Bell size={32} color={T.textFaint} style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 13, color: T.textFaint, textAlign: 'center' }}>
                  {activeTab === 'all' ? 'No unread notifications' : `No ${activeTab} notifications`}
                </div>
              </div>
            ) : (
              filtered.map(notification => {
                const formatted = formatNotification(notification);
                return (
                  <div
                    key={notification.id}
                    onClick={() => handleAction(notification)}
                    style={{
                      display: 'flex', gap: 12, padding: '12px 10px',
                      borderRadius: 10, cursor: 'pointer',
                      transition: 'background 0.1s',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = T.surface || '#f9fafb'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: `${formatted.color}12`,
                      border: `1px solid ${formatted.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {iconForType(notification.type)}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: T.text,
                        lineHeight: 1.4, marginBottom: 2,
                      }}>
                        {formatted.title}
                      </div>
                      {formatted.subtitle && (
                        <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.4 }}>
                          {formatted.subtitle}
                        </div>
                      )}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
                      }}>
                        <span style={{ fontSize: 10, color: T.textFaint }}>
                          {timeSince(notification.createdAt)}
                        </span>
                        {formatted.actionLabel && (
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            color: formatted.color,
                          }}>
                            {formatted.actionLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick action */}
                    {notification.category === NOTIFICATION_CATEGORIES.TASK && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          markNotificationRead(userId, notification.id);
                        }}
                        title="Mark as done"
                        style={{
                          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                          background: T.surface, border: `1px solid ${T.border}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', alignSelf: 'center',
                        }}
                      >
                        <Check size={13} color={T.textFaint} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 499,
            background: 'rgba(0,0,0,0.2)',
          }}
        />
      )}

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
