import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase/config';
import { useNavigate } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess(true);
    } catch (err) {
      // Map Firebase error codes to user-friendly messages
      switch (err.code) {
        case 'auth/user-not-found':
          setError('No account found with this email address.');
          break;
        case 'auth/invalid-email':
          setError('Please enter a valid email address.');
          break;
        case 'auth/too-many-requests':
          setError('Too many attempts. Please try again later.');
          break;
        default:
          setError('Failed to send reset email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

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

      {/* Main Content */}
      <div className="relative z-10 py-12 px-4 flex items-center justify-center min-h-screen">
        <div className="w-full max-w-md">
          <div className="bg-black/60 backdrop-blur-xl rounded-3xl shadow-2xl p-10 border border-cyan-500/30">
            {/* Logo/Header */}
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">🔑</div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                Reset Password
              </h1>
              <p className="text-cyan-300 text-lg font-mono">
                Password Recovery
              </p>
            </div>

            {success ? (
              <div className="text-center">
                <div className="bg-green-500/10 border border-green-500/50 rounded-xl p-4 mb-6">
                  <p className="text-green-300 text-sm font-mono">
                    Password reset email sent. Check your inbox for instructions.
                  </p>
                </div>
                <button
                  onClick={() => navigate('/login')}
                  className="w-full relative overflow-hidden bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 text-white p-5 rounded-xl font-black text-xl hover:scale-[1.02] transition-all shadow-2xl shadow-cyan-500/50 group"
                >
                  <span className="relative z-10">Back to Login</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-5">
                <div>
                  <label className="text-cyan-300 text-sm font-semibold mb-2 block font-mono uppercase tracking-wider">
                    EMAIL ADDRESS
                  </label>
                  <input
                    type="email"
                    placeholder="your.email@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-4 bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                    required
                  />
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-3">
                    <p className="text-red-300 text-sm font-mono">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full relative overflow-hidden bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 text-white p-5 rounded-xl font-black text-xl hover:scale-[1.02] transition-all shadow-2xl shadow-cyan-500/50 group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  <span className="relative z-10">
                    {loading ? 'Sending...' : 'Send Reset Email'}
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </button>
              </form>
            )}

            {/* Footer */}
            <div className="mt-6 text-center">
              <p className="text-gray-400 text-sm">
                Remember your password?{' '}
                <button
                  onClick={() => navigate('/login')}
                  className="text-cyan-400 hover:text-cyan-300 font-bold underline bg-transparent border-0 cursor-pointer"
                >
                  Login here
                </button>
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
      `}</style>
    </div>
  );
}
