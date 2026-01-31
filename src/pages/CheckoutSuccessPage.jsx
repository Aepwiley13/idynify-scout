import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CheckoutSuccessPage() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/onboarding/barry');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

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
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-2xl">
          {/* Success Icon */}
          <div className="text-8xl mb-8 animate-bounce">✅</div>

          {/* Headline */}
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-green-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent font-mono">
            PAYMENT SUCCESSFUL!
          </h1>

          {/* Message */}
          <p className="text-xl text-gray-300 mb-8">
            Welcome to Idynify Scout! Your account is now activated.
          </p>

          {/* Features Unlocked */}
          <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border-2 border-green-500/30 mb-8">
            <h2 className="text-2xl font-bold text-white mb-6 font-mono">🎉 You Now Have Access To:</h2>

            <div className="space-y-4 text-left">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🔍</span>
                <div>
                  <p className="text-white font-semibold">RECON Module</p>
                  <p className="text-gray-400 text-sm">Build your ICP with AI-guided intelligence</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-3xl">🎯</span>
                <div>
                  <p className="text-white font-semibold">SCOUT Module</p>
                  <p className="text-gray-400 text-sm">Generate unlimited qualified leads</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-3xl">🚀</span>
                <div>
                  <p className="text-white font-semibold">SNIPER Module</p>
                  <p className="text-gray-400 text-sm">Launch precision outreach campaigns</p>
                </div>
              </div>
            </div>
          </div>

          {/* Redirect Message */}
          <div className="bg-purple-500/20 border border-purple-500/30 rounded-xl p-6 mb-8">
            <p className="text-purple-300 font-mono">
              Connecting you to Barry in <span className="text-2xl font-bold">{countdown}</span> seconds...
            </p>
          </div>

          {/* Manual Button */}
          <button
            onClick={() => navigate('/onboarding/barry')}
            className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-4 px-12 rounded-xl transition-all shadow-2xl shadow-purple-500/50 text-lg font-mono"
          >
            🧠 MEET BARRY NOW
          </button>
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
