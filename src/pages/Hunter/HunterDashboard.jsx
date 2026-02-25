import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs, query, orderBy, doc, getDoc, where, limit, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Mail, Plus, CheckCircle, Clock, Send, ArrowLeft, Sparkles } from 'lucide-react';
import FollowUpCard from '../../components/hunter/FollowUpCard';

export default function HunterDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [followUps, setFollowUps] = useState([]);

  // Keep a ref to the notifications unsubscribe so we can clean up on unmount
  const unsubNotificationsRef = useRef(null);

  useEffect(() => {
    loadData();

    // Check for OAuth success
    const params = new URLSearchParams(location.search);
    if (params.get('connected') === 'true') {
      setShowSuccessToast(true);
      setTimeout(() => setShowSuccessToast(false), 3000);
      // Remove query param
      navigate('/hunter', { replace: true });
    }

    return () => {
      if (unsubNotificationsRef.current) {
        unsubNotificationsRef.current();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check Gmail connection
      const gmailDoc = await getDoc(doc(db, 'users', user.uid, 'integrations', 'gmail'));
      if (gmailDoc.exists()) {
        const gmailData = gmailDoc.data();
        setGmailConnected(gmailData.status === 'connected');
        setGmailEmail(gmailData.email || '');
      }

      // Load campaigns
      const campaignsRef = collection(db, 'users', user.uid, 'campaigns');
      const campaignsQuery = query(campaignsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(campaignsQuery);

      const campaignsList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setCampaigns(campaignsList);
      setLoading(false);

      // Real-time listener for unread follow-up notifications
      const notificationsRef = collection(db, 'users', user.uid, 'notifications');
      const notifQuery = query(
        notificationsRef,
        where('read', '==', false),
        where('type', '==', 'follow_up_due'),
        orderBy('createdAt', 'desc'),
        limit(10)
      );

      unsubNotificationsRef.current = onSnapshot(notifQuery, snapshot => {
        setFollowUps(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      }, err => {
        console.error('[HunterDashboard] Notifications listener error:', err);
      });
    } catch (error) {
      console.error('Error loading Hunter data:', error);
      setLoading(false);
    }
  }

  function handleDismissFollowUp(notificationId) {
    setFollowUps(prev => prev.filter(n => n.id !== notificationId));
  }

  async function handleConnectGmail() {
    const user = auth.currentUser;
    const authToken = await user.getIdToken();

    const response = await fetch('/.netlify/functions/gmail-oauth-init', {
      method: 'POST',
      body: JSON.stringify({ userId: user.uid, authToken })
    });

    const data = await response.json();
    window.location.href = data.authUrl;
  }

  function getCampaignStats(campaign) {
    const total = campaign.messages?.length || 0;
    const sent = campaign.messages?.filter(m => m.status === 'sent').length || 0;
    const pending = total - sent;
    return { total, sent, pending };
  }

  const userId = auth.currentUser?.uid;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-cyan-400 text-xl font-mono">Loading Hunter...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Success Toast */}
      {showSuccessToast && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50">
          <CheckCircle className="w-5 h-5" />
          Gmail connected successfully!
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/mission-control-v2')}
                className="text-gray-500 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                  <Mail className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Hunter</h1>
                  <p className="text-sm text-gray-500">Outreach Execution</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Gmail Status Badge */}
              {gmailConnected ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-green-400">{gmailEmail}</span>
                </div>
              ) : (
                <button
                  onClick={handleConnectGmail}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors"
                >
                  Connect Gmail
                </button>
              )}

              {/* Create Campaign Button */}
              <button
                onClick={() => navigate('/hunter/campaign/new')}
                disabled={!gmailConnected}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${
                  gmailConnected
                    ? 'bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 shadow-lg'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Plus className="w-5 h-5" />
                Create Campaign
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Gmail Connection Card (if not connected) */}
        {!gmailConnected && (
          <div className="mb-8 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-500/30 rounded-2xl p-8">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold mb-2">Connect Gmail to Start Sending</h3>
                <p className="text-gray-700 mb-4">
                  Hunter sends emails directly from your Gmail account. Connect your Gmail to create campaigns and send personalized outreach.
                </p>
                <button
                  onClick={handleConnectGmail}
                  className="px-6 py-3 bg-blue-500 hover:bg-blue-600 rounded-lg font-bold transition-colors"
                >
                  Connect Gmail Account
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Follow-Ups Section — live from notifications collection */}
        {followUps.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span>⚡</span>
              Follow Ups
              <span className="ml-1 bg-purple-100 text-purple-700 text-xs font-mono font-bold px-2 py-0.5 rounded-full">
                {followUps.length}
              </span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {followUps.map(notification => (
                <FollowUpCard
                  key={notification.id}
                  notification={notification}
                  userId={userId}
                  onDismiss={handleDismissFollowUp}
                />
              ))}
            </div>
          </div>
        )}

        {/* Campaigns List */}
        <div>
          <h2 className="text-xl font-bold mb-4">Campaigns</h2>

          {campaigns.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-bold mb-2">No campaigns yet</h3>
              <p className="text-gray-500 mb-6">
                {gmailConnected
                  ? "Create your first campaign to start outreach!"
                  : "Connect Gmail to create your first campaign"
                }
              </p>
              {gmailConnected && (
                <button
                  onClick={() => navigate('/hunter/campaign/new')}
                  className="px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-lg font-bold transition-all"
                >
                  Create First Campaign
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {campaigns.map(campaign => {
                const stats = getCampaignStats(campaign);
                const statusColor = {
                  draft: 'text-gray-500 bg-gray-100',
                  in_progress: 'text-blue-400 bg-blue-500/20',
                  completed: 'text-green-400 bg-green-500/20'
                }[campaign.status] || 'text-gray-500 bg-gray-100';

                return (
                  <div
                    key={campaign.id}
                    onClick={() => navigate(`/hunter/campaign/${campaign.id}`)}
                    className="bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl p-6 cursor-pointer transition-all hover:bg-gray-100"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-bold">{campaign.name}</h3>
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

                        <div className="flex items-center gap-6 text-sm text-gray-500">
                          <span className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            {stats.total} contacts
                          </span>
                          <span className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-400" />
                            {stats.sent} sent
                          </span>
                          <span className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-gray-500" />
                            {stats.pending} pending
                          </span>
                        </div>
                      </div>

                      <div className="text-right text-sm text-gray-400">
                        {new Date(campaign.createdAt).toLocaleDateString()}
                      </div>
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
