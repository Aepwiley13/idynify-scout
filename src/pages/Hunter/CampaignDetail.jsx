import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { ArrowLeft, Mail, Send, CheckCircle, Clock, Edit3, Save, X, Loader, AlertCircle, Sparkles } from 'lucide-react';

export default function CampaignDetail() {
  const navigate = useNavigate();
  const { campaignId } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedMessage, setEditedMessage] = useState({ subject: '', body: '' });
  const [sendingIndex, setSendingIndex] = useState(null);
  const [error, setError] = useState(null);
  const [showSendConfirm, setShowSendConfirm] = useState(null);

  useEffect(() => {
    loadCampaign();
  }, [campaignId]);

  async function loadCampaign() {
    try {
      const user = auth.currentUser;
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
    setEditedMessage({
      subject: campaign.messages[index].subject,
      body: campaign.messages[index].body
    });
  }

  async function saveEdit() {
    try {
      const user = auth.currentUser;
      const updatedMessages = [...campaign.messages];
      updatedMessages[editingIndex] = {
        ...updatedMessages[editingIndex],
        ...editedMessage
      };

      await updateDoc(doc(db, 'users', user.uid, 'campaigns', campaignId), {
        messages: updatedMessages,
        updatedAt: new Date().toISOString()
      });

      setCampaign({ ...campaign, messages: updatedMessages });
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
      const user = auth.currentUser;
      const authToken = await user.getIdToken();
      const message = campaign.messages[index];

      const response = await fetch('/.netlify/functions/gmail-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          campaignId: campaign.id,
          messageIndex: index,
          subject: message.subject,
          body: message.body,
          toEmail: message.contactEmail,
          toName: message.contactName
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send email');
      }

      const data = await response.json();

      // Update local state
      const updatedMessages = [...campaign.messages];
      updatedMessages[index] = {
        ...updatedMessages[index],
        status: 'sent',
        sentAt: data.sentAt,
        gmailMessageId: data.gmailMessageId
      };

      setCampaign({
        ...campaign,
        messages: updatedMessages,
        status: 'in_progress'
      });

      setShowSendConfirm(null);

      // Show success toast
      setTimeout(() => {
        alert(`✓ Email sent to ${message.contactName}`);
      }, 100);

    } catch (err) {
      console.error('Error sending email:', err);
      setError(err.message || 'Failed to send email. Please try again.');
    } finally {
      setSendingIndex(null);
    }
  }

  function getCampaignStats() {
    if (!campaign) return { total: 0, sent: 0, pending: 0 };
    const total = campaign.messages?.length || 0;
    const sent = campaign.messages?.filter(m => m.status === 'sent').length || 0;
    const pending = total - sent;
    return { total, sent, pending };
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-cyan-400 text-xl font-mono">Loading campaign...</div>
      </div>
    );
  }

  if (error && !campaign) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center">
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-center mb-2">Error</h2>
          <p className="text-slate-400 text-center mb-6">{error}</p>
          <button
            onClick={() => navigate('/hunter')}
            className="w-full px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold transition-colors"
          >
            Back to Hunter
          </button>
        </div>
      </div>
    );
  }

  const stats = getCampaignStats();
  const statusColor = {
    draft: 'text-slate-400 bg-slate-700/50',
    in_progress: 'text-blue-400 bg-blue-500/20',
    completed: 'text-green-400 bg-green-500/20'
  }[campaign.status] || 'text-slate-400 bg-slate-700/50';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Send Confirmation Modal */}
      {showSendConfirm !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4">Send Email?</h3>
            <div className="mb-6">
              <p className="text-slate-300 mb-2">
                Send email to <span className="font-bold">{campaign.messages[showSendConfirm].contactName}</span>?
              </p>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 mt-4">
                <div className="text-sm text-slate-400 mb-2">Subject:</div>
                <div className="font-medium mb-3">{campaign.messages[showSendConfirm].subject}</div>
                <div className="text-sm text-slate-400 mb-2">Preview:</div>
                <div className="text-sm text-slate-300 line-clamp-3">
                  {campaign.messages[showSendConfirm].body.substring(0, 150)}...
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setShowSendConfirm(null)}
                className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSendEmail(showSendConfirm)}
                disabled={sendingIndex !== null}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-lg font-bold transition-all flex items-center justify-center gap-2"
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
      )}

      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/hunter')}
                className="text-slate-400 hover:text-white transition-colors"
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
                    <span className="flex items-center gap-1 px-3 py-1 bg-purple-500/20 border border-purple-500/30 rounded-full text-xs text-purple-400">
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
                <div className="text-slate-400">Total</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-400">{stats.sent}</div>
                <div className="text-slate-400">Sent</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-400">{stats.pending}</div>
                <div className="text-slate-400">Pending</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-500/20 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-400">{error}</span>
          </div>
        )}

        {/* Messages List */}
        <div className="space-y-6">
          {campaign.messages.map((message, index) => (
            <div
              key={index}
              className={`bg-slate-800/50 border rounded-xl p-6 transition-all ${
                message.status === 'sent'
                  ? 'border-green-500/30'
                  : 'border-slate-700'
              }`}
            >
              {/* Message Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    message.status === 'sent'
                      ? 'bg-green-500/20'
                      : 'bg-purple-500/20'
                  }`}>
                    {message.status === 'sent' ? (
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    ) : (
                      <Mail className="w-5 h-5 text-purple-400" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium">{message.contactName}</div>
                    <div className="text-sm text-slate-400">{message.contactEmail}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {message.status === 'sent' ? (
                    <div className="text-sm text-green-400">
                      ✓ Sent {new Date(message.sentAt).toLocaleString()}
                    </div>
                  ) : editingIndex === index ? (
                    <>
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEditing(index)}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        <Edit3 className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => setShowSendConfirm(index)}
                        disabled={sendingIndex !== null}
                        className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
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
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Message</label>
                    <textarea
                      value={editedMessage.body}
                      onChange={(e) => setEditedMessage({ ...editedMessage, body: e.target.value })}
                      rows={10}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors font-mono text-sm"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm text-slate-400 mb-1">Subject:</div>
                    <div className="font-medium">{message.subject}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-1">Message:</div>
                    <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap">
                      {message.body}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
