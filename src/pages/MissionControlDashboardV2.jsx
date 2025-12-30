import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Map, Brain, Radar, Crosshair } from 'lucide-react';

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
    if (window.confirm('Log out of Mission Control?')) {
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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-400 text-2xl font-mono animate-pulse">
          [INITIALIZING MISSION CONTROL...]
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden text-white">
      {/* LOGOUT */}
      <div className="absolute top-6 right-6 z-50">
        <button
          onClick={handleLogout}
          className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg font-mono text-xs transition-all"
        >
          LOGOUT
        </button>
      </div>

      {/* HEADER */}
      <header className="relative z-40 py-10 text-center border-b border-cyan-500/20 backdrop-blur-md bg-black/80">
        {/* Barry - AI Mission Commander */}
        <div className="flex justify-center mb-4">
          <div
            className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-3xl"
            style={{ animation: 'barryFloat 6s ease-in-out infinite' }}
          >
            🐻
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-widest font-mono bg-gradient-to-r from-purple-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">
          MISSION CONTROL
        </h1>
        <p className="text-xs text-gray-400 font-mono mt-2">
          Command Center v2.0
        </p>
      </header>

      {/* MAIN */}
      <main className="max-w-7xl mx-auto px-6 py-16 relative z-10">
        {/* WELCOME - Centered */}
        <section className="text-center mb-16">
          <h2 className="text-4xl font-bold font-mono mb-4">
            Welcome to Mission Control
          </h2>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto">
            Let's get started with your mission alongside your AI Assistant.
          </p>
        </section>

        {/* MODULES - Centered Grid */}
        <section>
          <h3 className="text-2xl font-mono mb-8 text-center">Modules</h3>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
            {/* SCOUT - Active */}
            <div
              onClick={() => navigate('/scout')}
              className="group cursor-pointer bg-black/60 backdrop-blur-xl rounded-xl p-6 border-2 border-cyan-500/30 hover:border-cyan-500/60 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/20"
            >
              <div className="mb-4 text-cyan-400">
                <Map className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <h4 className="font-mono text-xl mb-2 text-white">SCOUT</h4>
              <span className="inline-block text-xs bg-emerald-500 text-white px-2 py-0.5 rounded font-mono font-semibold">
                ACTIVE
              </span>
              <p className="text-sm text-gray-400 mt-3 mb-4">
                Discover and track your ideal customers
              </p>

              <div className="grid grid-cols-2 gap-3 mb-5">
                <Stat label="Companies" value={stats.scoutCompanies} />
                <Stat label="Contacts" value={stats.scoutContacts} />
              </div>

              <button className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-mono text-sm font-bold transition-all">
                Enter Scout →
              </button>
            </div>

            {/* RECON - Active (Optional) */}
            <div
              onClick={() => navigate('/mission-control-v2/recon')}
              className="group cursor-pointer bg-black/60 backdrop-blur-xl rounded-xl p-6 border-2 border-purple-500/30 hover:border-purple-500/60 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/20"
            >
              <div className="mb-4 text-purple-400">
                <Brain className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <h4 className="font-mono text-xl mb-2 text-white">RECON</h4>
              <div className="flex gap-2 mb-3">
                <span className="inline-block text-xs bg-emerald-500 text-white px-2 py-0.5 rounded font-mono font-semibold">
                  ACTIVE
                </span>
                <span className="inline-block text-xs bg-yellow-500 text-white px-2 py-0.5 rounded font-mono font-semibold">
                  OPTIONAL
                </span>
              </div>

              <p className="text-sm text-gray-400 mt-3 mb-4">
                Train your AI Assistant
              </p>

              <div className="mb-5">
                <div className="bg-black/40 rounded-lg p-3 border border-purple-500/20">
                  <p className="text-xs text-gray-500 font-mono">Completion</p>
                  <p className="text-xl font-mono text-purple-400 font-bold">
                    {stats.reconCompletion}%
                  </p>
                  <div className="w-full h-2 bg-gray-700/50 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-2 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full transition-all duration-500"
                      style={{ width: `${stats.reconCompletion}%` }}
                    />
                  </div>
                </div>
              </div>

              <button className="w-full py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white font-mono text-sm font-bold transition-all">
                Train AI →
              </button>
            </div>

            {/* HUNTER - Locked */}
            <LockedModule
              title="HUNTER"
              description="Automated outreach campaigns"
              icon={<Radar className="w-5 h-5" strokeWidth={1.5} />}
            />

            {/* SNIPER - Locked */}
            <LockedModule
              title="SNIPER"
              description="Advanced targeting & personalization"
              icon={<Crosshair className="w-5 h-5" strokeWidth={1.5} />}
            />
          </div>
        </section>
      </main>

      {/* Barry Float Animation */}
      <style>{`
        @keyframes barryFloat {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
      `}</style>
    </div>
  );
}

// Stat Component
function Stat({ label, value }) {
  return (
    <div className="bg-black/40 rounded-lg p-3 border border-cyan-500/20">
      <p className="text-xs text-gray-500 font-mono">{label}</p>
      <p className="text-xl font-mono text-cyan-400 font-bold">{value}</p>
    </div>
  );
}

// Locked Module Component
function LockedModule({ title, description, icon }) {
  return (
    <div className="bg-black/40 backdrop-blur-xl rounded-xl p-6 border-2 border-gray-600/20 opacity-60 cursor-not-allowed">
      <div className="mb-4 text-gray-500">
        {icon}
      </div>
      <h4 className="font-mono text-xl mb-2 text-white">{title}</h4>
      <span className="inline-block text-xs bg-gray-500 text-white px-2 py-0.5 rounded font-mono font-semibold">
        COMING SOON
      </span>
      <p className="text-sm text-gray-400 mt-3">
        {description}
      </p>
    </div>
  );
}
