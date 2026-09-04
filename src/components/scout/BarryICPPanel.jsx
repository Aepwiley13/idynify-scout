/**
 * BarryICPPanel — shared slide-in chat panel for ICP targeting.
 * Used by DailyLeads (swipe view) and ICPSettings (manual edit view).
 */
import { useState, useEffect, useRef } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { ArrowRight, Loader } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { resolveActiveIcp, isResolved, explainUnresolved } from '../../utils/resolveActiveIcp';
import { appendTurn, loadOrSeedRecentTurns } from '../../utils/barryCanonical';
import { normalizeIcpParams } from '../../utils/normalizeIcpParams';

// ─── BarryAvatar ──────────────────────────────────────────────────────────────
export function BarryAvatar({ size = 20, style = {} }) {
  const T = useT();
  const chakra = T.cyan || BRAND.cyan;
  const glow = `0 0 ${size * 0.5}px ${chakra}50`;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${chakra})`,
      border: `2px solid ${chakra}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.46, flexShrink: 0, boxShadow: glow, overflow: 'hidden', ...style,
    }}>
      <img
        src={ASSETS.barryAvatar}
        alt="Barry"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
      />
    </div>
  );
}

// ─── buildInstantGreeting ─────────────────────────────────────────────────────
function buildInstantGreeting(icpProfile) {
  if (!icpProfile || !icpProfile.industries?.length) {
    return "Who are you hunting? Tell me about your ideal customer — industry, company size, location, and who you sell to — and I'll find the right companies for you.";
  }
  const parts = [];
  if (icpProfile.industries?.length) parts.push(icpProfile.industries.slice(0, 2).join(' / '));
  if (icpProfile.companySizes?.length) parts.push(icpProfile.companySizes.slice(0, 2).join(', ') + ' employees');
  if (icpProfile.isNationwide) parts.push('nationwide');
  else if (icpProfile.locations?.length) parts.push(icpProfile.locations.slice(0, 2).join(', '));
  const summary = parts.join(' · ');
  return `I'm currently finding ${summary} companies for you. Want to refine your targeting, or should I keep looking?`;
}

// ─── BarryICPPanel ────────────────────────────────────────────────────────────
// Side panel version of ICP chat — user can see the page content while chatting.
export default function BarryICPPanel({ userId, icpProfile, onClose, onSearchComplete, nudgeContext = null }) {
  const T = useT();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasEnoughContext, setHasEnoughContext] = useState(false);
  const [icpParams, setIcpParams] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [unresolvedNotice, setUnresolvedNotice] = useState(null);
  const messagesEndRef = useRef(null);

  // On mount: load prior conversation from Firestore, then show instant greeting.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const user = getEffectiveUser();
      if (!user) {
        setMessages([{ role: 'barry', content: buildInstantGreeting(icpProfile) }]);
        setHistoryLoaded(true);
        return;
      }

      try {
        const turns = await loadOrSeedRecentTurns(db, user.uid, 30);
        if (!cancelled && turns.length > 0) {
          const displayMsgs = turns.map(t => ({
            role: t.role === 'assistant' ? 'barry' : 'user',
            content: t.content,
            kind: t.kind || undefined,
          }));
          const apiHistory = turns.map(t => ({
            role: t.role,
            content: t.content,
          }));
          setMessages([
            { role: 'system', content: '— Resumed from previous session —' },
            ...displayMsgs,
          ]);
          setConversationHistory(apiHistory);
          setHistoryLoaded(true);
          return;
        }
      } catch (err) {
        console.warn('Could not load Barry conversation history:', err);
      }

      if (!cancelled) {
        const greeting = nudgeContext
          ? `I noticed ${nudgeContext.count} of your recent saves are ${nudgeContext.industry} companies. Want me to weight ${nudgeContext.industry} higher in your ICP? I can update your targeting now.`
          : buildInstantGreeting(icpProfile);
        setMessages([{ role: 'barry', content: greeting }]);
        setHistoryLoaded(true);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendToBarry = async (msg, history, profileOverride) => {
    setLoading(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();
      const profileToSend = profileOverride !== undefined ? profileOverride : icpProfile;
      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          message: msg,
          conversationHistory: history,
          icpMode: true,
          icpProfile: profileToSend,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, { role: 'barry', content: data.response_text }]);
        const newHistory = data.updatedHistory || [
          ...history,
          ...(msg !== '__ICP_RECLARIFICATION__' ? [{ role: 'user', content: msg }] : []),
          { role: 'assistant', content: data.response_text },
        ];
        setConversationHistory(newHistory);
        if (data.has_enough_context) { setHasEnoughContext(true); setIcpParams(data.icp_params); }

        try {
          if (msg !== '__ICP_RECLARIFICATION__') {
            await appendTurn(db, user.uid, { role: 'user', content: msg, surface: 'sidecar' });
          }
          await appendTurn(db, user.uid, { role: 'assistant', content: data.response_text, surface: 'sidecar' });
        } catch (persistErr) {
          console.warn('[BarryICPPanel] canonical append failed (non-fatal):', persistErr.message);
        }
      }
    } catch (err) {
      console.error('Barry ICP panel error:', err);
      setMessages(prev => [...prev, { role: 'barry', content: "Something went wrong — please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    sendToBarry(userMsg, conversationHistory);
  };

  const handleFindCompanies = async () => {
    if (!icpParams || isSearching) return;
    setIsSearching(true);
    try {
      const user = getEffectiveUser();
      if (!user) { onSearchComplete(); return; }
      // This panel refines an ICP the user already has. It never creates one.
      // It previously merged Barry's extracted params into the bridge alone —
      // icpProfiles never learned about the change, so the next activation
      // silently reverted the user's refinement — and then searched with no
      // icpId, which the server turned into a fabricated 'default'.
      const resolution = await resolveActiveIcp(user.uid);
      if (!isResolved(resolution)) {
        console.warn(`[BarryICPPanel] refinement skipped — ICP unresolved (${resolution.reason})`);
        setUnresolvedNotice(explainUnresolved(resolution));
        setIsSearching(false);
        return;
      }
      const authToken = await user.getIdToken();
      const normalized = normalizeIcpParams(icpParams);
      const mergedProfile = {
        ...resolution.profile,
        ...(normalized.industries?.length > 0 && { industries: normalized.industries }),
        ...(normalized.companySizes?.length > 0 && { companySizes: normalized.companySizes }),
        ...(normalized.targetTitles?.length > 0 && { targetTitles: normalized.targetTitles }),
        ...(normalized.companyKeywords?.length > 0 && { companyKeywords: normalized.companyKeywords }),
        updatedAt: new Date().toISOString(),
        managedByBarry: true,
      };
      // Authoritative first, projection second.
      await setDoc(
        doc(db, 'users', user.uid, 'icpProfiles', resolution.icpId),
        mergedProfile,
        { merge: true }
      );
      await setDoc(
        doc(db, 'users', user.uid, 'companyProfile', 'current'),
        { ...mergedProfile, icpId: resolution.icpId, icpIdSource: 'barry-icp-panel' }
      );
      await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: mergedProfile,
          icpId: resolution.icpId,
        }),
      });
    } catch (err) {
      console.error('ICP search error:', err);
    } finally {
      onSearchComplete();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 498, background: 'rgba(0,0,0,0.4)' }} />

      {/* Side panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 499,
        background: T.cardBg, borderLeft: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: `-8px 0 40px rgba(0,0,0,0.3)`,
        animation: 'slideIn 0.22s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <BarryAvatar size={36} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>Barry</div>
            <div style={{ fontSize: 11, color: T.textFaint }}>ICP-aware targeting assistant</div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={async () => {
                const user = getEffectiveUser();
                if (user) {
                  try { await deleteDoc(doc(db, 'users', user.uid, 'barryConversations', 'icpChat')); } catch (_) {}
                }
                // Gate 1: reset ICP params without destroying conversation
                // history. The canonical conversation survives; only the
                // ICP-specific context is cleared for a fresh refinement.
                setHasEnoughContext(false);
                setIcpParams(null);
                sendToBarry('__ICP_RECLARIFICATION__', conversationHistory, icpProfile);
              }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
              title="Start over"
            >
              Start over
            </button>
          )}
          <button onClick={onClose} style={{ marginLeft: messages.length > 0 ? 0 : 'auto', background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 22, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!historyLoaded ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader size={20} color={BRAND.pink} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : messages.map((msg, i) => (
            msg.role === 'system' ? (
              <div key={i} style={{ textAlign: 'center', fontSize: 11, color: T.textFaint, padding: '4px 0' }}>
                {msg.content}
              </div>
            ) : (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
                {msg.role === 'barry' && <BarryAvatar size={26} style={{ flexShrink: 0 }} />}
                <div style={{
                  maxWidth: '82%', padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user' ? `linear-gradient(135deg,${BRAND.pink},#c0146a)` : T.surface,
                  color: msg.role === 'user' ? '#fff' : T.text,
                  fontSize: 13, lineHeight: 1.55,
                  border: msg.role === 'barry' ? `1px solid ${T.border2}` : 'none',
                }}>
                  {msg.content}
                </div>
              </div>
            )
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarryAvatar size={26} style={{ flexShrink: 0 }} />
              <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: T.surface, border: `1px solid ${T.border2}` }}>
                <Loader size={14} color={BRAND.pink} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* An ICP-dependent action that could not resolve an ICP explains why —
            it does not silently do nothing, and it does not invent an ICP. */}
        {unresolvedNotice && (
          <div style={{ padding: '0 20px 10px', flexShrink: 0 }}>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: `${BRAND.pink}12`, border: `1px solid ${BRAND.pink}55`, color: T.text, fontSize: 13 }}>
              {unresolvedNotice}
            </div>
          </div>
        )}

        {/* Find Companies CTA */}
        {hasEnoughContext && (
          <div style={{ padding: '0 20px 10px', flexShrink: 0 }}>
            <button
              onClick={handleFindCompanies}
              disabled={isSearching}
              style={{ width: '100%', padding: 13, borderRadius: 12, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: isSearching ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: isSearching ? 0.75 : 1 }}
            >
              {isSearching ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={16} />}
              {isSearching ? 'Finding companies…' : 'Find My Companies'}
            </button>
          </div>
        )}

        {/* Input */}
        <div style={{ padding: hasEnoughContext ? '0 20px 16px' : '12px 20px', borderTop: hasEnoughContext ? 'none' : `1px solid ${T.border}`, display: 'flex', gap: 8, flexShrink: 0 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={loading ? 'Barry is thinking…' : hasEnoughContext ? 'Anything else to add…' : "Tell Barry who you're targeting…"}
            disabled={isSearching}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: `1px solid ${T.border2}`, background: T.surface, color: T.text, fontSize: 13, outline: 'none', opacity: isSearching ? 0.5 : 1 }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim() || isSearching}
            style={{ padding: '10px 14px', borderRadius: 10, background: hasEnoughContext ? T.surface : `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: hasEnoughContext ? `1px solid ${T.border2}` : 'none', color: hasEnoughContext ? T.textMuted : '#fff', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1 }}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
