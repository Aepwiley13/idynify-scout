import { useNavigate } from 'react-router-dom';

export default function CheckoutCancelPage() {
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

      {/* Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-2xl">
          {/* Icon */}
          <div className="text-8xl mb-8">❌</div>

          {/* Headline */}
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400 bg-clip-text text-transparent font-mono">
            CHECKOUT CANCELLED
          </h1>

          {/* Message */}
          <p className="text-xl text-gray-300 mb-8">
            Your payment was cancelled. No charges were made to your account.
          </p>

          {/* Reassurance */}
          <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border-2 border-yellow-500/30 mb-8">
            <p className="text-gray-300 mb-4">
              No worries! You can try again whenever you're ready.
            </p>
            <p className="text-gray-400 text-sm">
              Your account is still active. Complete checkout to unlock all features.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate('/checkout')}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-4 px-12 rounded-xl transition-all shadow-2xl shadow-cyan-500/50 text-lg font-mono"
            >
              💳 TRY AGAIN
            </button>
            <button
              onClick={() => navigate('/')}
              className="bg-gray-800/50 hover:bg-gray-700/50 text-white font-bold py-4 px-12 rounded-xl transition-all border border-cyan-500/30 text-lg font-mono"
            >
              🏠 GO HOME
            </button>
          </div>

          {/* Support */}
          <p className="text-gray-500 text-sm mt-8 font-mono">
            Need help? Contact support@idynify.com
          </p>
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
