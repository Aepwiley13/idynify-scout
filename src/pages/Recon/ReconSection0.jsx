/**
 * ReconSection0 — User Profile page.
 *
 * Section 0 is the first conversation Barry has with every user before
 * building the ICP. Barry learns identity, communication style, sales
 * background, quantitative targets, and qualitative goals.
 *
 * Route: /recon/user-profile
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, CheckCircle, MessageSquare } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import BarryReconCoach from '../../components/recon/BarryReconCoach';
import { getEffectiveUser } from '../../context/ImpersonationContext';

const RECON_INDIGO = '#5A3FFF';

const PROFILE_FIELDS = [
  { key: 'firstName',            label: 'First name'             },
  { key: 'role',                 label: 'Role'                   },
  { key: 'company',              label: 'Company'                },
  { key: 'communicationStyle',   label: 'Communication style'    },
  { key: 'salesYears',           label: 'Years in sales'         },
  { key: 'meetingsPerWeekTarget',label: 'Meetings/week target'   },
  { key: 'revenueTarget90Day',   label: '90-day revenue target'  },
  { key: 'qualitativeGoal',      label: 'What winning looks like'},
];

const IDENTITY_FIELDS = [
  { key: 'emailSignature', label: 'Email signature'   },
  { key: 'linkedinUrl',    label: 'LinkedIn URL'       },
  { key: 'messageLength',  label: 'Message length'     },
  { key: 'industries',     label: 'Target industries'  },
  { key: 'currentTools',   label: 'Current tools'      },
];

const SUCCESS_TARGET_FIELDS = [
  { key: 'pipelineValueTarget',  label: 'Pipeline value target'  },
  { key: 'avgDealSize',          label: 'Avg deal size'          },
  { key: 'closeRateTarget',      label: 'Close rate target'      },
  { key: 'biggestBlocker',       label: 'Biggest blocker'        },
  { key: 'whatFixedLooksLike',   label: 'What "fixed" looks like'},
];

export default function ReconSection0() {
  const T = useT();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coachOpen, setCoachOpen] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) return;
    setUserId(user.uid);

    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'reconProfile', 'section0'));
        if (snap.exists()) setProfile(snap.data());
      } catch (_) {}
      setLoading(false);
    };
    load();

    const unsub = auth.onAuthStateChanged(u => {
      if (u) {
        setUserId(u.uid);
        load();
      }
    });
    return unsub;
  }, []);

  const ALL_TRACKED = [...PROFILE_FIELDS, ...IDENTITY_FIELDS, ...SUCCESS_TARGET_FIELDS];
  const completedFields = ALL_TRACKED.filter(f => profile?.[f.key] !== undefined && profile[f.key] !== '');
  const completionPct = Math.round((completedFields.length / ALL_TRACKED.length) * 100);
  const isComplete = completionPct === 100;

  return (
    <div style={{
      padding: '28px 32px', maxWidth: 680,
      fontFamily: 'Inter, system-ui, sans-serif', color: T.text,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${RECON_INDIGO}18`, border: `1px solid ${RECON_INDIGO}35`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <User size={16} color={RECON_INDIGO} />
          </div>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: RECON_INDIGO, fontWeight: 700 }}>SECTION 0</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>User Profile</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, marginTop: 8 }}>
          Before Barry can help with ICP, targeting, or outreach — he needs to know who he's working with.
          This is a one-time coaching conversation. Barry saves your profile and uses it in every interaction.
        </div>
      </div>

      {/* Progress */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.textMuted }}>Profile completion</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: isComplete ? '#10b981' : RECON_INDIGO }}>
            {completionPct}%
          </div>
        </div>
        <div style={{ height: 6, background: T.surface, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3,
            width: `${completionPct}%`,
            background: isComplete
              ? 'linear-gradient(90deg,#10b981,#059669)'
              : `linear-gradient(90deg,${RECON_INDIGO},${BRAND.pink})`,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Profile snapshot */}
      {!loading && (
        <div style={{
          background: T.surface, borderRadius: 14,
          border: `1px solid ${T.border2}`,
          padding: '18px 20px', marginBottom: 24,
          display: 'flex', flexDirection: 'column', gap: 18,
        }}>
          {/* Core fields */}
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: T.textFaint, fontWeight: 700, marginBottom: 12 }}>
              WHAT BARRY KNOWS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {PROFILE_FIELDS.map(({ key, label }) => {
                const val = profile?.[key];
                const filled = val !== undefined && val !== '';
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {filled
                      ? <CheckCircle size={14} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                      : <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${T.border2}`, flexShrink: 0, marginTop: 2 }} />
                    }
                    <div>
                      <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 1 }}>{label}</div>
                      <div style={{ fontSize: 12, color: filled ? T.text : T.textGhost, fontStyle: filled ? 'normal' : 'italic' }}>
                        {filled
                          ? (typeof val === 'number' ? val.toLocaleString() : String(val))
                          : 'Not set'
                        }
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Identity extras */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: T.textFaint, fontWeight: 700, marginBottom: 10 }}>
              IDENTITY
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {IDENTITY_FIELDS.map(({ key, label }) => {
                const raw = profile?.[key];
                const val = Array.isArray(raw) ? raw.join(', ') : raw;
                const filled = val !== undefined && val !== '';
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {filled
                      ? <CheckCircle size={14} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                      : <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${T.border2}`, flexShrink: 0, marginTop: 2 }} />
                    }
                    <div>
                      <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 1 }}>{label}</div>
                      <div style={{ fontSize: 12, color: filled ? T.text : T.textGhost, fontStyle: filled ? 'normal' : 'italic' }}>
                        {filled ? (String(val).length > 40 ? String(val).slice(0, 40) + '…' : String(val)) : 'Not set'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Success targets */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: T.textFaint, fontWeight: 700, marginBottom: 10 }}>
              SUCCESS TARGETS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {SUCCESS_TARGET_FIELDS.map(({ key, label }) => {
                const val = profile?.[key];
                const filled = val !== undefined && val !== '';
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {filled
                      ? <CheckCircle size={14} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
                      : <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${T.border2}`, flexShrink: 0, marginTop: 2 }} />
                    }
                    <div>
                      <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 1 }}>{label}</div>
                      <div style={{ fontSize: 12, color: filled ? T.text : T.textGhost, fontStyle: filled ? 'normal' : 'italic' }}>
                        {filled
                          ? (typeof val === 'number' ? val.toLocaleString() : String(val).length > 40 ? String(val).slice(0, 40) + '…' : String(val))
                          : 'Not set'
                        }
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => setCoachOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 20px', borderRadius: 12,
          background: isComplete
            ? T.surface
            : `linear-gradient(135deg,${RECON_INDIGO},${BRAND.pink})`,
          border: isComplete ? `1px solid ${T.border2}` : 'none',
          color: isComplete ? T.textMuted : '#fff',
          fontWeight: 700, fontSize: 14, cursor: 'pointer',
          width: '100%', justifyContent: 'center',
          transition: 'all 0.15s',
        }}
      >
        <img
          src={ASSETS.barryAvatar}
          alt="Barry"
          style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }}
        />
        {isComplete ? 'Continue coaching with Barry' : profile ? 'Continue with Barry' : 'Start with Barry'}
        <MessageSquare size={16} />
      </button>

      {coachOpen && userId && (
        <BarryReconCoach
          sectionId={0}
          sectionLabel="User Profile"
          userId={userId}
          onClose={() => setCoachOpen(false)}
          onComplete={() => {
            setCoachOpen(false);
            // Reload profile after completion
            getDoc(doc(db, 'users', userId, 'reconProfile', 'section0'))
              .then(snap => { if (snap.exists()) setProfile(snap.data()); })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
