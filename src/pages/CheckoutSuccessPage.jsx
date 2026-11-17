import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { planOf, isPaidPlan } from '../utils/accountPlan';
import { hasActiveAccess } from '../utils/billingEntitlement';
import { FREE_PLAN, FREE_PLAN_HOME } from '../constants/freePlan';
import { supportMailto } from '../constants/support';

/** How often, and for how long, this page asks the server whether the payment has been applied. */
export const CONFIRM_POLL_MS = 2500;
export const CONFIRM_TIMEOUT_MS = 60000;

/**
 * Stripe sends the customer here the moment checkout completes, which is usually a few seconds
 * BEFORE its webhook has given the account paid access. The account the app read when this page
 * loaded can therefore still say "unpaid", and sending the customer on into the product at that
 * point used to bounce them straight back to checkout, minutes after paying.
 *
 * So this page waits for the server to confirm it: it reads the account from the server (never a
 * saved copy) until paid access is there, then has the app re-check the account, and only once the
 * app's own account state says paid does it go on to /onboarding. If that takes more than a minute
 * the customer is told what is happening and can check again or contact support. Nothing here
 * writes anything or grants anything: the webhook alone does that.
 */
export default function CheckoutSuccessPage({ account = null, onRecheckAccount }) {
  const navigate = useNavigate();
  const paid = isPaidPlan(planOf(account));
  const [delayed, setDelayed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (paid) return undefined;
    let stopped = false;
    let timer;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      const uid = auth.currentUser?.uid;
      try {
        if (uid) {
          const snap = await getDocFromServer(doc(db, 'users', uid));
          if (!stopped && snap.exists() && hasActiveAccess(snap.data())) {
            onRecheckAccount?.();
            return;
          }
        }
      } catch {
        // A failed read is just another "not yet"; the timeout below still applies.
      }
      if (stopped) return;
      if (Date.now() - started >= CONFIRM_TIMEOUT_MS) {
        setDelayed(true);
        return;
      }
      timer = setTimeout(tick, CONFIRM_POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [paid, attempt, onRecheckAccount]);

  // The app's account state says paid: on into the product.
  useEffect(() => {
    if (!paid) return undefined;
    const timer = setTimeout(() => navigate('/onboarding'), 1500);
    return () => clearTimeout(timer);
  }, [paid, navigate]);

  const checkAgain = () => {
    setDelayed(false);
    setAttempt((n) => n + 1);
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
          <p className="text-xl text-gray-300 mb-8" role="status">
            {paid
              ? 'Welcome to Idynify Scout! Your account is now activated.'
              : 'Thank you! We’re setting up your account. This usually takes a few seconds.'}
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

          {/* Where this is up to */}
          {delayed ? (
            <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-6 mb-8 text-amber-100" role="alert">
              <p className="font-semibold mb-2">Your payment went through, and your account is taking longer than usual to update.</p>
              <p className="text-sm">You will not be charged again. Check again in a moment, or contact support and we’ll finish it for you.</p>
              <div className="flex flex-wrap justify-center gap-3 mt-4">
                <button type="button" onClick={checkAgain} className="px-5 py-2 rounded-lg bg-amber-500/30 border border-amber-400/50 font-mono">CHECK AGAIN</button>
                <a href={supportMailto()} className="px-5 py-2 rounded-lg border border-amber-400/50 font-mono">CONTACT SUPPORT</a>
                {FREE_PLAN.enabled && (
                  <Link to={FREE_PLAN_HOME} className="px-5 py-2 rounded-lg border border-amber-400/50 font-mono">CONTACT HUB</Link>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-purple-500/20 border border-purple-500/30 rounded-xl p-6 mb-8">
              <p className="text-purple-300 font-mono">
                {paid ? 'Connecting you to Barry…' : 'Confirming your payment…'}
              </p>
            </div>
          )}

          {/* Manual Button: only once the account says paid, so it can never
              lead back to checkout. */}
          {paid && (
            <button
              onClick={() => navigate('/onboarding')}
              className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-4 px-12 rounded-xl transition-all shadow-2xl shadow-purple-500/50 text-lg font-mono"
            >
              🧠 MEET BARRY NOW
            </button>
          )}
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
