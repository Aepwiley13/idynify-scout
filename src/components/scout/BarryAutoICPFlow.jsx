import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, collection } from 'firebase/firestore';
import { Brain, Globe, Building2, Loader2, Check, RefreshCw } from 'lucide-react';
import ICPConfirmationCard from '../onboarding/ICPConfirmationCard';
import { DEFAULT_WEIGHTS } from '../../utils/icpScoring';
import { getEffectiveUser } from '../../context/ImpersonationContext';

const STEPS = ['input', 'analyzing', 'review', 'saved'];

const STEP_MESSAGES = {
  analyzing_website: 'Analyzing website...',
  enriching_seeds: 'Enriching seed companies...',
  building_icp: 'Building your ICP...'
};

export default function BarryAutoICPFlow({ onComplete, onSkip }) {
  const [step, setStep] = useState('input');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [seedInputs, setSeedInputs] = useState(['', '', '']);
  const [analysisPhase, setAnalysisPhase] = useState('');
  const [draftICP, setDraftICP] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);

  function updateSeed(index, value) {
    setSeedInputs(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!websiteUrl.trim()) return;

    setStep('analyzing');
    setError(null);

    try {
      const user = getEffectiveUser() || auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      const authToken = await auth.currentUser.getIdToken();
      const seeds = seedInputs.filter(s => s.trim());

      setAnalysisPhase('analyzing_website');
      await new Promise(r => setTimeout(r, 300));

      setAnalysisPhase('enriching_seeds');
      await new Promise(r => setTimeout(r, 300));

      setAnalysisPhase('building_icp');

      const response = await fetch('/.netlify/functions/barryAutoICP', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          websiteUrl: websiteUrl.trim(),
          seedCompanies: seeds
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Auto-ICP generation failed');
      }

      setDraftICP(data.draftICP);
      setAnalysis(data.analysis);
      setStep('review');

    } catch (err) {
      console.error('Auto-ICP error:', err);
      setError(err.message);
      setStep('input');
    }
  }

  async function handleConfirm() {
    if (!draftICP) return;

    try {
      const user = getEffectiveUser() || auth.currentUser;
      const icpId = `icp_${Date.now()}`;

      const icpDoc = {
        ...draftICP,
        name: `Auto: ${draftICP.sourceWebsite || 'Generated'}`,
        isActive: true,
        status: 'active',
        generationConfidence: analysis?.confidenceScore || 70,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'users', user.uid, 'icpProfiles', icpId), icpDoc);

      // Also save to legacy location for backward compat
      await setDoc(doc(db, 'users', user.uid, 'companyProfile', 'current'), {
        ...icpDoc,
        scoringWeights: DEFAULT_WEIGHTS
      });

      setStep('saved');

      // Trigger company search in background
      const authToken = await auth.currentUser.getIdToken();
      fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: icpDoc
        })
      }).catch(() => {});

      setTimeout(() => {
        if (onComplete) onComplete(icpDoc, icpId);
      }, 2000);

    } catch (err) {
      console.error('Save error:', err);
      setError('Failed to save ICP. Please try again.');
    }
  }

  function handleTweak() {
    if (onSkip) onSkip(draftICP);
  }

  if (step === 'analyzing') {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-6">
        <Brain className="w-12 h-12 text-purple-500 animate-pulse" />
        <div className="text-center space-y-2">
          <p className="text-white font-semibold text-lg">Barry is building your ICP</p>
          <p className="text-cyan-400 font-mono text-sm">
            {STEP_MESSAGES[analysisPhase] || 'Processing...'}
          </p>
        </div>
        <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (step === 'review' && draftICP) {
    const cardICP = {
      ...draftICP,
      confidenceScore: (analysis?.confidenceScore || 70) / 100
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-purple-500" />
          <p className="text-white font-semibold">Barry built this from your website + seeds</p>
        </div>

        {analysis?.reasoning && (
          <p className="text-sm text-gray-400 font-mono bg-gray-900/50 rounded-lg p-3 border border-gray-700">
            {analysis.reasoning}
          </p>
        )}

        <ICPConfirmationCard
          icp={cardICP}
          onConfirm={handleConfirm}
          onRefine={handleTweak}
        />
      </div>
    );
  }

  if (step === 'saved') {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
          <Check className="w-8 h-8 text-green-400" />
        </div>
        <p className="text-white font-semibold text-lg">ICP saved</p>
        <p className="text-gray-400 text-sm">Barry is finding your first leads now...</p>
      </div>
    );
  }

  // Input step
  return (
    <form onSubmit={handleGenerate} className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Brain className="w-6 h-6 text-purple-500" />
        <div>
          <h3 className="text-white font-semibold text-lg">Auto-Build ICP</h3>
          <p className="text-gray-400 text-sm">Drop your website and a few example customers</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          <Globe className="w-4 h-4 inline mr-1.5" />
          Your Website
        </label>
        <input
          type="text"
          value={websiteUrl}
          onChange={e => setWebsiteUrl(e.target.value)}
          placeholder="yourcompany.com"
          className="w-full bg-gray-900 border border-cyan-500/30 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/50"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          <Building2 className="w-4 h-4 inline mr-1.5" />
          Example Customers (optional)
        </label>
        <p className="text-xs text-gray-500 mb-2">Companies you've sold to or want to sell to</p>
        {seedInputs.map((val, i) => (
          <input
            key={i}
            type="text"
            value={val}
            onChange={e => updateSeed(i, e.target.value)}
            placeholder={`customer${i + 1}.com`}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-600 focus:border-cyan-400 focus:outline-none mb-2"
          />
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="flex-1 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold py-2.5 px-4 rounded-lg hover:opacity-90 transition-opacity"
        >
          Build My ICP
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={() => onSkip(null)}
            className="px-4 py-2.5 text-gray-400 hover:text-white transition-colors text-sm"
          >
            Skip — I'll do it manually
          </button>
        )}
      </div>
    </form>
  );
}
