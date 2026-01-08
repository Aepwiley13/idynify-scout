import { useState, useEffect } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Read tier from URL parameter (default to 'starter' if not specified)
  const tier = searchParams.get('tier') || 'starter';

  useEffect(() => {
    const calculateCountdown = () => {
      const now = new Date();
      const target = new Date();
      target.setHours(target.getHours() + 24);
      const diff = target - now;
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setCountdown(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    };

    calculateCountdown();
    const interval = setInterval(calculateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSignup = async (e) => {
    e.preventDefault();

    // Validate password match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password length
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setError(''); // Clear any previous errors

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);

      // Determine initial credits based on tier
      const initialCredits = tier === 'pro' ? 1250 : 400;

      await setDoc(doc(db, 'users', userCredential.user.uid), {
        email: email,
        createdAt: new Date(),
        selectedTier: tier, // Store the tier they selected (starter or pro)
        subscriptionTier: tier,
        status: 'pending_payment', // Will change to 'active' after payment
        hasCompletedPayment: false, // Will be set to true after checkout
        credits: initialCredits, // Give them credits based on tier
        monthlyCredits: initialCredits
      });

      // Send welcome email (async, don't block on this)
      try {
        await fetch('/.netlify/functions/send-welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            userId: userCredential.user.uid
          })
        });
        console.log('✅ Welcome email sent');
      } catch (emailError) {
        // Log but don't block signup flow
        console.error('⚠️ Failed to send welcome email:', emailError);
      }

      // Redirect to checkout with tier parameter
      navigate(`/checkout?tier=${tier}`);
    } catch (error) {
      setError(error.message);
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

      {/* Floating Code Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {['[ANALYZING...]', '[ICP:LOCKED]', '[LEAD:QUALIFIED]', '[DATA:ENCRYPTED]', '[MISSION:ACTIVE]', '[BARRY:ONLINE]'].map((code, i) => (
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

      {/* Top Left Status */}
      <div className="absolute top-6 left-6 text-cyan-400 font-mono text-xs space-y-1 z-20">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>SYSTEM ONLINE</span>
        </div>
        <div>MISSION: SCOUT</div>
        <div>STATUS: ACCEPTING CREW</div>
      </div>

      {/* Top Right Countdown */}
      <div className="absolute top-6 right-6 text-cyan-400 font-mono text-xs text-right z-20">
        <div>LAUNCH WINDOW</div>
        <div className="text-2xl font-bold text-pink-400 tabular-nums">T-{countdown}</div>
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

      {/* Main Content */}
      <div className="relative z-10 py-12 px-4 flex items-center justify-center min-h-screen">
        <div className="w-full max-w-2xl">
          {/* Animated Early Access Badge */}
          <div className="flex justify-center mb-6 animate-bounce">
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black px-6 py-2 rounded-full font-black text-sm">
              🚀 EARLY ACCESS - LIMITED SEATS
            </div>
          </div>

          <div className="bg-black/60 backdrop-blur-xl rounded-3xl shadow-2xl p-10 border border-cyan-500/30">
            {/* Logo/Header */}
            <div className="text-center mb-8">
              <div className="text-6xl mb-4" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
              <h1 className="text-5xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                Barry AI
              </h1>
              <h2 className="text-3xl font-bold text-cyan-300 mb-4">
                Mission: Scout
              </h2>
              <p className="text-gray-300 text-lg">
                Data Exploration • Lead Discovery • Mission Ready
              </p>
            </div>

            {/* Mission Briefing */}
            <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-xl p-6 mb-8 border border-purple-500/30">
              <h3 className="text-pink-300 font-bold text-lg mb-3 flex items-center gap-2">
                <span>📋</span> MISSION BRIEFING
              </h3>
              <ul className="space-y-2 text-gray-300">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">▸</span>
                  <span>Define your Ideal Customer Profile with AI-powered RECON</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">▸</span>
                  <span>Browse unlimited companies matching your ICP (always free)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">▸</span>
                  <span>Enrich {tier === 'pro' ? '125' : '40'} companies/month with full contact data</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">▸</span>
                  <span>Get {tier === 'pro' ? '375' : '120'} verified contacts with email & phone</span>
                </li>
              </ul>
            </div>
            
            <form onSubmit={handleSignup} className="space-y-5">
              <div>
                <label className="text-cyan-300 text-sm font-semibold mb-2 block font-mono uppercase tracking-wider">
                  AGENT EMAIL
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
                  SECURE PASSWORD
                </label>
                <input
                  type="password"
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-4 bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                  minLength="6"
                  required
                />
              </div>

              <div>
                <label className="text-cyan-300 text-sm font-semibold mb-2 block font-mono uppercase tracking-wider">
                  CONFIRM PASSWORD
                </label>
                <input
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-4 bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                  minLength="6"
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
                className="w-full relative overflow-hidden bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 text-white p-5 rounded-xl font-black text-xl hover:scale-105 transition-all shadow-2xl shadow-cyan-500/50 group"
              >
                <span className="relative z-10">🚀 ACCEPT MISSION & START</span>
                <div className="absolute inset-0 bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </button>
            </form>

            {/* Footer note */}
            <div className="mt-6 text-center">
              <p className="text-cyan-500/60 text-sm font-mono">
                🔒 ENCRYPTED • {tier === 'pro' ? '1,250 CREDITS' : '400 CREDITS'} • INSTANT ACCESS
              </p>
              <p className="text-purple-400 text-xs mt-2">
                {tier === 'pro' ? '$50/month - 125 companies' : '$20/month - 40 companies'} • Cancel anytime
              </p>
              <div className="mt-4 space-y-2">
                <p className="text-gray-400 text-sm">
                  Already have an account?{' '}
                  <button
                    onClick={() => navigate('/login')}
                    className="text-cyan-400 hover:text-cyan-300 font-bold underline bg-transparent border-0 cursor-pointer"
                  >
                    Login here →
                  </button>
                </p>
                <p className="text-gray-400 text-sm">
                  Forgot your password?{' '}
                  <button
                    onClick={() => navigate('/forgot-password')}
                    className="text-pink-400 hover:text-pink-300 font-bold underline bg-transparent border-0 cursor-pointer"
                  >
                    Reset it here →
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes floatBear {
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
      `}</style>
    </div>
  );
}
