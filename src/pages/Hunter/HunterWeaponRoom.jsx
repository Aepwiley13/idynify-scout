import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Target, Crosshair, Archive, BarChart3, ArrowLeft, CheckCircle, Mail } from 'lucide-react';
import WeaponsSection from './sections/WeaponsSection';
import MissionsSection from './sections/MissionsSection';
import ArsenalSection from './sections/ArsenalSection';
import OutcomesSection from './sections/OutcomesSection';
import BarryKnowledgeButton from '../../components/recon/BarryKnowledgeButton';
import './HunterWeaponRoom.css';

/**
 * HUNTER WEAPON ROOM - Main Dashboard
 *
 * Purpose: Mission-based outreach command center
 * Philosophy: User stays in Hunter, navigates between sections
 *
 * Sections:
 * - Weapons: Build messages by type (Email/LinkedIn/Text/Event)
 * - Missions: Active campaigns
 * - Arsenal: Templates library
 * - Outcomes: Analytics & performance
 */

export default function HunterWeaponRoom() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('missions'); // Default to missions tab
  const [missions, setMissions] = useState([]);
  const [campaigns, setCampaigns] = useState([]); // Keep old campaigns for backward compatibility
  const [loading, setLoading] = useState(true);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');

  useEffect(() => {
    loadData();
  }, []);

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

      // Load missions (new intent-driven)
      const missionsRef = collection(db, 'users', user.uid, 'missions');
      const missionsQuery = query(missionsRef, orderBy('createdAt', 'desc'));
      const missionsSnapshot = await getDocs(missionsQuery);

      const missionsList = missionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setMissions(missionsList);

      // Load old campaigns for backward compatibility
      const campaignsRef = collection(db, 'users', user.uid, 'campaigns');
      const campaignsQuery = query(campaignsRef, orderBy('createdAt', 'desc'));
      const campaignsSnapshot = await getDocs(campaignsQuery);

      const campaignsList = campaignsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setCampaigns(campaignsList);
      setLoading(false);
    } catch (error) {
      console.error('Error loading Hunter data:', error);
      setLoading(false);
    }
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

  // Get badge counts
  const activeMissionsCount = missions.filter(m => m.status === 'autopilot' || m.status === 'draft').length;

  if (loading) {
    return (
      <div className="hunter-weapon-room">
        <div className="hunter-loading">
          <div className="hunter-loading-spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="hunter-weapon-room">
      {/* Header */}
      <div className="hunter-header">
        <div className="hunter-header-content">
          <div className="hunter-title-section">
            <button
              onClick={() => navigate('/mission-control-v2')}
              className="btn-back-weapon"
              style={{ marginRight: '1rem' }}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="hunter-icon">
              <Target className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="hunter-title">Hunter Weapon Room</h1>
              <p className="hunter-subtitle">Tactical Outreach Execution</p>
            </div>
          </div>

          <div className="hunter-header-actions">
            <BarryKnowledgeButton variant="compact" />
            {gmailConnected ? (
              <div className="gmail-status-badge">
                <CheckCircle className="w-4 h-4" />
                <span>{gmailEmail}</span>
              </div>
            ) : (
              <button
                onClick={handleConnectGmail}
                className="btn-primary-hunter"
              >
                <Mail className="w-4 h-4" />
                Connect Gmail
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="hunter-tabs">
        <button
          className={`hunter-tab ${activeTab === 'weapons' ? 'active' : ''}`}
          onClick={() => setActiveTab('weapons')}
        >
          <Crosshair className="w-4 h-4" />
          <span>Weapons</span>
        </button>

        <button
          className={`hunter-tab ${activeTab === 'missions' ? 'active' : ''}`}
          onClick={() => setActiveTab('missions')}
        >
          <Target className="w-4 h-4" />
          <span>Missions</span>
          {activeMissionsCount > 0 && (
            <span className="hunter-tab-badge">{activeMissionsCount}</span>
          )}
        </button>

        <button
          className={`hunter-tab ${activeTab === 'arsenal' ? 'active' : ''}`}
          onClick={() => setActiveTab('arsenal')}
        >
          <Archive className="w-4 h-4" />
          <span>Arsenal</span>
        </button>

        <button
          className={`hunter-tab ${activeTab === 'outcomes' ? 'active' : ''}`}
          onClick={() => setActiveTab('outcomes')}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Outcomes</span>
        </button>
      </div>

      {/* Content */}
      <div className="hunter-content">
        {/* Gmail Connection Notice */}
        {!gmailConnected && activeTab === 'weapons' && (
          <div className="gmail-notice">
            <div className="gmail-notice-content">
              <Mail className="w-6 h-6" />
              <div>
                <h3>Connect Gmail to Send Emails</h3>
                <p>Hunter sends emails directly from your Gmail account. Connect to get started.</p>
              </div>
              <button onClick={handleConnectGmail} className="btn-primary-hunter">
                Connect Gmail
              </button>
            </div>
          </div>
        )}

        {activeTab === 'weapons' && <WeaponsSection />}
        {activeTab === 'missions' && <MissionsSection missions={missions} loading={false} />}
        {activeTab === 'arsenal' && <ArsenalSection />}
        {activeTab === 'outcomes' && <OutcomesSection campaigns={campaigns} missions={missions} />}
      </div>
    </div>
  );
}
