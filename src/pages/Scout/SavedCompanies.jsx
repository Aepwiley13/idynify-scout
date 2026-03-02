/**
 * SavedCompanies.jsx — Saved/matched company list with stats header, cards/list/swipe toggle.
 *
 * UI: idynify-v5 design with theme tokens.
 * Data: Firebase Firestore (all original data wiring preserved).
 */
import { useEffect, useState, useRef } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Search, Globe, Linkedin, Target, Archive, RotateCcw, TrendingUp, Award } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, ASSETS } from '../../theme/tokens';
import CompanyLogo from '../../components/scout/CompanyLogo';
import CompanyDetailModal from '../../components/scout/CompanyDetailModal';

// ─── SavedCompanies ───────────────────────────────────────────────────────────
export default function SavedCompanies({ onSelectCompany }) {
  const T = useT();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState([]);
  const [archivedCompanies, setArchivedCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  // Persist viewMode across the drill-in/back cycle
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('sc_viewMode') || 'cards');
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'archived'
  const [searchTerm, setSearchTerm] = useState('');
  const [detailCompany, setDetailCompany] = useState(null);

  const updateViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('sc_viewMode', mode);
  };

  useEffect(() => { loadSavedCompanies(); }, []);

  async function loadSavedCompanies() {
    try {
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }
      const userId = user.uid;

      const acceptedQuery = query(collection(db, 'users', userId, 'companies'), where('status', '==', 'accepted'));
      const archivedQuery = query(collection(db, 'users', userId, 'companies'), where('status', '==', 'archived'));
      const [acceptedSnap, archivedSnap] = await Promise.all([getDocs(acceptedQuery), getDocs(archivedQuery)]);

      async function enrichWithContacts(snap) {
        return Promise.all(snap.docs.map(async companyDoc => {
          const company = { id: companyDoc.id, ...companyDoc.data() };
          try {
            const contactsSnap = await getDocs(query(collection(db, 'users', userId, 'contacts'), where('company_id', '==', company.id)));
            const approvedCount = contactsSnap.docs.filter(d => d.data().status !== 'suggested').length;
            const suggestedCount = contactsSnap.size - approvedCount;
            return { ...company, contact_count: approvedCount, suggested_contact_count: suggestedCount };
          } catch {
            return { ...company, contact_count: 0, suggested_contact_count: 0 };
          }
        }));
      }

      const sortNewest = list => list.sort((a, b) => {
        const dA = a.saved_at || a.created_at || a.swipedAt || '';
        const dB = b.saved_at || b.created_at || b.swipedAt || '';
        return String(dB).localeCompare(String(dA));
      });

      const [companiesList, archivedList] = await Promise.all([enrichWithContacts(acceptedSnap), enrichWithContacts(archivedSnap)]);
      setCompanies(sortNewest(companiesList));
      setArchivedCompanies(sortNewest(archivedList));
      setLoading(false);
    } catch (error) {
      console.error('Failed to load saved companies:', error);
      setLoading(false);
    }
  }

  async function handleArchiveCompany(company) {
    try {
      const userId = auth.currentUser.uid;
      await updateDoc(doc(db, 'users', userId, 'companies', company.id), {
        status: 'archived', archived_at: new Date().toISOString(),
        activity_log: arrayUnion({ type: 'status_changed', from: 'accepted', to: 'archived', timestamp: new Date().toISOString() }),
      });
      setCompanies(prev => prev.filter(c => c.id !== company.id));
      setArchivedCompanies(prev => [...prev, { ...company, status: 'archived' }]);
    } catch (error) {
      console.error('Failed to archive company:', error);
    }
  }

  async function handleRestoreCompany(company) {
    try {
      const userId = auth.currentUser.uid;
      await updateDoc(doc(db, 'users', userId, 'companies', company.id), {
        status: 'accepted', archived_at: null,
        activity_log: arrayUnion({ type: 'status_changed', from: 'archived', to: 'accepted', timestamp: new Date().toISOString() }),
      });
      setArchivedCompanies(prev => prev.filter(c => c.id !== company.id));
      setCompanies(prev => [...prev, { ...company, status: 'accepted' }]);
    } catch (error) {
      console.error('Failed to restore company:', error);
    }
  }

  function handleCompanyClick(company) {
    setDetailCompany(company);
  }

  function handleFindContacts(company) {
    if (onSelectCompany) {
      onSelectCompany(company.id);
    } else {
      if (company.contact_count > 0) {
        navigate(`/scout/company/${company.id}/leads`);
      } else {
        navigate(`/scout/company/${company.id}`);
      }
    }
  }

  // KPIs
  const totalContacts = companies.reduce((sum, c) => sum + (c.contact_count || 0), 0);
  const companiesWithContacts = companies.filter(c => c.contact_count > 0).length;
  const completionRate = companies.length > 0 ? Math.round((companiesWithContacts / companies.length) * 100) : 0;
  // Sort by fit score descending so highest-priority companies appear first in swipe
  const noContactCompanies = companies
    .filter(c => c.contact_count === 0)
    .sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

  // Filtered list (cards/list modes)
  const sourceList = activeTab === 'active' ? companies : archivedCompanies;
  const filteredCompanies = searchTerm.trim()
    ? sourceList.filter(c => c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || c.industry?.toLowerCase().includes(searchTerm.toLowerCase()))
    : sourceList;

  const isArchived = activeTab === 'archived';

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: T.textMuted }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${BRAND.pink}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: 13, margin: 0 }}>Loading your matched companies...</p>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  if (companies.length === 0 && archivedCompanies.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16, color: T.textMuted }}>
        <Building2 size={48} color={T.textFaint} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>No Matched Companies Yet</h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, textAlign: 'center' }}>
          Match with companies in Daily Leads to start building your hunt list.
        </p>
        <button
          onClick={() => navigate('/scout', { state: { activeTab: 'daily-leads' } })}
          style={{ padding: '10px 22px', borderRadius: 10, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        ><Target size={14} />Start Matching Companies</button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>

      {/* ── Header ── */}
      <div style={{ padding: '18px 22px 0', borderBottom: `1px solid ${T.border}`, background: T.navBg, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>
            {viewMode === 'swipe' ? 'Find Contacts' : 'Saved Companies'}
          </h2>
          {/* View toggle — cards / list / swipe */}
          <div style={{ display: 'flex', gap: 4, background: T.surface, borderRadius: 8, padding: 3 }}>
            {[['cards', '⊞', 'Cards'], ['list', '☰', 'List'], ['swipe', '⟷', 'Find Contacts']].map(([m, icon, label]) => (
              <button
                key={m}
                onClick={() => updateViewMode(m)}
                title={label}
                style={{
                  padding: '5px 13px', borderRadius: 6, border: 'none',
                  background: viewMode === m ? BRAND.pink : 'transparent',
                  color: viewMode === m ? '#fff' : T.textMuted,
                  fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >{icon}</button>
            ))}
          </div>
        </div>

        {/* Stats header — always visible */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
          {[
            ['Total Companies', companies.length, false],
            ['Total Contacts', totalContacts, false],
            ['With Contacts', companiesWithContacts, false],
            ['Completion Rate', `${completionRate}%`, true],
          ].map(([label, value, highlight]) => (
            <div
              key={label}
              style={{ background: highlight ? T.cyanBg : T.statBg, border: `1px solid ${highlight ? T.cyanBdr : T.border}`, borderRadius: 9, padding: '10px 12px' }}
            >
              <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? T.cyan : T.text }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Active / Archived tabs — hidden in swipe mode */}
        {viewMode !== 'swipe' && (
          <div style={{ display: 'flex', gap: 0 }}>
            {[['active', `Active (${companies.length})`], ['archived', `Archived (${archivedCompanies.length})`]].map(([id, label]) => (
              <div
                key={id}
                onClick={() => { setActiveTab(id); setSearchTerm(''); }}
                style={{ padding: '7px 16px', fontSize: 12, cursor: 'pointer', borderBottom: `2px solid ${activeTab === id ? BRAND.pink : 'transparent'}`, color: activeTab === id ? BRAND.pink : T.textMuted }}
              >{label}</div>
            ))}
          </div>
        )}
      </div>

      {/* ── Search — hidden in swipe mode ── */}
      {viewMode !== 'swipe' && (
        <div style={{ padding: '11px 22px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Search size={14} color={T.textFaint} />
            <input
              placeholder="Search companies by name or industry..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 12, flex: 1 }}
            />
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {viewMode === 'swipe' ? (
        <SwipeDeck
          key={noContactCompanies.map(c => c.id).join(',')}
          companies={noContactCompanies}
          totalActive={companies.length}
          T={T}
          onFindContact={company => handleFindContacts(company)}
        />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
          {filteredCompanies.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: T.textFaint }}>
              <p style={{ fontSize: 13 }}>{searchTerm ? 'No companies match your search.' : isArchived ? 'No archived companies.' : 'No saved companies yet.'}</p>
            </div>
          ) : viewMode === 'cards' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(258px,1fr))', gap: 12 }}>
              {filteredCompanies.map(company => (
                <CompanyCardV5
                  key={company.id}
                  company={company}
                  isArchived={isArchived}
                  T={T}
                  onClick={() => handleCompanyClick(company)}
                  onFindContacts={() => handleFindContacts(company)}
                  onArchive={() => handleArchiveCompany(company)}
                  onRestore={() => handleRestoreCompany(company)}
                />
              ))}
            </div>
          ) : (
            <div style={{ background: T.navBg, borderRadius: 11, overflow: 'hidden', border: `1px solid ${T.border}` }}>
              {filteredCompanies.map((company, i) => (
                <div
                  key={company.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 15px', borderBottom: i < filteredCompanies.length - 1 ? `1px solid ${T.border}` : 'none', cursor: 'pointer', transition: 'all 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = T.rowHov}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={() => handleCompanyClick(company)}
                >
                  <div style={{ width: 30, height: 30, borderRadius: 7, background: T.surface, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, overflow: 'hidden' }}>
                    <CompanyLogo company={company} size="small" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{company.name}</div>
                    <div style={{ fontSize: 10, color: T.textFaint }}>{company.industry} · {company.founded_year ? `Founded ${company.founded_year}` : ''}</div>
                  </div>
                  {company.contact_count > 0 && (
                    <span style={{ fontSize: 9, background: `${STATUS.green}15`, color: STATUS.green, borderRadius: 7, padding: '2px 7px' }}>
                      {company.contact_count} contact{company.contact_count !== 1 ? 's' : ''}
                    </span>
                  )}
                  {isArchived ? (
                    <button
                      onClick={e => { e.stopPropagation(); handleRestoreCompany(company); }}
                      style={{ padding: '5px 11px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                    ><RotateCcw size={11} />Restore</button>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); handleFindContacts(company); }}
                      style={{ padding: '5px 11px', borderRadius: 7, border: 'none', background: company.contact_count > 0 ? T.cyanBg : `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: company.contact_count > 0 ? T.cyan : '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {company.contact_count > 0 ? 'View →' : 'Find Contacts'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Company Detail Modal ── */}
      {detailCompany && (
        <CompanyDetailModal
          company={detailCompany}
          onClose={() => setDetailCompany(null)}
          onFindMoreContacts={(id) => {
            setDetailCompany(null);
            if (onSelectCompany) {
              onSelectCompany(id);
            } else {
              const c = [...companies, ...archivedCompanies].find(x => x.id === id);
              if (c && c.contact_count > 0) navigate(`/scout/company/${id}/leads`);
              else navigate(`/scout/company/${id}`);
            }
          }}
        />
      )}

    </div>
  );
}

// ─── BarryAvatar ──────────────────────────────────────────────────────────────
function BarryAvatar({ size = 20, style = {} }) {
  const glow = `0 0 ${size * 0.5}px ${BRAND.cyan}50`;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
      border: `2px solid ${BRAND.cyan}50`,
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

// ─── SwipeDeck ────────────────────────────────────────────────────────────────
function SwipeDeck({ companies, totalActive, T, onFindContact }) {
  const [deck, setDeck] = useState(() => [...companies]);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [gone, setGone] = useState(null);       // null | 'left' | 'right' — fly-out direction
  const [lastSkipped, setLastSkipped] = useState(null); // company for undo
  const [initialCount] = useState(() => companies.length);
  const handlersRef = useRef({});

  const current = deck[0];
  const remaining = deck.length;
  const withContacts = totalActive - remaining;
  const progress = totalActive > 0 ? Math.round((withContacts / totalActive) * 100) : 100;

  const motivation = (() => {
    if (remaining === 0) return { emoji: '🏆', headline: "You're a legend!", sub: 'Every company has a contact. Time to start hunting.' };
    if (remaining === 1) return { emoji: '🔥', headline: 'Last one!', sub: 'One more contact and your list is fully loaded.' };
    if (progress >= 75) return { emoji: '⚡', headline: 'Almost there!', sub: `Just ${remaining} companies left — finish strong.` };
    if (progress >= 50) return { emoji: '💪', headline: 'Halfway done!', sub: `${remaining} companies still need a contact.` };
    if (progress >= 25) return { emoji: '🚀', headline: "You're on a roll!", sub: `${remaining} companies are waiting for a contact.` };
    return { emoji: '🎯', headline: "Let's load up your list!", sub: `${remaining} companies need a contact — let's go.` };
  })();

  // ── Actions ──────────────────────────────────────────────────────────────────

  function handleSkip() {
    if (gone || !current) return;
    const skipped = current;
    setGone('left');
    setTimeout(() => {
      setDeck(prev => { const [first, ...rest] = prev; return [...rest, first]; });
      setLastSkipped(skipped);
      setGone(null);
      setDragOffset({ x: 0, y: 0 });
    }, 280);
  }

  function handleFindContact() {
    if (gone || !current) return;
    const found = current;
    setGone('right');
    // Signal to CompanyProfileView that we came from the swipe queue
    sessionStorage.setItem('sc_fromSwipe', String(deck.length - 1));
    setTimeout(() => {
      setDeck(prev => prev.slice(1));
      setLastSkipped(null); // can't undo past a "find contact"
      setGone(null);
      setDragOffset({ x: 0, y: 0 });
      onFindContact(found);
    }, 280);
  }

  function handleUndo() {
    if (!lastSkipped || gone) return;
    setDeck(prev => [lastSkipped, ...prev.filter(c => c.id !== lastSkipped.id)]);
    setLastSkipped(null);
  }

  // Keep a stable ref so the keyboard listener always sees fresh handlers
  useEffect(() => { handlersRef.current = { handleSkip, handleFindContact, handleUndo }; });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'f') handlersRef.current.handleFindContact();
      else if (e.key === 'ArrowLeft' || e.key === 's') handlersRef.current.handleSkip();
      else if (e.key === 'u' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        handlersRef.current.handleUndo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Drag handlers ─────────────────────────────────────────────────────────────

  function onMouseDown(e) {
    if (e.target.closest('button') || e.target.closest('a')) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  }

  function onMouseMove(e) {
    if (!isDragging || !dragStart || gone) return;
    setDragOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }

  function onRelease() {
    if (!isDragging) return;
    if (!gone) {
      if (dragOffset.x > 100) handleFindContact();
      else if (dragOffset.x < -100) handleSkip();
      else setDragOffset({ x: 0, y: 0 });
    }
    setIsDragging(false);
    setDragStart(null);
  }

  function onTouchStart(e) {
    const t = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: t.clientX, y: t.clientY });
  }

  function onTouchMove(e) {
    if (!isDragging || !dragStart || gone) return;
    const t = e.touches[0];
    setDragOffset({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y });
  }

  // ── Animation values ──────────────────────────────────────────────────────────
  const flyX  = gone === 'right' ? 900 : gone === 'left' ? -900 : dragOffset.x;
  const flyRot = gone === 'right' ? 22 : gone === 'left' ? -22 : dragOffset.x * 0.04;
  const flyOp  = gone ? 0 : 1 - Math.abs(dragOffset.x) / 500;
  const showFindOverlay = !gone && dragOffset.x > 45;
  const showSkipOverlay = !gone && dragOffset.x < -45;

  // ── Card-level derived values (DailyLeads parity) ────────────────────────────
  const overlayOpacity = Math.min(Math.abs(dragOffset.x) / 100 * 1.5, 0.85);
  const score = current?.fit_score || 0;
  const sc = score >= 75 ? STATUS.green : score >= 50 ? STATUS.amber : STATUS.red;
  const scoreLabel = score >= 75 ? 'Strong Fit' : score >= 50 ? 'Good Match' : 'Low Fit';
  const barryText = current?.barry_intel || current?.barry_context || current?.barryIntel
    || current?.description
    || `${current?.name} is on your hunt list — find the right contact to start engaging.`;
  const hqLocation = current?.hq_location
    || (current?.headquarters_city ? `${current.headquarters_city}${current.headquarters_state ? ', ' + current.headquarters_state : ''}` : null)
    || current?.headquarters || current?.location || current?.city || null;
  const CARD_H = 'clamp(390px, calc(100vh - 300px), 590px)';

  // ── Dot position indicator ────────────────────────────────────────────────────
  const MAX_DOTS = 7;
  const dotsVisible = Math.min(MAX_DOTS, remaining);

  // ── All done state ────────────────────────────────────────────────────────────
  if (remaining === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 18, textAlign: 'center' }}>
        <div style={{ fontSize: 72, lineHeight: 1 }}>🏆</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text }}>You're a legend!</h2>
        <p style={{ margin: 0, fontSize: 14, color: T.textMuted, maxWidth: 280, lineHeight: 1.6 }}>
          Every company on your list has a contact. Your hunt list is locked and loaded — time to start engaging.
        </p>
        <div style={{ height: 6, width: '100%', maxWidth: 280, background: T.border, borderRadius: 3 }}>
          <div style={{ height: '100%', width: '100%', background: `linear-gradient(90deg, ${BRAND.pink}, ${BRAND.cyan})`, borderRadius: 3 }} />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: T.textFaint }}>{totalActive} / {totalActive} companies ready</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Progress bar ── */}
      <div style={{ padding: '12px 22px', flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 18 }}>{motivation.emoji}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{motivation.headline}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textMuted }}>{withContacts} / {totalActive} done</span>
        </div>
        <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${BRAND.pink}, ${BRAND.cyan})`, borderRadius: 3, transition: 'width 0.5s ease' }} />
        </div>
        <p style={{ margin: '5px 0 0', fontSize: 11, color: T.textFaint }}>{motivation.sub}</p>
      </div>

      {/* ── Deck area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden', padding: '16px 22px 0' }}>

        {/* Batch dots */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {Array.from({ length: dotsVisible }).map((_, i) => (
            <div key={i} style={{
              width: i === 0 ? 20 : 7, height: 7, borderRadius: 4,
              background: i === 0 ? BRAND.pink : T.border,
              transition: 'all 0.3s',
            }} />
          ))}
          {remaining > MAX_DOTS && (
            <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 2 }}>+{remaining - MAX_DOTS}</span>
          )}
        </div>

        {/* Fixed-height card deck — same pattern as DailyLeads */}
        <div style={{ position: 'relative', width: '100%', maxWidth: 420, height: CARD_H, overflow: 'hidden', flexShrink: 0 }}>

          {/* Ghost cards (depth stack) */}
          {deck.slice(1, 3).map((_, i) => (
            <div key={i} style={{
              position: 'absolute',
              top: (i + 1) * 8, left: (i + 1) * 8, right: (i + 1) * 8,
              background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 22,
              height: CARD_H, opacity: 0.15 + (i === 0 ? 0.15 : 0), pointerEvents: 'none',
            }} />
          ))}

          {/* Main swipeable card — centered like DailyLeads */}
          <div
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onRelease}
            onMouseLeave={onRelease}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onRelease}
            style={{
              position: 'absolute', width: '100%', maxWidth: 420,
              transform: `translateX(calc(-50% + ${flyX}px)) translateY(${dragOffset.y * 0.1}px) rotate(${flyRot}deg)`,
              transition: gone || Math.abs(dragOffset.x) < 5 ? 'all 0.28s ease' : 'none',
              opacity: flyOp, cursor: gone ? 'default' : isDragging ? 'grabbing' : 'grab',
              userSelect: 'none', touchAction: 'pan-y', top: 0, left: '50%',
              pointerEvents: gone ? 'none' : 'auto',
            }}
          >
            {/* Swipe overlays — DailyLeads border style */}
            {dragOffset.x > 30 && (
              <div style={{
                position: 'absolute', top: 22, left: 16, zIndex: 10,
                padding: '5px 13px', borderRadius: 8,
                border: `3px solid ${STATUS.green}`, color: STATUS.green,
                fontSize: 13, fontWeight: 700, transform: 'rotate(-11deg)',
                background: `${STATUS.green}10`, opacity: Math.min((dragOffset.x - 30) / 70, 1),
              }}>✓ FIND CONTACT</div>
            )}
            {dragOffset.x < -30 && (
              <div style={{
                position: 'absolute', top: 22, right: 16, zIndex: 10,
                padding: '5px 13px', borderRadius: 8,
                border: `3px solid ${STATUS.red}`, color: STATUS.red,
                fontSize: 13, fontWeight: 700, transform: 'rotate(11deg)',
                background: `${STATUS.red}10`, opacity: Math.min((Math.abs(dragOffset.x) - 30) / 70, 1),
              }}>✗ SKIP</div>
            )}

            {/* Card shell */}
            <div style={{
              position: 'relative',
              background: T.cardBg, border: `1px solid ${T.border2 || T.border}`,
              borderRadius: 22, overflow: 'hidden',
              boxShadow: `0 28px 70px ${T.isDark ? '#00000099' : '#00000018'}`,
            }}>
              {/* Full-card swipe color wash */}
              {dragOffset.x > 10 && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 5, borderRadius: 22, background: `${STATUS.green}${Math.round(overlayOpacity * 20).toString(16).padStart(2, '0')}`, pointerEvents: 'none' }} />
              )}
              {dragOffset.x < -10 && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 5, borderRadius: 22, background: `${STATUS.red}${Math.round(overlayOpacity * 20).toString(16).padStart(2, '0')}`, pointerEvents: 'none' }} />
              )}

              {/* Header — centered logo + name + industry */}
              <div style={{
                padding: '18px 22px 12px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', background: T.cardBg2 || T.surface, borderBottom: `1px solid ${T.border}`,
              }}>
                <div style={{
                  width: 60, height: 60, borderRadius: 16, background: T.surface,
                  border: `1px solid ${T.border2 || T.border}`, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', marginBottom: 10, overflow: 'hidden',
                }}>
                  <CompanyLogo company={current} size="large" />
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text, textAlign: 'center' }}>{current.name}</div>
                <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3, letterSpacing: 1.5 }}>
                  {(current.industry || '').toUpperCase()}
                </div>
              </div>

              {/* Stats grid — bordered cells like DailyLeads */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${T.border}` }}>
                {[
                  ['EMPLOYEES', current.employee_count || current.company_size || 'N/A'],
                  ['FOUNDED',   current.founded_year || 'N/A'],
                  ['REVENUE',   current.revenue || 'N/A'],
                  ['HQ',        hqLocation || '—'],
                ].map(([l, v]) => (
                  <div key={l} style={{ padding: '8px 14px', borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Fit score row (when available) */}
              {score > 0 && (
                <div style={{ padding: '8px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: T.textFaint, marginBottom: 2 }}>FIT SCORE</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: sc }}>{score}</span>
                      <span style={{ fontSize: 10, color: T.textFaint }}>/100</span>
                      <span style={{ fontSize: 9, color: sc, fontWeight: 700, padding: '2px 7px', background: `${sc}15`, borderRadius: 5, border: `1px solid ${sc}40` }}>{scoreLabel}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Barry Intel */}
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.border}`, background: T.accentBg || `${BRAND.pink}08` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <BarryAvatar size={16} />
                  <span style={{ fontSize: 9, letterSpacing: 2, color: BRAND.pink, fontWeight: 700 }}>BARRY INTEL</span>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: T.isDark ? '#d0a0c0' : T.textMuted, lineHeight: 1.6 }}>
                  {barryText}
                </p>
              </div>

              {/* Website / LinkedIn — gradient filled like DailyLeads */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '9px 12px', borderBottom: `1px solid ${T.border}` }}>
                <button
                  onClick={e => { e.stopPropagation(); if (current.website_url) window.open(current.website_url, '_blank'); }}
                  style={{ padding: 7, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#7c5ce4,#6c4fd6)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Globe size={12} />Website</button>
                <button
                  onClick={e => { e.stopPropagation(); if (current.linkedin_url) window.open(current.linkedin_url, '_blank'); }}
                  style={{ padding: 7, borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#0077b5,#005e94)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                ><Linkedin size={12} />LinkedIn</button>
              </div>

              {/* Decision buttons — "Skip" red outline · "Find a Contact" pink filled */}
              <div style={{ display: 'flex', gap: 8, padding: '10px 12px 12px' }}>
                <button
                  onClick={e => { e.stopPropagation(); handleSkip(); }}
                  style={{ flex: 1, padding: 10, borderRadius: 11, border: `1.5px solid ${STATUS.red}40`, background: `${STATUS.red}0c`, color: STATUS.red, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >✗ Skip</button>
                <button
                  onClick={e => { e.stopPropagation(); handleFindContact(); }}
                  style={{ flex: 2, padding: 10, borderRadius: 11, border: 'none', background: `linear-gradient(135deg, ${BRAND.pink}, #c0146a)`, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: `0 4px 16px ${BRAND.pink}45` }}
                >✓ Find a Contact</button>
              </div>
            </div>
          </div>
        </div>

        {/* Keyboard hint */}
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 10, color: T.textFaint, textAlign: 'center', flexShrink: 0 }}>
          Swipe or press&nbsp;
          <kbd style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', fontSize: 9 }}>←</kbd> skip &nbsp;·&nbsp;
          <kbd style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', fontSize: 9 }}>→</kbd> find &nbsp;·&nbsp;
          <kbd style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', fontSize: 9 }}>U</kbd> undo
        </p>

      </div>

      {/* ── Undo bar (only when a company was skipped) ── */}
      {lastSkipped && (
        <div style={{ padding: '8px 22px', borderTop: `1px solid ${T.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: T.textFaint }}>Skipped {lastSkipped.name}</span>
          <button
            onClick={handleUndo}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted, fontSize: 11, cursor: 'pointer' }}
          >↩ Undo</button>
        </div>
      )}

    </div>
  );
}

// ─── Company Card (v5 style) ──────────────────────────────────────────────────
function CompanyCardV5({ company, isArchived, T, onClick, onFindContacts, onArchive, onRestore }) {
  return (
    <div
      style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 13, overflow: 'hidden', transition: 'all 0.15s', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderHov; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.transform = 'none'; }}
      onClick={onClick}
    >
      <div style={{ padding: '14px 14px 11px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: T.surface, border: `1px solid ${T.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, overflow: 'hidden', flexShrink: 0 }}>
            <CompanyLogo company={company} size="default" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company.name}</div>
            <div style={{ fontSize: 10, color: T.textMuted }}>{company.industry}</div>
          </div>
          {company.contact_count > 0 && (
            <div style={{ fontSize: 9, background: `${STATUS.green}18`, color: STATUS.green, borderRadius: 7, padding: '2px 7px', border: `1px solid ${STATUS.green}30`, flexShrink: 0 }}>
              {company.contact_count} contact{company.contact_count !== 1 ? 's' : ''}
            </div>
          )}
          {isArchived && (
            <div style={{ fontSize: 9, background: T.surface, color: T.textFaint, borderRadius: 7, padding: '2px 7px', border: `1px solid ${T.border}`, flexShrink: 0 }}>
              Archived
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {[
            ['EMPLOYEES', company.employee_count || company.company_size || 'N/A'],
            ['FOUNDED', company.founded_year || 'N/A'],
            ['INDUSTRY', company.industry || 'N/A'],
            ['LOCATION', company.location || company.city || 'N/A'],
          ].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 8, letterSpacing: 1, color: T.textFaint }}>{l}</div>
              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '9px 12px' }}>
        <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
          <button
            onClick={e => { e.stopPropagation(); if (company.website_url) window.open(company.website_url, '_blank'); }}
            style={{ flex: 1, padding: 4, borderRadius: 6, border: `1px solid #7c5ce430`, background: '#7c5ce410', color: '#b388ff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          ><Globe size={11} />Visit</button>
          <button
            onClick={e => { e.stopPropagation(); if (company.linkedin_url) window.open(company.linkedin_url, '_blank'); }}
            style={{ flex: 1, padding: 4, borderRadius: 6, border: `1px solid #0077b530`, background: '#0077b510', color: '#3b82f6', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          ><Linkedin size={11} />LinkedIn</button>
          {!isArchived && (
            <button
              onClick={e => { e.stopPropagation(); onArchive(); }}
              title="Archive company"
              style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            ><Archive size={11} /></button>
          )}
          {isArchived && (
            <button
              onClick={e => { e.stopPropagation(); onRestore(); }}
              title="Restore company"
              style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            ><RotateCcw size={11} /></button>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); (onFindContacts || onClick)(); }}
          style={{ width: '100%', padding: 7, borderRadius: 7, border: 'none', background: company.contact_count > 0 ? T.cyanBg : `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: company.contact_count > 0 ? T.cyan : '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', borderColor: company.contact_count > 0 ? T.cyanBdr : 'none' }}
        >
          {company.contact_count > 0 ? 'View Contacts →' : 'Find Contacts →'}
        </button>
      </div>
    </div>
  );
}
