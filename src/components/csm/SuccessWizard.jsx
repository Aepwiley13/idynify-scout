/**
 * SuccessWizard.jsx — 5-step CSM setup wizard.
 *
 * Spec ref: v1.2 Section 4 — Success Plan Setup
 *
 * Steps:
 *   1. Select customers to track
 *   2. Define milestone templates
 *   3. Set check-in cadence
 *   4. Connect Gmail (OAuth — uses return_to param)
 *   5. Review & launch
 *
 * Firestore writes:
 *   users/{userId}/successPlan        — cadence, milestone templates, launched_at
 *   users/{userId}/contacts/{id}      — milestones array (from templates)
 *
 * Props:
 *   contacts    — array of contact documents (pre-filtered to customers)
 *   userId      — current user ID
 *   onComplete  — called when wizard finishes
 *   onClose     — called when wizard is dismissed
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Users, CheckCircle2, Calendar, Mail, Rocket,
  ChevronRight, ChevronLeft, X, Search, Check,
  Clock, Zap, ArrowRight,
} from 'lucide-react';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { checkGmailConnection } from '../../utils/sendActionResolver';

// ─── Constants ────────────────────────────────────────────────────────────────
const GREEN = '#22c55e';
const TEAL  = '#14b8a6';

const STEPS = [
  { id: 'customers',  label: 'Select Customers', icon: Users        },
  { id: 'milestones', label: 'Milestones',        icon: CheckCircle2 },
  { id: 'cadence',    label: 'Check-in Cadence',  icon: Calendar     },
  { id: 'gmail',      label: 'Connect Gmail',     icon: Mail         },
  { id: 'review',     label: 'Review & Launch',   icon: Rocket       },
];

const DEFAULT_MILESTONES = [
  { id: 'onboarding',    label: 'Onboarding complete',       days: 14,  description: 'Customer has completed initial setup and training' },
  { id: 'first_value',   label: 'First value moment',        days: 30,  description: 'Customer has achieved their first measurable outcome' },
  { id: 'adoption',      label: 'Full adoption',             days: 60,  description: 'Customer is using core features regularly' },
  { id: 'expansion',     label: 'Expansion opportunity',     days: 90,  description: 'Customer is ready for upsell or cross-sell' },
  { id: 'renewal_check', label: 'Renewal health check',      days: 330, description: 'Pre-renewal review — 30 days before typical annual renewal' },
];

const CADENCE_OPTIONS = [
  { id: 'weekly',     label: 'Weekly',      days: 7,  description: 'High-touch — best for new or at-risk customers' },
  { id: 'biweekly',   label: 'Every 2 weeks', days: 14, description: 'Balanced — good for most active customers' },
  { id: 'monthly',    label: 'Monthly',     days: 30, description: 'Standard — works for stable, healthy customers' },
  { id: 'quarterly',  label: 'Quarterly',   days: 90, description: 'Low-touch — for self-serve or low-complexity customers' },
];

// ─── Step Components ──────────────────────────────────────────────────────────

function StepCustomers({ contacts, selected, onToggle, T }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.company_name || '').toLowerCase().includes(q)
    );
  }, [contacts, search]);

  return (
    <div>
      <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>
        Select the customers you want to track with the CSM module. You can add more later.
      </p>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={14} color={T.textFaint} style={{ position: 'absolute', left: 10, top: 9 }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search customers..."
          style={{
            width: '100%', padding: '8px 10px 8px 30px', borderRadius: 8,
            border: `1px solid ${T.border}`, background: T.surface,
            color: T.text, fontSize: 13, outline: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: T.textFaint }}>{selected.size} selected</span>
        <button
          onClick={() => {
            if (selected.size === contacts.length) {
              contacts.forEach(c => onToggle(c.id, false));
            } else {
              contacts.forEach(c => onToggle(c.id, true));
            }
          }}
          style={{ fontSize: 11, color: GREEN, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {selected.size === contacts.length ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(c => {
          const checked = selected.has(c.id);
          return (
            <div
              key={c.id}
              onClick={() => onToggle(c.id, !checked)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 8, cursor: 'pointer',
                background: checked ? `${GREEN}12` : T.surface,
                border: `1px solid ${checked ? `${GREEN}40` : T.border}`,
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                background: checked ? GREEN : 'transparent',
                border: `2px solid ${checked ? GREEN : T.border2}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {checked && <Check size={11} color="#fff" strokeWidth={3} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                {c.company_name && <div style={{ fontSize: 11, color: T.textFaint }}>{c.company_name}</div>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
            {search ? 'No customers match your search' : 'No customers found. Add customers in the People view first.'}
          </div>
        )}
      </div>
    </div>
  );
}

function StepMilestones({ milestones, onUpdate, T }) {
  function toggleMilestone(id) {
    onUpdate(milestones.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m));
  }
  function updateDays(id, days) {
    onUpdate(milestones.map(m => m.id === id ? { ...m, days: Math.max(1, days) } : m));
  }

  return (
    <div>
      <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>
        Choose which milestones to track for your customers. Barry will remind you when milestones are due.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {milestones.map(m => (
          <div
            key={m.id}
            style={{
              padding: '10px 12px', borderRadius: 8,
              background: m.enabled ? `${TEAL}08` : T.surface,
              border: `1px solid ${m.enabled ? `${TEAL}40` : T.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div
                onClick={() => toggleMilestone(m.id)}
                style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                  background: m.enabled ? TEAL : 'transparent',
                  border: `2px solid ${m.enabled ? TEAL : T.border2}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {m.enabled && <Check size={11} color="#fff" strokeWidth={3} />}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{m.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={11} color={T.textFaint} />
                <input
                  type="number"
                  value={m.days}
                  onChange={e => updateDays(m.id, parseInt(e.target.value) || 1)}
                  style={{
                    width: 48, padding: '2px 4px', borderRadius: 4,
                    border: `1px solid ${T.border}`, background: T.surface,
                    color: T.text, fontSize: 12, textAlign: 'center',
                  }}
                />
                <span style={{ fontSize: 11, color: T.textFaint }}>days</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.textFaint, marginLeft: 26 }}>{m.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepCadence({ cadence, onSelect, T }) {
  return (
    <div>
      <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>
        How often should Barry prompt you to check in with your customers?
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CADENCE_OPTIONS.map(opt => {
          const active = cadence === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              style={{
                padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                background: active ? `${GREEN}12` : T.surface,
                border: `1px solid ${active ? GREEN : T.border}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${active ? GREEN : T.border2}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN }} />}
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{opt.label}</span>
                <span style={{ fontSize: 11, color: T.textFaint, marginLeft: 'auto' }}>Every {opt.days} days</span>
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4, marginLeft: 24 }}>{opt.description}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepGmail({ userId, T }) {
  const [status, setStatus] = useState(null); // null | 'checking' | 'connected' | 'not_connected'

  async function checkConnection() {
    setStatus('checking');
    try {
      const result = await checkGmailConnection(userId);
      setStatus(result.connected ? 'connected' : 'not_connected');
    } catch {
      setStatus('not_connected');
    }
  }

  function startOAuth() {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI || `${window.location.origin}/.netlify/functions/gmail-oauth-callback`;
    const scope = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email';
    // Encode return_to in state using pipe delimiter (matches gmail-oauth-callback.js)
    const state = `${userId}|/basecamp?wizard=gmail`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
    window.location.href = url;
  }

  // Check on mount
  useState(() => { checkConnection(); });

  return (
    <div>
      <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>
        Connect Gmail so Barry can draft and send check-in emails on your behalf. You review every message before it sends.
      </p>
      <div style={{
        padding: 20, borderRadius: 12, textAlign: 'center',
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        {status === 'checking' && (
          <div style={{ color: T.textFaint, fontSize: 13 }}>Checking connection...</div>
        )}
        {status === 'connected' && (
          <>
            <CheckCircle2 size={32} color={GREEN} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: GREEN }}>Gmail Connected</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>You're all set. Barry can draft emails for your review.</div>
          </>
        )}
        {(status === 'not_connected' || status === null) && (
          <>
            <Mail size={32} color={T.textFaint} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 4 }}>Gmail Not Connected</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>Connect to enable email check-ins. You can skip this and connect later.</div>
            <button
              onClick={startOAuth}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg,${GREEN},${TEAL})`,
                color: '#fff', fontSize: 13, fontWeight: 600,
              }}
            >
              Connect Gmail
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StepReview({ selected, milestones, cadence, T }) {
  const enabledMilestones = milestones.filter(m => m.enabled);
  const cadenceLabel = CADENCE_OPTIONS.find(o => o.id === cadence)?.label || cadence;

  return (
    <div>
      <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>
        Review your CSM setup. You can change any of these settings later.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '10px 12px', borderRadius: 8, background: T.surface, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 4 }}>CUSTOMERS</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{selected.size} customer{selected.size !== 1 ? 's' : ''} selected</div>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 8, background: T.surface, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 4 }}>MILESTONES</div>
          {enabledMilestones.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {enabledMilestones.map(m => (
                <span key={m.id} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 12,
                  background: `${TEAL}15`, color: TEAL, border: `1px solid ${TEAL}30`,
                }}>
                  {m.label} ({m.days}d)
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: T.textFaint }}>No milestones selected</div>
          )}
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 8, background: T.surface, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 4 }}>CHECK-IN CADENCE</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{cadenceLabel}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function SuccessWizard({ contacts = [], userId, onComplete, onClose }) {
  const T = useT();
  const [step, setStep] = useState(0);
  const [selectedIds, setSelectedIds] = useState(() => new Set(contacts.map(c => c.id)));
  const [milestones, setMilestones] = useState(() =>
    DEFAULT_MILESTONES.map(m => ({ ...m, enabled: true }))
  );
  const [cadence, setCadence] = useState('biweekly');
  const [launching, setLaunching] = useState(false);

  const toggleCustomer = useCallback((id, add) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (add) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return selectedIds.size > 0;
      case 1: return milestones.some(m => m.enabled);
      case 2: return !!cadence;
      case 3: return true; // Gmail is optional
      case 4: return true;
      default: return false;
    }
  }, [step, selectedIds.size, milestones, cadence]);

  async function handleLaunch() {
    setLaunching(true);
    try {
      const enabledMilestones = milestones.filter(m => m.enabled);
      const cadenceDays = CADENCE_OPTIONS.find(o => o.id === cadence)?.days || 14;

      // 1. Save success plan
      await setDoc(doc(db, 'users', userId, 'successPlan', 'config'), {
        cadence,
        cadence_days: cadenceDays,
        milestone_templates: enabledMilestones.map(m => ({
          id: m.id, label: m.label, days: m.days, description: m.description,
        })),
        customer_ids: [...selectedIds],
        launched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // 2. Apply milestones to each selected customer
      const updates = [...selectedIds].map(contactId => {
        const contactMilestones = enabledMilestones.map(m => ({
          id: m.id,
          label: m.label,
          target_days: m.days,
          completed: false,
          completed_at: null,
        }));
        return updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
          milestones: contactMilestones,
          csm_cadence: cadence,
          csm_cadence_days: cadenceDays,
          csm_enrolled_at: new Date().toISOString(),
        });
      });
      await Promise.all(updates);

      onComplete && onComplete();
    } catch (err) {
      console.error('[SuccessWizard] launch failed:', err);
    } finally {
      setLaunching(false);
    }
  }

  const StepIcon = STEPS[step].icon;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: T.cardBg, borderRadius: 16,
        border: `1px solid ${T.border}`,
        boxShadow: `0 16px 48px rgba(0,0,0,0.3)`,
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `linear-gradient(135deg,${GREEN},${TEAL})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <StepIcon size={16} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>CSM Setup</div>
              <div style={{ fontSize: 11, color: T.textFaint }}>Step {step + 1} of {STEPS.length} — {STEPS[step].label}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color={T.textFaint} />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ padding: '0 20px', marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: i <= step ? GREEN : T.border,
                  transition: 'background 0.2s',
                }}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
          {step === 0 && <StepCustomers contacts={contacts} selected={selectedIds} onToggle={toggleCustomer} T={T} />}
          {step === 1 && <StepMilestones milestones={milestones} onUpdate={setMilestones} T={T} />}
          {step === 2 && <StepCadence cadence={cadence} onSelect={setCadence} T={T} />}
          {step === 3 && <StepGmail userId={userId} T={T} />}
          {step === 4 && <StepReview selected={selectedIds} milestones={milestones} cadence={cadence} T={T} />}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '8px 14px', borderRadius: 8,
              background: 'none', border: `1px solid ${step === 0 ? T.border : T.border2}`,
              color: step === 0 ? T.textFaint : T.text,
              fontSize: 13, fontWeight: 500, cursor: step === 0 ? 'default' : 'pointer',
              opacity: step === 0 ? 0.5 : 1,
            }}
          >
            <ChevronLeft size={14} />
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
              disabled={!canAdvance}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: canAdvance ? `linear-gradient(135deg,${GREEN},${TEAL})` : T.border,
                color: canAdvance ? '#fff' : T.textFaint,
                fontSize: 13, fontWeight: 600, cursor: canAdvance ? 'pointer' : 'default',
              }}
            >
              {step === 3 ? 'Skip' : 'Next'}
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleLaunch}
              disabled={launching || !canAdvance}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 22px', borderRadius: 8, border: 'none',
                background: `linear-gradient(135deg,${GREEN},${TEAL})`,
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: launching ? 'wait' : 'pointer',
                opacity: launching ? 0.7 : 1,
              }}
            >
              <Rocket size={14} />
              {launching ? 'Launching...' : 'Launch CSM'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
