import { useNavigate } from 'react-router-dom';

export default function Homepage() {
  const navigate = useNavigate();

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

      {/* Floating Code Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {['[MISSION:ACTIVE]', '[BARRY:ONLINE]', '[ICP:READY]', '[LEADS:TRACKING]', '[STATUS:GO]', '[SCOUT:ARMED]'].map((code, i) => (
          <div
            key={i}
            className="absolute text-cyan-400/30 font-mono text-xs"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animation: `floatCode ${15 + i * 3}s linear infinite`,
              animationDelay: `${i * 2}s`
            }}
          >
            {code}
          </div>
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

      {/* Top Left Branding - "Idynify" */}
      <div className="absolute top-6 left-6 z-20">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
          IDYNIFY
        </h1>
        <div className="text-cyan-400 font-mono text-xs mt-1 flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>SYSTEM ONLINE</span>
        </div>
      </div>

      {/* Bottom Left Radar Circle */}
      <div className="absolute bottom-6 left-6 w-24 h-24 border-2 border-cyan-500/30 rounded-full z-20">
        <div className="absolute inset-0 rounded-full" style={{
          background: 'conic-gradient(from 0deg, transparent 0deg, cyan 90deg, transparent 90deg)',
          animation: 'spin 4s linear infinite',
          opacity: 0.3
        }}></div>
        <div className="absolute inset-4 border border-cyan-500/20 rounded-full"></div>
        <div className="absolute inset-8 border border-cyan-500/20 rounded-full"></div>
      </div>

      {/* Hero Section */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-4xl">
          {/* Barry Logo */}
          <div className="text-8xl mb-6 animate-float">🐻</div>
          <div className="text-2xl text-gray-400 font-mono mb-8">BARRY AI</div>

          {/* Headline */}
          <h1 className="text-6xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
            IDYNIFY SCOUT
          </h1>

          {/* Subheadline */}
          <p className="text-2xl md:text-3xl text-cyan-400 mb-4 font-mono">
            AI-Powered Intelligence for B2B Growth
          </p>

          <p className="text-lg md:text-xl text-gray-400 mb-12 max-w-2xl mx-auto">
            Build your ICP, map your market, and generate qualified leads with precision AI reconnaissance.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate('/signup')}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-4 px-12 rounded-xl transition-all shadow-2xl shadow-cyan-500/50 text-lg font-mono"
            >
              🚀 GET STARTED
            </button>
            <button
              onClick={() => navigate('/login')}
              className="bg-gray-800/50 hover:bg-gray-700/50 text-white font-bold py-4 px-12 rounded-xl transition-all border border-cyan-500/30 text-lg font-mono"
            >
              🔐 LOG IN
            </button>
          </div>

          {/* Features */}
          <div className="mt-20 grid md:grid-cols-3 gap-8">
            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-6 border border-cyan-500/30">
              <div className="text-4xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-white mb-2 font-mono">RECON</h3>
              <p className="text-gray-400 text-sm">
                Define your Ideal Customer Profile with AI-guided intelligence gathering
              </p>
            </div>

            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-6 border border-purple-500/30">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="text-xl font-bold text-white mb-2 font-mono">SCOUT</h3>
              <p className="text-gray-400 text-sm">
                Generate qualified leads matching your perfect customer profile
              </p>
            </div>

            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-6 border border-pink-500/30">
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-bold text-white mb-2 font-mono">SNIPER</h3>
              <p className="text-gray-400 text-sm">
                Execute precision outreach campaigns with personalized messaging
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes animate-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        @keyframes floatCode {
          0% { transform: translateY(100vh) translateX(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-100vh) translateX(100px); opacity: 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-float {
          animation: animate-float 6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
