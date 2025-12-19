import { useState, useEffect } from 'react';
import { doc, getDoc, collection, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [icpData, setIcpData] = useState(null);
  const [filter, setFilter] = useState('pending'); // pending, accepted, rejected, all
  const navigate = useNavigate();

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const icpRef = doc(db, 'icpData', auth.currentUser.uid);
      const icpSnap = await getDoc(icpRef);
      if (icpSnap.exists()) {
        setIcpData(icpSnap.data());
      }

      const leadsRef = collection(db, 'leads', auth.currentUser.uid, 'generatedLeads');
      const leadsSnap = await getDocs(leadsRef);
      const existingLeads = leadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLeads(existingLeads);
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const generateLeads = async () => {
    if (!icpData) {
      alert('No ICP data found. Please complete the questionnaire first.');
      navigate('/questionnaire');
      return;
    }

    setGenerating(true);
    setError('');

    try {
      const response = await fetch('http://localhost:8888/.netlify/functions/generate-leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answers: icpData.answers
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate leads');
      }

      const newLeads = data.leads || [];
      
      if (newLeads.length === 0) {
        setError('No leads found. Try adjusting your ICP criteria.');
        setGenerating(false);
        return;
      }

      const savePromises = newLeads.map(lead => {
        const leadRef = doc(db, 'leads', auth.currentUser.uid, 'generatedLeads', lead.id.toString());
        return setDoc(leadRef, {
          ...lead,
          generatedAt: new Date().toISOString(),
          status: 'pending'
        });
      });

      await Promise.all(savePromises);
      
      setLeads(newLeads.map(lead => ({ ...lead, status: 'pending' })));
      
    } catch (err) {
      console.error('Error:', err);
      setError(err.message || 'Failed to generate leads. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleAccept = async (leadId) => {
    try {
      const leadRef = doc(db, 'leads', auth.currentUser.uid, 'generatedLeads', leadId.toString());
      await updateDoc(leadRef, {
        status: 'accepted',
        acceptedAt: new Date().toISOString()
      });

      setLeads(leads.map(lead => 
        lead.id === leadId ? { ...lead, status: 'accepted' } : lead
      ));
    } catch (error) {
      console.error('Error accepting lead:', error);
      alert('Failed to accept lead. Please try again.');
    }
  };

  const handleReject = async (leadId) => {
    try {
      const leadRef = doc(db, 'leads', auth.currentUser.uid, 'generatedLeads', leadId.toString());
      await updateDoc(leadRef, {
        status: 'rejected',
        rejectedAt: new Date().toISOString()
      });

      setLeads(leads.map(lead => 
        lead.id === leadId ? { ...lead, status: 'rejected' } : lead
      ));
    } catch (error) {
      console.error('Error rejecting lead:', error);
      alert('Failed to reject lead. Please try again.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const filteredLeads = leads.filter(lead => {
    if (filter === 'all') return true;
    return lead.status === filter;
  });

  const pendingCount = leads.filter(l => l.status === 'pending').length;
  const acceptedCount = leads.filter(l => l.status === 'accepted').length;
  const rejectedCount = leads.filter(l => l.status === 'rejected').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-8xl mb-6 animate-bounce">🐻</div>
          <p className="text-cyan-400 text-xl font-mono">Loading Mission Control...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(150)].map((_, i) => (
          <div
            key={i}
            className="absolute bg-white rounded-full"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              top: Math.random() * 100 + '%',
              left: Math.random() * 100 + '%',
              opacity: Math.random() * 0.7 + 0.3,
              animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>

      <div className="relative z-10 bg-black/60 backdrop-blur border-b border-cyan-500/30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-4xl">🐻</span>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-400 to-cyan-400 bg-clip-text text-transparent">
                Barry AI Scout
              </h1>
              <p className="text-cyan-400 text-xs font-mono">MISSION CONTROL</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-cyan-950/50 border border-cyan-500/30 rounded-lg text-cyan-400 text-sm font-mono hover:bg-cyan-900/50 transition"
          >
            LOGOUT
          </button>
        </div>
      </div>

      <div className="relative z-10 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">
              Welcome, Agent! 🎯
            </h2>
            <p className="text-cyan-300 text-lg">
              {leads.length > 0 
                ? `You have ${leads.length} leads ready for action!`
                : 'Your ICP data is locked and loaded. Ready to discover your leads?'
              }
            </p>
          </div>

          {leads.length === 0 && !generating && (
            <div className="max-w-2xl mx-auto mb-12">
              <button
                onClick={generateLeads}
                disabled={generating}
                className="w-full bg-gradient-to-r from-pink-500 via-purple-600 to-cyan-500 text-white px-8 py-6 rounded-xl font-bold text-2xl hover:scale-[1.02] transition-all shadow-2xl shadow-cyan-500/50 disabled:opacity-50"
              >
                🚀 GENERATE MY FIRST LEADS
              </button>
            </div>
          )}

          {generating && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4 animate-bounce">🐻</div>
              <p className="text-cyan-400 text-xl font-mono animate-pulse">
                Barry is analyzing your ICP and searching for leads...
              </p>
            </div>
          )}

          {error && (
            <div className="max-w-2xl mx-auto mb-8 bg-red-500/10 border border-red-500/50 rounded-xl p-6">
              <p className="text-red-300 font-mono">⚠️ {error}</p>
            </div>
          )}

          {leads.length > 0 && (
            <div>
              <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => setFilter('pending')}
                    className={`px-4 py-2 rounded-lg font-bold transition ${
                      filter === 'pending'
                        ? 'bg-cyan-500 text-white'
                        : 'bg-cyan-950/50 border border-cyan-500/30 text-cyan-400'
                    }`}
                  >
                    Pending ({pendingCount})
                  </button>
                  <button
                    onClick={() => setFilter('accepted')}
                    className={`px-4 py-2 rounded-lg font-bold transition ${
                      filter === 'accepted'
                        ? 'bg-green-500 text-white'
                        : 'bg-green-950/50 border border-green-500/30 text-green-400'
                    }`}
                  >
                    Accepted ({acceptedCount})
                  </button>
                  <button
                    onClick={() => setFilter('rejected')}
                    className={`px-4 py-2 rounded-lg font-bold transition ${
                      filter === 'rejected'
                        ? 'bg-red-500 text-white'
                        : 'bg-red-950/50 border border-red-500/30 text-red-400'
                    }`}
                  >
                    Rejected ({rejectedCount})
                  </button>
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-4 py-2 rounded-lg font-bold transition ${
                      filter === 'all'
                        ? 'bg-purple-500 text-white'
                        : 'bg-purple-950/50 border border-purple-500/30 text-purple-400'
                    }`}
                  >
                    All ({leads.length})
                  </button>
                </div>
                <button
                  onClick={generateLeads}
                  disabled={generating}
                  className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-white rounded-lg font-bold hover:scale-105 transition disabled:opacity-50"
                >
                  {generating ? '🔄 Generating...' : '🔄 Refresh Leads'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className={`bg-black/60 backdrop-blur rounded-xl p-6 hover:border-cyan-400/50 transition ${
                      lead.status === 'accepted'
                        ? 'border-2 border-green-500/50'
                        : lead.status === 'rejected'
                        ? 'border-2 border-red-500/50 opacity-60'
                        : 'border border-cyan-500/30'
                    }`}
                  >
                    {/* Status Badge */}
                    {lead.status !== 'pending' && (
                      <div className="mb-3">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                          lead.status === 'accepted'
                            ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                            : 'bg-red-500/20 text-red-400 border border-red-500/50'
                        }`}>
                          {lead.status === 'accepted' ? '✅ ACCEPTED' : '❌ REJECTED'}
                        </span>
                      </div>
                    )}

                    <div className="flex items-start gap-4 mb-4">
                      {lead.photoUrl ? (
                        <img
                          src={lead.photoUrl}
                          alt={lead.name}
                          className="w-16 h-16 rounded-full border-2 border-cyan-500/30"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-2xl">
                          👤
                        </div>
                      )}
                      <div className="flex-1">
                        <h4 className="text-xl font-bold text-white mb-1">
                          {lead.name}
                        </h4>
                        <p className="text-cyan-400 text-sm">{lead.title}</p>
                        <p className="text-gray-400 text-sm">{lead.company}</p>
                      </div>
                    </div>

                    <div className="space-y-2 mb-4">
                      {lead.email && (
                        <a
                          href={`mailto:${lead.email}`}
                          className="block text-sm text-pink-400 hover:underline font-mono"
                        >
                          📧 {lead.email}
                        </a>
                      )}
                      {lead.linkedinUrl && (
                        <a
                          href={lead.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-sm text-cyan-400 hover:underline"
                        >
                          🔗 LinkedIn Profile
                        </a>
                      )}
                      {lead.companyDomain && (
                        <a
                          href={`https://${lead.companyDomain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-sm text-gray-400 hover:underline"
                        >
                          🌐 {lead.companyDomain}
                        </a>
                      )}
                    </div>

                    {/* Accept/Reject Buttons */}
                    {lead.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAccept(lead.id)}
                          className="flex-1 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold transition"
                        >
                          ✅ Accept
                        </button>
                        <button
                          onClick={() => handleReject(lead.id)}
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold transition"
                        >
                          ❌ Reject
                        </button>
                      </div>
                    )}

                    {/* Undo Button for Accepted/Rejected */}
                    {lead.status !== 'pending' && (
                      <button
                        onClick={() => {
                          const leadRef = doc(db, 'leads', auth.currentUser.uid, 'generatedLeads', lead.id.toString());
                          updateDoc(leadRef, { status: 'pending' });
                          setLeads(leads.map(l => l.id === lead.id ? { ...l, status: 'pending' } : l));
                        }}
                        className="w-full bg-cyan-950/50 border border-cyan-500/30 text-cyan-400 px-4 py-2 rounded-lg font-bold hover:bg-cyan-900/50 transition"
                      >
                        ↶ Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {filteredLeads.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-gray-400 text-lg">No {filter} leads found.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}