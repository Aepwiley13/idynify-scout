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
        <div className="max-w-2xl w-full">

          {/* Hero Section: Emotional Win + Orientation */}
          <div className="text-center mb-10">
            <div className="text-7xl mb-6 animate-bounce">✅</div>
            <h1 className="text-5xl md:text-6xl font-bold mb-4 bg-gradient-to-r from-green-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent font-mono">
              Access Granted
            </h1>
            <p className="text-2xl text-gray-200 mb-3 font-semibold">
              Scout is active. Barry is ready.
            </p>
            <p className="text-lg text-cyan-400 font-mono">
              Let's find your ideal customers.
            </p>
          </div>

          {/* Barry Introduction */}
          <div className="bg-gradient-to-r from-purple-900/40 to-pink-900/40 rounded-xl p-5 border border-purple-500/40 mb-8 text-center">
            <p className="text-gray-200 text-base">
              <span className="text-xl mr-2">🐻</span>
              <span className="font-semibold text-white">Meet Barry — your AI Scout.</span> Barry searches, filters, and suggests. You decide.
            </p>
          </div>

          {/* Mission Briefing - Single Card */}
          <div className="bg-black/70 backdrop-blur-xl rounded-2xl p-8 border-2 border-cyan-500/40 mb-8">
            <h2 className="text-2xl font-bold text-white mb-3 font-mono">
              📋 Your Mission
            </h2>
            <p className="text-gray-300 text-lg mb-7 leading-relaxed">
              Get the right intel to win deals. Here's how it works:
            </p>

            <div className="space-y-5">
              {/* Step 1 */}
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0 w-10 h-10 bg-cyan-500/20 border-2 border-cyan-400 rounded-lg flex items-center justify-center">
                  <span className="text-cyan-300 font-bold font-mono">1</span>
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg">Define your ICP</h3>
                  <p className="text-gray-400 text-sm">Answer 5 questions so Barry knows who to find</p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0 w-10 h-10 bg-purple-500/20 border-2 border-purple-400 rounded-lg flex items-center justify-center">
                  <span className="text-purple-300 font-bold font-mono">2</span>
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg">Review matching companies</h3>
                  <p className="text-gray-400 text-sm">Scout shows you companies that fit — you approve or skip</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4 items-start">
                <div className="flex-shrink-0 w-10 h-10 bg-pink-500/20 border-2 border-pink-400 rounded-lg flex items-center justify-center">
                  <span className="text-pink-300 font-bold font-mono">3</span>
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg">Select contacts & engage</h3>
                  <p className="text-gray-400 text-sm">Get verified contact details and start conversations</p>
                </div>
              </div>
            </div>

            {/* Reassurance */}
            <div className="mt-7 pt-6 border-t border-cyan-500/20">
              <p className="text-cyan-300 text-center font-medium">
                Scout does the hard part. You stay in control.
              </p>
            </div>
          </div>

          {/* Single Primary CTA */}
          <div className="text-center">
            <button
              onClick={() => navigate('/mission-control-v2')}
              className="bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 hover:from-cyan-600 hover:via-purple-700 hover:to-pink-700 text-white font-bold py-6 px-16 rounded-xl transition-all shadow-2xl shadow-cyan-500/50 text-2xl font-mono hover:scale-105 inline-block"
            >
              🚀 Start Mission Control
            </button>
            <p className="text-gray-500 text-sm mt-4 font-mono">
              Takes ~2 minutes to activate Barry
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
