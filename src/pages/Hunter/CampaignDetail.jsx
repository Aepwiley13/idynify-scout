import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useActiveUserId, useImpersonation } from '../../context/ImpersonationContext';
import { ArrowLeft, Mail, Send, CheckCircle, Clock, Edit3, Save, X, Loader, AlertCircle, Sparkles } from 'lucide-react';
import OutcomeTracker from '../../components/hunter/OutcomeTracker';
import FollowUpComposer from '../../components/hunter/FollowUpComposer';
import OutcomeSuggestions from '../../components/hunter/OutcomeSuggestions';
import { executeSendAction, CHANNELS, SEND_RESULT } from '../../utils/sendActionResolver';

export default function CampaignDetail() {
  const navigate = useNavigate();
  const { campaignId } = useParams();
  const impersonatedUserId = useActiveUserId();
  const { isImpersonating } = useImpersonation();
  const getEffectiveUser = () => {
    const realUser = auth.currentUser;
    if (!realUser) return null;
    if (isImpersonating && impersonatedUserId) {
      return { uid: impersonatedUserId, getIdToken: () => realUser.getIdToken() };
    }
    return realUser;
  };
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedMessage, setEditedMessage] = useState({ subject: '', body: '' });
  const [sendingIndex, setSendingIndex] = useState(null);
  const [error, setError] = useState(null);
  const [showSendConfirm, setShowSendConfirm] = useState(null);
  const [followUpContact, setFollowUpContact] = useState(null); // PHASE 2: Follow-up modal state

  useEffect(() => {
    loadCampaign();
  }, [campaignId]);

  async function loadCampaign() {
    try {
      const user = getEffectiveUser();
      if (!user) {
        navigate('/login');
        return;
      }

      const campaignDoc = await getDoc(doc(db, 'users', user.uid, 'campaigns', campaignId));

      if (!campaignDoc.exists()) {
        setError('Campaign not found');
        setLoading(false);
        return;
      }

      setCampaign({ id: campaignDoc.id, ...campaignDoc.data() });
      setLoading(false);
    } catch (err) {
      console.error('Error loading campaign:', err);
      setError('Failed to load campaign');
      setLoading(false);
    }
  }

  function startEditing(index) {
    setEditingIndex(index);
    const items = campaign.contacts || campaign.messages;
    setEditedMessage({
      subject: items[index].subject,
      body: items[index].body
    });
  }

  async function saveEdit() {
    try {
      const user = getEffectiveUser();
      const items = campaign.contacts || campaign.messages;
      const updatedItems = [...items];
      updatedItems[editingIndex] = {
        ...updatedItems[editingIndex],
        ...editedMessage
      };

      // Update using the correct field name (contacts or messages)
      const updateField = campaign.contacts ? 'contacts' : 'messages';
      await updateDoc(doc(db, 'users', user.uid, 'campaigns', campaignId), {
        [updateField]: updatedItems,
        updatedAt: new Date().toISOString()
      });

      setCampaign({ ...campaign, [updateField]: updatedItems });
      setEditingIndex(null);
    } catch (err) {
      console.error('Error saving edit:', err);
      setError('Failed to save changes');
    }
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditedMessage({ subject: '', body: '' });
  }

  async function handleSendEmail(index) {
    setSendingIndex(index);
    setError(null);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const items = campaign.contacts || campaign.messages;
      const message = items[index];
      const contactName = message.contactName || message.name || '';

      const sendContact = {
        id: message.contactId,
        email: message.contactEmail || message.email,
        firstName: contactName.split(' ')[0] || '',
        lastName: contactName.split(' ').slice(1).join(' ') || '',
      };

      const result = await executeSendAction({
        channel: CHANNELS.EMAIL,
        userId: user.uid,
        contact: sendContact,
        subject: message.subject,
        body: message.body,
      });

      if (result.result === SEND_RESULT.SENT) {
        const sentAt = result.sentAt || new Date().toISOString();
        const gmailMessageId = result.gmailMessageId || null;

        const updatedItems = [...items];
        updatedItems[index] = {
          ...updatedItems[index],
          status: 'sent',
          sentAt,
          gmailMessageId,
        };

        const allSent = updatedItems.every(m => m.status === 'sent');
        const campaignStatus = allSent ? 'completed' : 'in_progress';
        const updateField = campaign.contacts ? 'contacts' : 'messages';

        await updateDoc(doc(db, 'users', user.uid, 'campaigns', campaignId), {
          [updateField]: updatedItems,
          status: campaignStatus,
          updatedAt: new Date().toISOString(),
          ...(allSent ? { completedAt: new Date().toISOString() } : {}),
        });

        setCampaign({
          ...campaign,
          [updateField]: updatedItems,
          status: campaignStatus,
        });

        setShowSendConfirm(null);
        setTimeout(() => {
          alert(`✓ Email sent to ${contactName}`);
        }, 100);
      } else if (result.result === SEND_RESULT.OPENED) {
        setShowSendConfirm(null);
        setTimeout(() => {
          alert(result.message || 'Email app opened — complete the send there.');
        }, 100);
      } else {
        throw new Error(result.error || result.reason || 'Failed to send email');
      }

    } catch (err) {
      console.error('Error sending email:', err);
      setError(err.message || 'Failed to send email. Please try again.');
    } finally {
      setSendingIndex(null);
    }
  }

  // NEW: Handle outcome updates from OutcomeTracker
  function handleOutcomeUpdate(contactId, outcome, isTerminal) {
    // Update local state immediately
    setCampaign(prev => ({
      ...prev,
      contacts: prev.contacts.map(c =>
        c.contactId === contactId
          ? {
              ...c,
              outcome,
              outcomeMarkedAt: new Date(),
              outcomeLocked: isTerminal || false,
              outcomeLockedAt: isTerminal ? new Date() : null
            }
          : c
      )
    }));
  }

  function getCampaignStats() {
    if (!campaign) return { total: 0, sent: 0, pending: 0 };
    // Support both old (messages) and new (contacts) structure
    const items = campaign.contacts || campaign.messages || [];
    const total = items.length;
    const sent = items.filter(item => item.status === 'sent').length;
    const pending = total - sent;
    return { total, sent, pending };
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="text-[color:var(--text-secondary)] text-xl font-mono">Loading campaign...</div>
      </div>
    );
  }

  if (error && !campaign) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-primary)] text-[color:var(--text-primary)] flex items-center justify-center">
        <div className="bg-[var(--bg-card)] border border-[color:var(--border)] rounded-2xl p-8 max-w-md">
          <AlertCircle className="w-12 h-12 text-[color:color-mix(in_srgb,#ef4444_70%,var(--text-primary))] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-center mb-2">Error</h2>
          <p className="text-[color:var(--text-secondary)] text-center mb-6">{error}</p>
          <button
            onClick={() => navigate('/hunter?tab=campaigns')}
            className="w-full px-6 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-2)] border border-[color:var(--border-2)] text-[color:var(--text-primary)] rounded-lg font-bold transition-colors"
          >
            Back to Hunter
          </button>
        </div>
      </div>
    );
  }

  const stats = getCampaignStats();
  const statusColor = {
    draft: 'text-[color:var(--text-secondary)] bg-[var(--bg-secondary)] border border-[color:var(--border-2)]',
    in_progress: 'text-[color:var(--text-primary)] bg-[var(--accent-bg)] border border-[color:var(--accent-border)]',
    completed: 'text-[color:var(--text-primary)] bg-[var(--status-success-bg)] border border-green-500/30'
  }[campaign.status] || 'text-[color:var(--text-secondary)] bg-[var(--bg-secondary)] border border-[color:var(--border-2)]';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-primary)] text-[color:var(--text-primary)]">
      {/* Send Confirmation Modal */}
      {showSendConfirm !== null && (() => {
        const items = campaign.contacts || campaign.messages;
        const currentMessage = items[showSendConfirm];
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[var(--bg-card)] border border-[color:var(--border)] rounded-2xl p-8 max-w-md w-full mx-4">
              <h3 className="text-xl font-bold mb-4">Send Email?</h3>
              <div className="mb-6">
                <p className="text-[color:var(--text-primary)] mb-2">
                  Send email to <span className="font-bold">{currentMessage.contactName || currentMessage.name}</span>?
                </p>
                <div className="bg-[var(--bg-card-2)] border border-[color:var(--border)] rounded-lg p-4 mt-4">
                  <div className="text-sm text-[color:var(--text-secondary)] mb-2">Subject:</div>
                  <div className="font-medium mb-3">{currentMessage.subject}</div>
                  <div className="text-sm text-[color:var(--text-secondary)] mb-2">Preview:</div>
                  <div className="text-sm text-[color:var(--text-primary)] line-clamp-3">
                    {currentMessage.body.substring(0, 150)}...
                  </div>
                </div>
              </div>
            <div className="flex gap-4">
              <button
                onClick={() => setShowSendConfirm(null)}
                className="flex-1 px-6 py-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-2)] border border-[color:var(--border-2)] text-[color:var(--text-primary)] rounded-lg font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSendEmail(showSendConfirm)}
                disabled={sendingIndex !== null}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white rounded-lg font-bold transition-all flex items-center justify-center gap-2"
              >
                {sendingIndex === showSendConfirm ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Header */}
      <div className="border-b border-[color:var(--border)] bg-[var(--bg-nav)] backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/hunter?tab=campaigns')}
                className="text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold">{campaign.name}</h1>
                <div className="flex items-center gap-3 mt-1">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                    {campaign.status === 'in_progress' ? 'In Progress' : campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                  </span>
                  {campaign.reconUsed && (
                    <span className="flex items-center gap-1 px-3 py-1 bg-[var(--accent-bg)] border border-[color:var(--accent-border)] rounded-full text-xs text-[color:var(--text-primary)]">
                      <Sparkles className="w-3 h-3" />
                      RECON
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-[color:var(--text-secondary)]">Total</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[color:var(--text-primary)]">{stats.sent}</div>
                <div className="text-[color:var(--text-secondary)]">Sent</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[color:var(--text-secondary)]">{stats.pending}</div>
                <div className="text-[color:var(--text-secondary)]">Pending</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 bg-[var(--status-error-bg)] border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-[color:color-mix(in_srgb,#ef4444_70%,var(--text-primary))]" />
            <span className="text-[color:var(--text-primary)]">{error}</span>
          </div>
        )}

        {/* Messages List */}
        <div className="space-y-6">
          {/* Support both old (messages) and new (contacts) structure */}
          {(campaign.contacts || campaign.messages).map((message, index) => (
            <div
              key={index}
              className={`bg-[var(--bg-card)] border rounded-xl p-6 transition-all ${
                message.status === 'sent'
                  ? 'border-green-500/30'
                  : 'border-[color:var(--border)]'
              }`}
            >
              {/* Message Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    message.status === 'sent'
                      ? 'bg-green-500/20'
                      : 'bg-[var(--accent-bg)]'
                  }`}>
                    {message.status === 'sent' ? (
                      <CheckCircle className="w-5 h-5 text-[color:color-mix(in_srgb,#16a34a_70%,var(--text-primary))]" />
                    ) : (
                      <Mail className="w-5 h-5 text-[color:var(--accent)]" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium">{message.contactName}</div>
                    <div className="text-sm text-[color:var(--text-secondary)]">{message.contactEmail}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {message.status === 'sent' ? (
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-[color:var(--text-primary)]">
                        ✓ Sent {new Date(message.sentAt).toLocaleString()}
                      </div>
                      {/* NEW: Outcome tracker for Phase 1 campaigns (only if using contacts structure) */}
                      {campaign.contacts && (
                        <OutcomeTracker
                          contact={message}
                          campaignId={campaign.id}
                          onOutcomeUpdate={handleOutcomeUpdate}
                        />
                      )}
                    </div>
                  ) : editingIndex === index ? (
                    <>
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-2)] border border-[color:var(--border-2)] text-[color:var(--text-primary)] rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEditing(index)}
                        className="px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-2)] border border-[color:var(--border-2)] text-[color:var(--text-primary)] rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        <Edit3 className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => setShowSendConfirm(index)}
                        disabled={sendingIndex !== null}
                        className="px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                      >
                        <Send className="w-4 h-4" />
                        Send Email
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Message Content */}
              {editingIndex === index ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Subject</label>
                    <input
                      type="text"
                      value={editedMessage.subject}
                      onChange={(e) => setEditedMessage({ ...editedMessage, subject: e.target.value })}
                      className="w-full px-4 py-2 bg-[var(--input-bg)] text-[color:var(--text-primary)] border border-[color:var(--input-border)] rounded-lg focus:outline-none focus:border-[color:var(--input-focus)] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Message</label>
                    <textarea
                      value={editedMessage.body}
                      onChange={(e) => setEditedMessage({ ...editedMessage, body: e.target.value })}
                      rows={10}
                      className="w-full px-4 py-3 bg-[var(--input-bg)] text-[color:var(--text-primary)] border border-[color:var(--input-border)] rounded-lg focus:outline-none focus:border-[color:var(--input-focus)] transition-colors font-mono text-sm"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm text-[color:var(--text-secondary)] mb-1">Subject:</div>
                    <div className="font-medium">{message.subject}</div>
                  </div>
                  <div>
                    <div className="text-sm text-[color:var(--text-secondary)] mb-1">Message:</div>
                    <div className="bg-[var(--bg-card-2)] border border-[color:var(--border)] rounded-lg p-4 font-mono text-sm whitespace-pre-wrap">
                      {message.body}
                    </div>
                  </div>

                  {/* PHASE 2: Outcome Suggestions (only for sent messages with outcomes) */}
                  {message.status === 'sent' && message.outcome && (
                    <OutcomeSuggestions
                      outcome={message.outcome}
                      onFollowUp={() => setFollowUpContact(message)}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* PHASE 2: Follow-Up Composer Modal */}
      {followUpContact && (
        <FollowUpComposer
          contact={followUpContact}
          originalCampaign={campaign}
          onClose={() => setFollowUpContact(null)}
          onFollowUpCreated={(data) => {
            console.log('Follow-up sent:', data);
            setFollowUpContact(null);
            // Optionally reload campaign to show follow-up was sent
          }}
        />
      )}
    </div>
  );
}
