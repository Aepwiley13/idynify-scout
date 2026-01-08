import { useNavigate } from 'react-router-dom';

export default function CheckoutSuccessPage() {
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

      {/* Success Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 py-12">
        <div className="max-w-3xl w-full">
          {/* Success Icon */}
          <div className="text-center mb-8">
            <div className="text-8xl mb-6 animate-bounce">✅</div>
            <h1 className="text-5xl md:text-6xl font-bold mb-4 bg-gradient-to-r from-green-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent font-mono">
              PAYMENT SUCCESSFUL!
            </h1>
            <p className="text-xl text-gray-300 mb-2">
              Welcome to Idynify Scout, Agent!
            </p>
            <p className="text-lg text-cyan-400 font-mono">
              Mission Control is now active
            </p>
          </div>

          {/* Mission Briefing - Next Steps */}
          <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border-2 border-cyan-500/30 mb-8">
            <h2 className="text-2xl font-bold text-white mb-4 font-mono flex items-center gap-2">
              <span>📋</span> MISSION BRIEFING
            </h2>
            <p className="text-gray-300 mb-6">
              Need the right intel to win deals? Follow these steps to identify and engage your ideal customers:
            </p>

            <div className="space-y-6">
              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-cyan-500/20 border-2 border-cyan-500 rounded-lg flex items-center justify-center">
                  <span className="text-cyan-400 font-bold font-mono text-lg">1</span>
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg mb-1">Define Your Ideal Customer Profile (ICP)</h3>
                  <p className="text-gray-400">Use AI-powered RECON to build a detailed profile of your perfect customer</p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-purple-500/20 border-2 border-purple-500 rounded-lg flex items-center justify-center">
                  <span className="text-purple-400 font-bold font-mono text-lg">2</span>
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg mb-1">Approve or Reject Matching Companies</h3>
                  <p className="text-gray-400">Scout finds companies that match your ICP - you decide which ones to target</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-pink-500/20 border-2 border-pink-500 rounded-lg flex items-center justify-center">
                  <span className="text-pink-400 font-bold font-mono text-lg">3</span>
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg mb-1">Select Contacts & Begin Engagement</h3>
                  <p className="text-gray-400">Get verified contact details and start building relationships with decision-makers</p>
                </div>
              </div>
            </div>
          </div>

          {/* What You Have Access To */}
          <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-xl p-6 border border-purple-500/30 mb-8">
            <h3 className="text-pink-300 font-bold text-lg mb-4 flex items-center gap-2">
              <span>🎉</span> YOUR MISSION TOOLS
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl mb-2">🔍</div>
                <p className="text-white font-semibold text-sm">RECON</p>
                <p className="text-gray-400 text-xs">Build your ICP</p>
              </div>
              <div className="text-center">
                <div className="text-3xl mb-2">🎯</div>
                <p className="text-white font-semibold text-sm">SCOUT</p>
                <p className="text-gray-400 text-xs">Find companies</p>
              </div>
              <div className="text-center">
                <div className="text-3xl mb-2">📧</div>
                <p className="text-white font-semibold text-sm">CONTACTS</p>
                <p className="text-gray-400 text-xs">Get decision-makers</p>
              </div>
            </div>
          </div>

          {/* Next Button */}
          <div className="text-center">
            <button
              onClick={() => navigate('/mission-control-v2')}
              className="bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 hover:from-cyan-600 hover:via-purple-700 hover:to-pink-700 text-white font-bold py-5 px-12 rounded-xl transition-all shadow-2xl shadow-cyan-500/50 text-xl font-mono hover:scale-105"
            >
              🚀 GO TO MISSION CONTROL
            </button>
            <p className="text-gray-500 text-sm mt-4 font-mono">
              Let's get you some qualified leads
            </p>
          </div>
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
