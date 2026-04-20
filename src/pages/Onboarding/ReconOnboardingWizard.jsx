import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Brain, CheckCircle2, Circle, ArrowRight, Zap } from 'lucide-react';
import { calculateReconConfidence } from '../../utils/reconConfidence';
import { CRITICAL_SECTIONS } from '../../shared/reconHealthConstants';
import './ReconOnboardingWizard.css';

const WIZARD_MODULES = [
  {
    id: 'icp-intelligence',
    title: 'ICP Intelligence',
    description: 'Who you sell to and what you offer',
    sections: [1, 2, 3, 4],
    path: '/recon/icp-intelligence',
    critical: true,
  },
  {
    id: 'objections',
    title: 'Pain Points & Objections',
    description: 'What drives your buyers and what holds them back',
    sections: [5, 6],
    path: '/recon/objections',
    critical: true,
  },
  {
    id: 'messaging',
    title: 'Messaging & Voice',
    description: 'How Barry should speak on your behalf',
    sections: [9],
    path: '/recon/messaging',
    critical: false,
    isMessagingGate: true,
  },
  {
    id: 'competitive-intel',
    title: 'Competitive Intel',
    description: 'How to position against alternatives',
    sections: [8],
    path: '/recon/competitive-intel',
    critical: false,
  },
  {
    id: 'buying-signals',
    title: 'Buying Signals',
    description: 'When and why buyers move',
    sections: [7, 10],
    path: '/recon/buying-signals',
    critical: false,
  },
];

const GREETING = {
  incomplete: "Before I can work effectively for you, I need to understand your business. Complete the training modules below — starting with ICP Intelligence. The more context you give me, the better every lead, message, and conversation will be.",
  messagingGate: "Your ICP and pain point context is solid. One more module before launch: Messaging & Voice. This tells me how to speak on your behalf — tone, value prop, proof points. It's what separates generic outreach from yours.",
  ready: "You're ready to launch. I've got enough context to start finding leads, qualifying prospects, and writing outreach that actually sounds like you. Head to Mission Control to activate your first campaigns.",
};

export default function ReconOnboardingWizard() {
  const navigate = useNavigate();
  const [wizardState, setWizardState] = useState('loading');
  const [reconConfidence, setReconConfidence] = useState(0);
  const [moduleStatuses, setModuleStatuses] = useState({});
  const [nextModule, setNextModule] = useState(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    loadState();
  }, []);

  const loadState = async () => {
    const user = auth.currentUser;
    if (!user) { navigate('/login'); return; }

    // Check if user has already completed onboarding
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (userSnap.exists() && userSnap.data()?.onboardingComplete) {
      navigate('/mission-control-v2');
      return;
    }

    // Load RECON dashboard data
    const dashSnap = await getDoc(doc(db, 'dashboards', user.uid));
    const dashData = dashSnap.exists() ? dashSnap.data() : null;

    const confidence = dashData ? calculateReconConfidence(dashData) : 0;
    setReconConfidence(confidence);

    // Build per-section completion map
    const sections = dashData?.modules?.find(m => m.id === 'recon')?.sections || [];
    const completedIds = new Set(
      sections
        .filter(s => s.status === 'completed' && s.data && (
          typeof s.data === 'string' ? s.data.trim().length > 50 : Object.keys(s.data).length > 0
        ))
        .map(s => s.sectionId ?? s.id)
    );

    // Compute module completion status
    const statuses = {};
    for (const mod of WIZARD_MODULES) {
      const completed = mod.sections.filter(id => completedIds.has(id)).length;
      statuses[mod.id] = { completed, total: mod.sections.length, done: completed === mod.sections.length };
    }
    setModuleStatuses(statuses);

    // Determine wizard state
    const criticalDone = CRITICAL_SECTIONS.every(id => completedIds.has(id));
    const messagingDone = completedIds.has(9);

    let state;
    if (messagingDone && criticalDone) {
      state = 'ready';
    } else if (criticalDone && !messagingDone) {
      state = 'messagingGate';
    } else {
      state = 'incomplete';
    }
    setWizardState(state);

    // Find next incomplete module
    const next = WIZARD_MODULES.find(m => !statuses[m.id]?.done);
    setNextModule(next || null);
  };

  const handleLaunch = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLaunching(true);
    try {
      await setDoc(doc(db, 'users', user.uid), { onboardingComplete: true }, { merge: true });
    } catch (_) {
      // non-blocking — don't block launch on write failure
    }
    navigate('/mission-control-v2');
  };

  if (wizardState === 'loading') {
    return (
      <div className="row-wizard">
        <div className="row-wizard-loading">
          <Brain size={32} color="#9333ea" />
          <p>Barry is preparing...</p>
        </div>
      </div>
    );
  }

  const greeting = GREETING[wizardState];
  const allDone = wizardState === 'ready';

  return (
    <div className="row-wizard">
      <div className="row-wizard-inner">
        {/* Barry header */}
        <div className="row-wizard-barry">
          <div className="row-wizard-avatar">
            <Brain size={28} color="#9333ea" />
          </div>
          <div className="row-wizard-greeting">
            <p className="row-wizard-name">Barry</p>
            <p className="row-wizard-message">{greeting}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="row-wizard-progress-wrap">
          <div className="row-wizard-progress-bar">
            <div
              className="row-wizard-progress-fill"
              style={{ width: `${Math.min(reconConfidence, 100)}%` }}
            />
          </div>
          <p className="row-wizard-progress-label">
            {reconConfidence}% trained
            {allDone && <span className="row-wizard-progress-complete"> — ready to launch</span>}
          </p>
        </div>

        {/* Module list */}
        <div className="row-wizard-modules">
          {WIZARD_MODULES.map((mod) => {
            const status = moduleStatuses[mod.id] || { completed: 0, total: mod.sections.length, done: false };
            const isNext = nextModule?.id === mod.id;
            const isGatePending = mod.isMessagingGate && wizardState === 'messagingGate' && !status.done;

            return (
              <div
                key={mod.id}
                className={`row-wizard-module ${status.done ? 'done' : ''} ${isNext ? 'next' : ''} ${isGatePending ? 'gate' : ''}`}
                onClick={() => !status.done && navigate(mod.path)}
                role={status.done ? undefined : 'button'}
                tabIndex={status.done ? undefined : 0}
                onKeyDown={e => { if (e.key === 'Enter' && !status.done) navigate(mod.path); }}
              >
                <div className="row-wizard-module-icon">
                  {status.done
                    ? <CheckCircle2 size={18} className="icon-done" />
                    : <Circle size={18} className={isNext ? 'icon-next' : 'icon-empty'} />
                  }
                </div>
                <div className="row-wizard-module-body">
                  <p className="row-wizard-module-title">
                    {mod.title}
                    {mod.critical && !status.done && <span className="row-wizard-critical">Required</span>}
                    {isGatePending && <span className="row-wizard-gate-badge">Next — unlocks launch</span>}
                  </p>
                  <p className="row-wizard-module-desc">{mod.description}</p>
                  {!status.done && status.completed > 0 && (
                    <p className="row-wizard-module-progress">{status.completed}/{status.total} sections done</p>
                  )}
                </div>
                {!status.done && (
                  <ArrowRight size={16} className="row-wizard-module-arrow" />
                )}
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="row-wizard-cta">
          {allDone ? (
            <button
              className="row-wizard-launch-btn"
              onClick={handleLaunch}
              disabled={launching}
            >
              <Zap size={16} />
              {launching ? 'Launching...' : 'Launch Mission Control'}
            </button>
          ) : nextModule ? (
            <button
              className="row-wizard-next-btn"
              onClick={() => navigate(nextModule.path)}
            >
              Start: {nextModule.title}
              <ArrowRight size={15} />
            </button>
          ) : null}

          {!allDone && (
            <button
              className="row-wizard-skip-btn"
              onClick={handleLaunch}
            >
              Skip for now — go to Mission Control
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
