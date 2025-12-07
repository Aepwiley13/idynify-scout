import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/config';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard');
    } catch (error) {
      setError('Invalid credentials. Please try again.');
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
              <div className="text-6xl mb-4">🐻</div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                Welcome Back
              </h1>
              <p className="text-cyan-300 text-lg font-mono">
                Agent Login
              </p>
            </div>
            
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="text-cyan-300 text-sm font-semibold mb-2 block font-mono uppercase tracking-wider">
                  EMAIL
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
              
              <div>
                <label className="text-cyan-300 text-sm font-semibold mb-2 block font-mono uppercase tracking-wider">
                  PASSWORD
                </label>
                <input
                  type="password"
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-4 bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-3">
                  <p className="text-red-300 text-sm font-mono">⚠️ {error}</p>
                </div>
              )}
              
              <button 
                type="submit"
                className="w-full relative overflow-hidden bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 text-white p-5 rounded-xl font-black text-xl hover:scale-[1.02] transition-all shadow-2xl shadow-cyan-500/50 group"
              >
                <span className="relative z-10">🔓 ACCESS MISSION CONTROL</span>
                <div className="absolute inset-0 bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </button>
            </form>

            {/* Footer */}
            <div className="mt-6 text-center">
              <p className="text-gray-400 text-sm">
                New agent?{' '}
                <a 
                  href="/signup" 
                  className="text-cyan-400 hover:text-cyan-300 font-bold underline"
                >
                  Join the crew →
                </a>
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