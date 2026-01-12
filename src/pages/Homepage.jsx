import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';

export default function Homepage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState(null);

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/80 backdrop-blur-lg border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-cyan-400">IDYNIFY</div>
          <div className="flex gap-4">
            <button
              onClick={() => navigate('/login')}
              className="px-6 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Log In
            </button>
            <button
              onClick={() => navigate('/signup')}
              className="px-6 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg transition-colors font-medium"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

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
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <div className="text-6xl mb-6" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>

          <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
            Find Companies You Can Sell To—
            <br />
            <span className="text-cyan-400">Get Contact Details in Minutes</span>
          </h1>

          <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
            Browse unlimited companies for free. Enrich the ones you want with instant contact details. No contracts, no complexity.
          </p>

          <button
            onClick={() => navigate('/signup')}
            className="px-8 py-4 bg-cyan-500 hover:bg-cyan-600 text-white text-lg font-semibold rounded-lg transition-all shadow-lg shadow-cyan-500/30 mb-4"
          >
            Start Finding Companies
          </button>

          <p className="text-gray-400 text-sm">
            Plans start at $20/month • 400 credits included • Cancel anytime
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">How It Works</h2>
          <p className="text-xl text-gray-300 text-center mb-12 italic">
            It's kind of like Tinder, except for owners and executives
          </p>

          <div className="grid md:grid-cols-3 gap-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center text-3xl mb-6 mx-auto border-2 border-cyan-500">
                1
              </div>
              <h3 className="text-2xl font-bold mb-4">Answer a Few Questions</h3>
              <p className="text-gray-300">
                Tell us your industry, company size, revenue range, and location
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center text-3xl mb-6 mx-auto border-2 border-cyan-500">
                2
              </div>
              <h3 className="text-2xl font-bold mb-4">Browse Companies That Match Your ICP</h3>
              <p className="text-gray-300">
                Scout finds matching companies instantly (always free)
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center text-3xl mb-6 mx-auto border-2 border-cyan-500">
                3
              </div>
              <h3 className="text-2xl font-bold mb-4">Enrich Your ICP</h3>
              <p className="text-gray-300">
                Get full company data + 3 contacts with email & phone (uses credits)
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">What You Get</h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="flex items-start gap-4 p-6 bg-gray-800/50 rounded-lg">
              <div className="text-cyan-400 mt-1">
                <Check size={24} />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">Unlimited Company Browsing</h3>
                <p className="text-gray-300 text-sm">Search and filter for free</p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-6 bg-gray-800/50 rounded-lg">
              <div className="text-cyan-400 mt-1">
                <Check size={24} />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">3 Contacts Per Company</h3>
                <p className="text-gray-300 text-sm">With verified email and phone</p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-6 bg-gray-800/50 rounded-lg">
              <div className="text-cyan-400 mt-1">
                <Check size={24} />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">Instant Access</h3>
                <p className="text-gray-300 text-sm">Start outreach the same day</p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-6 bg-gray-800/50 rounded-lg">
              <div className="text-cyan-400 mt-1">
                <Check size={24} />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2">Save to Target List</h3>
                <p className="text-gray-300 text-sm">Build your prospect database</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 px-6 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">Pricing</h2>

          {/* Pricing Tiers */}
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Starter Tier */}
            <div className="bg-gray-800 rounded-2xl p-8 border-2 border-gray-700 hover:border-cyan-500/50 transition-all">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold mb-2">Scout Starter</h3>
                <div className="text-5xl font-bold mb-2">
                  $20<span className="text-2xl text-gray-400">/mo</span>
                </div>
                <p className="text-gray-400">400 credits/month</p>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">Browse unlimited companies</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200"><strong>40 enriched companies/month</strong></span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">120 contact details (email + phone)</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">Full RECON access</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">CSV exports</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">1 user seat</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">Email support (48-hour response)</span>
                </div>
              </div>

              <button
                onClick={() => navigate('/signup?tier=starter')}
                className="w-full py-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-all"
              >
                Start with Starter - $20/mo
              </button>
            </div>

            {/* Pro Tier */}
            <div className="bg-gradient-to-br from-cyan-900/40 to-gray-800 rounded-2xl p-8 border-2 border-cyan-500 relative">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-cyan-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                MOST POPULAR
              </div>

              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold mb-2">Scout Pro</h3>
                <div className="text-5xl font-bold mb-2">
                  $50<span className="text-2xl text-gray-400">/mo</span>
                </div>
                <p className="text-gray-400">1,250 credits/month</p>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200"><strong>Everything in Starter, plus:</strong></span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200"><strong>125 enriched companies/month</strong></span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">375 contact details (email + phone)</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">Unlimited CSV exports</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">Enhanced RECON reports with PDF export</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">Export history & saved searches</span>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="text-cyan-400 flex-shrink-0 mt-1" size={20} />
                  <span className="text-gray-200">Priority email support (24-hour response)</span>
                </div>
              </div>

              <button
                onClick={() => navigate('/signup?tier=pro')}
                className="w-full py-4 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-all shadow-lg shadow-cyan-500/30"
              >
                Go Pro - $50/mo
              </button>
            </div>
          </div>

          <p className="text-center text-gray-400 mt-8 text-sm">
            Credits reset monthly on your billing date. Unused credits don't roll over.
          </p>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">Frequently Asked Questions</h2>

          <div className="space-y-4">
            {/* FAQ 1 */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleFaq(0)}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-700 transition-colors"
              >
                <span className="font-semibold text-lg text-left">What are credits?</span>
                {openFaq === 0 ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
              </button>
              {openFaq === 0 && (
                <div className="px-6 pb-4 text-gray-300">
                  Credits let you unlock full company data and contact details. Browsing companies is always free—you only use credits when you want to save a company with contact information.
                </div>
              )}
            </div>

            {/* FAQ 2 */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleFaq(1)}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-700 transition-colors"
              >
                <span className="font-semibold text-lg text-left">What if I run out of credits?</span>
                {openFaq === 1 ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
              </button>
              {openFaq === 1 && (
                <div className="px-6 pb-4 text-gray-300">
                  You can still browse unlimited companies. To enrich more companies, upgrade your plan or wait for your credits to reset next month.
                </div>
              )}
            </div>

            {/* FAQ 3 */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleFaq(2)}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-700 transition-colors"
              >
                <span className="font-semibold text-lg text-left">Can I buy extra credits?</span>
                {openFaq === 2 ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
              </button>
              {openFaq === 2 && (
                <div className="px-6 pb-4 text-gray-300">
                  Not yet. Choose the plan that matches your monthly prospecting volume. Most users start with Starter ($20) and upgrade to Pro ($50) after 60-90 days.
                </div>
              )}
            </div>

            {/* FAQ 4 */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleFaq(3)}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-700 transition-colors"
              >
                <span className="font-semibold text-lg text-left">How quickly can I start using Scout?</span>
                {openFaq === 3 ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
              </button>
              {openFaq === 3 && (
                <div className="px-6 pb-4 text-gray-300">
                  Immediately! After signup, you answer 4 quick questions (industry, company size, revenue, location) and Scout delivers 50 matching companies in minutes. You can start browsing and enriching companies the same day.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 bg-gradient-to-b from-cyan-900/20 to-gray-900">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl font-bold mb-6">Ready to Build Your Prospect List?</h2>
          <p className="text-xl text-gray-300 mb-8">
            Join founders using Scout to find their next customers
          </p>

          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="flex items-center gap-3 text-lg text-gray-200">
              <Check className="text-cyan-400" size={24} />
              <span>Browse unlimited</span>
            </div>
            <div className="flex items-center gap-3 text-lg text-gray-200">
              <Check className="text-cyan-400" size={24} />
              <span>Get verified contact details</span>
            </div>
            <div className="flex items-center gap-3 text-lg text-gray-200">
              <Check className="text-cyan-400" size={24} />
              <span>Cancel anytime</span>
            </div>
          </div>

          <button
            onClick={() => navigate('/signup')}
            className="px-12 py-5 bg-cyan-500 hover:bg-cyan-600 text-white text-xl font-bold rounded-lg transition-all shadow-xl shadow-cyan-500/30 mb-4"
          >
            Start Finding Companies
          </button>

          <p className="text-gray-400">
            Plans start at $20/month
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-gray-800">
        <div className="max-w-7xl mx-auto text-center text-gray-400 text-sm">
          <p>&copy; 2024 Idynify Scout. All rights reserved.</p>
        </div>
      </footer>

      <style>{`
        @keyframes floatBear {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
          }
          25% {
            transform: translateY(-20px) rotate(-5deg);
          }
          50% {
            transform: translateY(-30px) rotate(0deg);
          }
          75% {
            transform: translateY(-20px) rotate(5deg);
          }
        }

        @keyframes floatCode {
          0% {
            transform: translateY(0) translateX(0);
            opacity: 0.3;
          }
          50% {
            opacity: 0.6;
          }
          100% {
            transform: translateY(-100vh) translateX(50px);
            opacity: 0;
          }
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
