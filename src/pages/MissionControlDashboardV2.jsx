import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';

export default function MissionControlDashboardV2() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    scoutCompanies: 0,
    scoutContacts: 0,
    reconCompletion: 0
  });

  useEffect(() => {
    loadDashboardStats();
  }, []);

  const loadDashboardStats = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;

      // Count accepted companies
      const companiesQuery = query(
        collection(db, 'users', userId, 'companies'),
        where('status', '==', 'accepted')
      );
      const companiesSnapshot = await getDocs(companiesQuery);

      // Count contacts
      const contactsSnapshot = await getDocs(
        collection(db, 'users', userId, 'contacts')
      );

      // Get RECON completion
      const reconDoc = await getDoc(doc(db, 'users', userId, 'recon', 'current'));
      const reconCompletion = reconDoc.exists() ? reconDoc.data().completionPercentage || 0 : 0;

      setStats({
        scoutCompanies: companiesSnapshot.size,
        scoutContacts: contactsSnapshot.size,
        reconCompletion
      });

      setLoading(false);
    } catch (error) {
      console.error('❌ Error loading dashboard stats:', error);
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to log out?')) {
      try {
        await signOut(auth);
        navigate('/login');
      } catch (error) {
        console.error('Error logging out:', error);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
        {/* Starfield */}
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(200)].map((_, i) => (
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
        <div className="relative z-10 text-cyan-400 text-2xl font-mono animate-pulse">
          [INITIALIZING MISSION CONTROL...]
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

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Starfield Background */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(200)].map((_, i) => (
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

      {/* Grid Pattern at Bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-cyan-900/20 to-transparent">
        <svg className="w-full h-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="cyan" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>
      </div>

      {/* Top Right - Logout */}
      <div className="absolute top-6 right-6 z-50">
        <button
          onClick={handleLogout}
          className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg font-mono text-xs transition-all"
        >
          🚪 LOGOUT
        </button>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-black/80 border-b border-cyan-500/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-4xl" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🎯</div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
                  MISSION CONTROL
                </h1>
                <p className="text-xs text-gray-400 font-mono">Command Center v2.0</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {/* Welcome Section */}
        <section className="mb-12">
          <div className="bg-gradient-to-br from-purple-900/20 to-cyan-900/20 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
            <h2 className="text-3xl font-bold text-white mb-4 font-mono">Welcome to Mission Control</h2>
            <p className="text-gray-300 text-lg">
              Your modular intelligence platform for B2B lead generation.
            </p>
          </div>
        </section>

        {/* Modules Grid */}
        <section className="mb-12">
          <h3 className="text-2xl font-bold text-white mb-6 font-mono">Modules</h3>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* SCOUT MODULE - UNLOCKED */}
            <div
              className="module-card unlocked relative bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-cyan-500/30 hover:border-cyan-500/60 cursor-pointer transition-all"
              onClick={() => navigate('/scout')}
            >
              <div className="module-icon text-4xl mb-4">🎯</div>
              <h4 className="text-2xl font-bold text-white mb-2 font-mono">SCOUT</h4>
              <div className="status-badge unlocked mb-2">ACTIVE</div>
              <p className="text-gray-400 text-sm mb-4">Discover and track your ideal customers</p>

              <div className="module-stats mb-4 grid grid-cols-2 gap-2">
                <div className="stat-box bg-black/40 rounded-lg p-3 border border-cyan-500/20">
                  <p className="text-xs text-gray-500 font-mono">Companies</p>
                  <p className="text-xl font-bold text-cyan-400 font-mono">{stats.scoutCompanies}</p>
                </div>
                <div className="stat-box bg-black/40 rounded-lg p-3 border border-cyan-500/20">
                  <p className="text-xs text-gray-500 font-mono">Contacts</p>
                  <p className="text-xl font-bold text-cyan-400 font-mono">{stats.scoutContacts}</p>
                </div>
              </div>

              <button className="module-btn w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all font-mono">
                Enter Scout →
              </button>
            </div>

            {/* RECON MODULE - UNLOCKED (OPTIONAL) */}
            <div
              className="module-card unlocked relative bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-cyan-500/30 hover:border-cyan-500/60 cursor-pointer transition-all"
              onClick={() => navigate('/mission-control-v2/recon')}
            >
              <div className="module-icon text-4xl mb-4">🧠</div>
              <h4 className="text-2xl font-bold text-white mb-2 font-mono">RECON</h4>
              <div className="flex gap-2 mb-2">
                <div className="status-badge unlocked">ACTIVE</div>
                <div className="optional-badge">Optional</div>
              </div>
              <p className="text-gray-400 text-sm mb-4">Train your AI to find better leads</p>

              <div className="module-stats mb-4">
                <div className="stat-box bg-black/40 rounded-lg p-3 border border-cyan-500/20">
                  <p className="text-xs text-gray-500 font-mono">Completion</p>
                  <p className="text-xl font-bold text-cyan-400 font-mono">{stats.reconCompletion}%</p>
                </div>
                <div className="progress-bar mt-2 w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 transition-all duration-500"
                    style={{ width: `${stats.reconCompletion}%` }}
                  />
                </div>
              </div>

              <button className="module-btn w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all font-mono">
                Train AI →
              </button>
            </div>

            {/* HUNTER MODULE - LOCKED */}
            <div className="module-card locked relative bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-gray-500/20 opacity-60">
              <div className="absolute top-4 right-4 text-3xl">🔒</div>
              <div className="module-icon text-4xl mb-4 grayscale">🎯</div>
              <h4 className="text-2xl font-bold text-white mb-2 font-mono">HUNTER</h4>
              <div className="status-badge locked mb-2">COMING SOON</div>
              <p className="text-gray-400 text-sm mb-4">Automated outreach campaigns</p>

              <div className="unlock-requirements mt-4 p-3 bg-gray-900/50 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-500 mb-1">✓ Select 50+ contacts</p>
                <p className="text-xs text-gray-500">○ Complete 1 RECON section</p>
              </div>
            </div>

            {/* SNIPER MODULE - LOCKED */}
            <div className="module-card locked relative bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-gray-500/20 opacity-60">
              <div className="absolute top-4 right-4 text-3xl">🔒</div>
              <div className="module-icon text-4xl mb-4 grayscale">🎯</div>
              <h4 className="text-2xl font-bold text-white mb-2 font-mono">SNIPER</h4>
              <div className="status-badge locked mb-2">COMING SOON</div>
              <p className="text-gray-400 text-sm mb-4">Advanced targeting & personalization</p>

              <div className="unlock-requirements mt-4 p-3 bg-gray-900/50 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-500">○ Complete Hunter</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes floatBear {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }

        .status-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 600;
          font-family: 'Courier New', monospace;
        }

        .status-badge.unlocked {
          background: #10b981;
          color: white;
        }

        .status-badge.locked {
          background: #9ca3af;
          color: white;
        }

        .optional-badge {
          display: inline-block;
          background: #fbbf24;
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-family: 'Courier New', monospace;
          font-weight: 600;
        }

        .unlock-requirements {
          margin-top: 1rem;
          padding: 1rem;
          background: #1f2937;
          border-radius: 8px;
          font-size: 0.875rem;
          color: #9ca3af;
        }

        .unlock-requirements p {
          margin: 0.25rem 0;
          font-family: 'Courier New', monospace;
        }

        .module-card.locked {
          cursor: not-allowed;
        }

        .module-card.locked .module-btn {
          display: none;
        }

        .grayscale {
          filter: grayscale(100%);
        }
      `}</style>
    </div>
  );
}
