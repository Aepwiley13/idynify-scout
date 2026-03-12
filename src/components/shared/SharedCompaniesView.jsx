/**
 * SharedCompaniesView.jsx — Consistent company card grid used across all modules.
 *
 * mode: 'scout'  → companies with status='accepted' (Scout saved companies)
 *       'hunter' → companies with at least one Hunter-engaged contact
 *       'sniper' → companies with at least one contact in sniper_contacts
 *       'all'    → every company, with source tabs (Command Center)
 *
 * The card design mirrors the SavedCompanies (CompanyCardV5) layout:
 *   Logo · Name · Industry · [badge]
 *   EMPLOYEES / FOUNDED / INDUSTRY / LOCATION grid
 *   Visit · LinkedIn buttons + Archive/Restore
 *   View Contacts → / Find Contacts → CTA
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Building2, Users, Globe, Search, RotateCcw } from 'lucide-react';
import { Archive, Linkedin } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import CompanyLogo from '../scout/CompanyLogo';
import CompanyDetailModal from '../scout/CompanyDetailModal';
import { getEffectiveUser } from '../../context/ImpersonationContext';

// ─── Source badge config ──────────────────────────────────────────────────────
const SOURCE_CFG = {
  scout:  { bg: '#e879f918', color: '#e879f9', border: '#e879f935', label: 'SCOUT' },
  hunter: { bg: '#7c3aed18', color: '#a78bfa', border: '#7c3aed35', label: 'HUNTER' },
  sniper: { bg: '#14b8a618', color: '#2dd4bf', border: '#14b8a635', label: 'SNIPER' },
};

// ─── SharedCompanyCard ────────────────────────────────────────────────────────
function SharedCompanyCard({
  company, T, onClick, onFindContacts, onArchive, onRestore,
  isArchived = false, sourceBadge = null,
}) {
  const contactCount = company.contact_count ?? company.contactCount ?? 0;
  const src = sourceBadge ? SOURCE_CFG[sourceBadge] : null;

  const employees = company.apolloEnrichment?.snapshot?.estimated_num_employees
    || company.employee_count || company.company_size || 'N/A';
  const founded = company.apolloEnrichment?.snapshot?.founded_year
    || company.founded_year || 'N/A';
  const industry = company.apolloEnrichment?.snapshot?.industry
    || company.industry || 'N/A';
  const location = company.apolloEnrichment?.snapshot?.location?.full
    || company.location || company.city
    || (company.headquarters_city ? `${company.headquarters_city}${company.headquarters_state ? ', ' + company.headquarters_state : ''}` : null)
    || 'N/A';

  return (
    <div
      style={{
        background: T.cardBg, border: `1px solid ${T.border}`,
        borderRadius: 13, overflow: 'hidden', transition: 'all 0.15s', cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderHov; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.transform = 'none'; }}
      onClick={onClick}
    >
      {/* ── Top section: logo + name + badges ── */}
      <div style={{ padding: '14px 14px 11px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: T.surface, border: `1px solid ${T.border2}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, overflow: 'hidden', flexShrink: 0,
          }}>
            <CompanyLogo company={company} size="default" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {company.name || 'Unnamed Company'}
            </div>
            <div style={{ fontSize: 10, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {company.apolloEnrichment?.snapshot?.industry || company.industry || 'Unknown'}
            </div>
          </div>
          {/* Contact count badge */}
          {contactCount > 0 && (
            <div style={{
              fontSize: 9, background: `${STATUS.green}18`, color: STATUS.green,
              borderRadius: 7, padding: '2px 7px', border: `1px solid ${STATUS.green}30`, flexShrink: 0,
            }}>
              {contactCount} contact{contactCount !== 1 ? 's' : ''}
            </div>
          )}
          {/* Source badge (Command Center only) */}
          {src && (
            <div style={{
              fontSize: 8, fontWeight: 700, background: src.bg, color: src.color,
              borderRadius: 7, padding: '2px 7px', border: `1px solid ${src.border}`, flexShrink: 0,
            }}>
              {src.label}
            </div>
          )}
          {isArchived && (
            <div style={{ fontSize: 9, background: T.surface, color: T.textFaint, borderRadius: 7, padding: '2px 7px', border: `1px solid ${T.border}`, flexShrink: 0 }}>
              Archived
            </div>
          )}
        </div>

        {/* 2×2 stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {[
            ['EMPLOYEES', employees],
            ['FOUNDED',   founded],
            ['INDUSTRY',  industry],
            ['LOCATION',  location],
          ].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 8, letterSpacing: 1, color: T.textFaint }}>{l}</div>
              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom section: action buttons ── */}
      <div style={{ padding: '9px 12px' }}>
        <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
          <button
            onClick={e => { e.stopPropagation(); if (company.website_url || company.website) window.open((company.website_url || company.website).startsWith('http') ? (company.website_url || company.website) : `https://${company.website_url || company.website}`, '_blank'); }}
            style={{ flex: 1, padding: 4, borderRadius: 6, border: '1px solid #7c5ce430', background: '#7c5ce410', color: '#b388ff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          ><Globe size={11} />Visit</button>
          <button
            onClick={e => { e.stopPropagation(); if (company.linkedin_url) window.open(company.linkedin_url, '_blank'); }}
            style={{ flex: 1, padding: 4, borderRadius: 6, border: '1px solid #0077b530', background: '#0077b510', color: '#3b82f6', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          ><Linkedin size={11} />LinkedIn</button>
          {!isArchived && onArchive && (
            <button
              onClick={e => { e.stopPropagation(); onArchive(); }}
              title="Archive company"
              style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            ><Archive size={11} /></button>
          )}
          {isArchived && onRestore && (
            <button
              onClick={e => { e.stopPropagation(); onRestore(); }}
              title="Restore company"
              style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            ><RotateCcw size={11} /></button>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); (onFindContacts || onClick)(); }}
          style={{
            width: '100%', padding: 7, borderRadius: 7, border: 'none',
            background: contactCount > 0 ? T.cyanBg : `linear-gradient(135deg,${BRAND.pink},#c0146a)`,
            color: contactCount > 0 ? T.cyan : '#fff',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {contactCount > 0 ? 'View Contacts →' : 'Find Contacts →'}
        </button>
      </div>
    </div>
  );
}

// ─── Data loader helpers ──────────────────────────────────────────────────────

const HUNTER_ENGAGED = new Set([
  'active_mission', 'awaiting_reply', 'engaged_pending', 'in_conversation',
]);
const HUNTER_ENGAGED_CONTACT = new Set([
  'Engaged', 'Awaiting Reply', 'In Conversation', 'In Campaign', 'Active Mission',
]);

async function loadCompanies(mode, uid) {
  // Parallel fetches — always need companies + contacts
  const fetches = [
    getDocs(query(collection(db, 'users', uid, 'companies'), where('status', '==', 'accepted'))),
    getDocs(collection(db, 'users', uid, 'contacts')),
  ];
  if (mode === 'sniper' || mode === 'all') {
    fetches.push(getDocs(collection(db, 'users', uid, 'sniper_contacts')));
  }
  // For 'all' mode also load archived companies
  if (mode === 'all') {
    fetches.push(getDocs(query(collection(db, 'users', uid, 'companies'), where('status', '==', 'archived'))));
  }

  const [acceptedSnap, contactsSnap, ...rest] = await Promise.all(fetches);

  // Build contact count map
  const contactCountMap = {};
  contactsSnap.docs.forEach(d => {
    const cid = d.data().company_id;
    if (cid) contactCountMap[cid] = (contactCountMap[cid] || 0) + 1;
  });

  // Hunter: identify company IDs with engaged contacts
  const hunterCompanyIds = new Set();
  contactsSnap.docs.forEach(d => {
    const data = d.data();
    if (HUNTER_ENGAGED.has(data.hunter_status) || HUNTER_ENGAGED_CONTACT.has(data.contact_status)) {
      if (data.company_id) hunterCompanyIds.add(data.company_id);
    }
  });

  // Sniper: identify company IDs via sniper_contacts
  const sniperCompanyIds = new Set();
  if (mode === 'sniper' || mode === 'all') {
    const sniperSnap = rest[0];
    sniperSnap?.docs.forEach(d => {
      const data = d.data();
      // sniper_contacts stores company name; try to match via contactRef → contacts → company_id
      // Also check direct company field
      if (data.company_id) sniperCompanyIds.add(data.company_id);
      if (data.company) {
        // Store lowercase name for name-based matching
        sniperCompanyIds.add('name:' + data.company.toLowerCase());
      }
    });
    // Resolve name-based sniper IDs to real company IDs
    contactsSnap.docs.forEach(d => {
      const data = d.data();
      const sniperEntry = data.company_id && sniperCompanyIds.has(data.company_id);
      if (!sniperEntry && data.company_name) {
        const nameKey = 'name:' + data.company_name.toLowerCase();
        if (sniperCompanyIds.has(nameKey) && data.company_id) {
          sniperCompanyIds.add(data.company_id);
        }
      }
    });
  }

  function classifySource(companyId, companyName) {
    if (sniperCompanyIds.has(companyId) || sniperCompanyIds.has('name:' + (companyName || '').toLowerCase())) return 'sniper';
    if (hunterCompanyIds.has(companyId)) return 'hunter';
    return 'scout';
  }

  const acceptedList = acceptedSnap.docs.map(d => {
    const data = { id: d.id, ...d.data() };
    const contactCount = contactCountMap[d.id] || 0;
    const source = classifySource(d.id, data.name);
    return { ...data, contact_count: contactCount, contactCount, source };
  });

  // 'all' mode: also include archived companies
  let archivedList = [];
  if (mode === 'all') {
    const archivedSnap = rest[rest.length - 1];
    archivedList = archivedSnap?.docs.map(d => {
      const data = { id: d.id, ...d.data() };
      const contactCount = contactCountMap[d.id] || 0;
      const source = classifySource(d.id, data.name);
      return { ...data, contact_count: contactCount, contactCount, source };
    }) || [];
  }

  // Filter based on mode
  let filtered = acceptedList;
  if (mode === 'hunter') {
    filtered = acceptedList.filter(c => hunterCompanyIds.has(c.id));
  } else if (mode === 'sniper') {
    filtered = acceptedList.filter(c =>
      sniperCompanyIds.has(c.id) || sniperCompanyIds.has('name:' + (c.name || '').toLowerCase())
    );
  }

  // Sort: companies with contacts first, then by name
  const sortFn = (a, b) => {
    if (b.contact_count !== a.contact_count) return b.contact_count - a.contact_count;
    return (a.name || '').localeCompare(b.name || '');
  };

  return {
    companies: filtered.sort(sortFn),
    archivedCompanies: archivedList.sort(sortFn),
  };
}

// ─── SharedCompaniesView ──────────────────────────────────────────────────────
export default function SharedCompaniesView({ mode = 'scout' }) {
  const T = useT();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState([]);
  const [archivedCompanies, setArchivedCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'archived' — Scout/Hunter/Sniper
  const [sourceFilter, setSourceFilter] = useState('all'); // Command Center tabs: 'all' | 'scout' | 'hunter' | 'sniper'
  const [detailCompany, setDetailCompany] = useState(null);

  const isCommandCenter = mode === 'all';

  useEffect(() => {
    async function load() {
      const user = getEffectiveUser();
      if (!user) { navigate('/login'); return; }
      try {
        const result = await loadCompanies(mode, user.uid);
        setCompanies(result.companies);
        setArchivedCompanies(result.archivedCompanies);
      } catch (err) {
        console.error('[SharedCompaniesView] load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Archive / restore (Scout & Command Center modes)
  async function handleArchive(company) {
    const user = getEffectiveUser();
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'companies', company.id), {
        status: 'archived', archived_at: new Date().toISOString(),
        activity_log: arrayUnion({ type: 'status_changed', from: 'accepted', to: 'archived', timestamp: new Date().toISOString() }),
      });
      setCompanies(prev => prev.filter(c => c.id !== company.id));
      setArchivedCompanies(prev => [{ ...company, status: 'archived' }, ...prev]);
    } catch (err) { console.error('[SharedCompaniesView] archive error:', err); }
  }

  async function handleRestore(company) {
    const user = getEffectiveUser();
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'companies', company.id), {
        status: 'accepted', archived_at: null,
        activity_log: arrayUnion({ type: 'status_changed', from: 'archived', to: 'accepted', timestamp: new Date().toISOString() }),
      });
      setArchivedCompanies(prev => prev.filter(c => c.id !== company.id));
      setCompanies(prev => [{ ...company, status: 'accepted' }, ...prev]);
    } catch (err) { console.error('[SharedCompaniesView] restore error:', err); }
  }

  function handleCardClick(company) {
    setDetailCompany(company);
  }

  function handleFindContacts(company) {
    if (company.contact_count > 0) {
      navigate(`/scout/company/${company.id}/leads`);
    } else {
      navigate(`/scout/company/${company.id}`);
    }
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const sourceList = !isCommandCenter
    ? (activeTab === 'active' ? companies : archivedCompanies)
    : companies; // Command Center only shows active, use sourceFilter tabs instead

  const displayList = sourceList.filter(co => {
    if (isCommandCenter && sourceFilter !== 'all' && co.source !== sourceFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (co.name || '').toLowerCase().includes(q) || (co.industry || '').toLowerCase().includes(q);
    }
    return true;
  });

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalContacts = companies.reduce((s, c) => s + (c.contact_count || 0), 0);
  const withContacts = companies.filter(c => (c.contact_count || 0) > 0).length;
  const completionRate = companies.length > 0 ? Math.round((withContacts / companies.length) * 100) : 0;

  // Command Center source counts
  const scoutCount  = companies.filter(c => c.source === 'scout').length;
  const hunterCount = companies.filter(c => c.source === 'hunter').length;
  const sniperCount = companies.filter(c => c.source === 'sniper').length;

  const headings = {
    scout:  'Saved Companies',
    hunter: 'Companies',
    sniper: 'Companies',
    all:    'All Companies',
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: T.textMuted }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${BRAND.pink}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: 13, margin: 0 }}>Loading companies…</p>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (companies.length === 0 && archivedCompanies.length === 0) {
    const emptyMsg = {
      scout:  { title: 'No Saved Companies Yet', body: 'Accept companies in Daily Leads to start building your hunt list.', cta: () => navigate('/scout', { state: { activeTab: 'daily-leads' } }), ctaLabel: 'Start Matching' },
      hunter: { title: 'No Hunter Companies Yet', body: 'Engage contacts in Scout to start tracking company-level activity here.', cta: () => navigate('/scout'), ctaLabel: 'Go to Scout' },
      sniper: { title: 'No Sniper Companies Yet', body: 'Add warm contacts to your Sniper pipeline to see their companies here.', cta: () => navigate('/sniper'), ctaLabel: 'Go to Pipeline' },
      all:    { title: 'No Companies Yet', body: 'Accept companies in Daily Leads to start building your pipeline.', cta: () => navigate('/scout', { state: { activeTab: 'daily-leads' } }), ctaLabel: 'Start Matching' },
    }[mode];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16, color: T.textMuted }}>
        <Building2 size={48} color={T.textFaint} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>{emptyMsg.title}</h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, textAlign: 'center' }}>{emptyMsg.body}</p>
        <button
          onClick={emptyMsg.cta}
          style={{ padding: '10px 22px', borderRadius: 10, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        ><Users size={14} />{emptyMsg.ctaLabel}</button>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>

      {/* ── Header ── */}
      <div style={{ padding: '18px 22px 0', borderBottom: `1px solid ${T.border}`, background: T.navBg, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>
            {headings[mode]}
          </h2>
          {/* View toggle — cards / list (reserved for future) */}
          <div style={{ display: 'flex', gap: 4, background: T.surface, borderRadius: 8, padding: 3 }}>
            <button
              style={{ padding: '5px 13px', borderRadius: 6, border: 'none', background: BRAND.pink, color: '#fff', fontSize: 13, cursor: 'pointer' }}
              title="Cards"
            >⊞</button>
            <button
              style={{ padding: '5px 13px', borderRadius: 6, border: 'none', background: 'transparent', color: T.textMuted, fontSize: 13, cursor: 'pointer' }}
              title="List"
            >☰</button>
          </div>
        </div>

        {/* Stats KPIs */}
        {isCommandCenter ? (
          // Command Center: Total / Total Contacts / Scout / Hunter / Sniper
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: 10, marginBottom: 14 }}>
            {[
              ['Total Companies', companies.length, false],
              ['Total Contacts',  totalContacts,     false],
              ['Scout',           scoutCount,         false],
              ['Hunter',          hunterCount,        false],
              ['Sniper',          sniperCount,        false],
            ].map(([label, value]) => (
              <div key={label} style={{ background: T.statBg, border: `1px solid ${T.border}`, borderRadius: 9, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{value}</div>
              </div>
            ))}
          </div>
        ) : (
          // Scout / Hunter / Sniper: classic 4-KPI grid
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
            {[
              ['Total Companies', companies.length,   false],
              ['Total Contacts',  totalContacts,       false],
              ['With Contacts',   withContacts,        false],
              ['Completion Rate', `${completionRate}%`, true],
            ].map(([label, value, highlight]) => (
              <div key={label} style={{ background: highlight ? T.cyanBg : T.statBg, border: `1px solid ${highlight ? T.cyanBdr : T.border}`, borderRadius: 9, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? T.cyan : T.text }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        {isCommandCenter ? (
          // Command Center: All / Scout / Hunter / Sniper source tabs
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              ['all',    `All Companies ${companies.length}`],
              ['scout',  `Scout ${scoutCount}`],
              ['hunter', `Hunter ${hunterCount}`],
              ['sniper', `Sniper ${sniperCount}`],
            ].map(([id, label]) => (
              <div
                key={id}
                onClick={() => setSourceFilter(id)}
                style={{ padding: '7px 16px', fontSize: 12, cursor: 'pointer', borderBottom: `2px solid ${sourceFilter === id ? BRAND.pink : 'transparent'}`, color: sourceFilter === id ? BRAND.pink : T.textMuted }}
              >{label}</div>
            ))}
          </div>
        ) : (
          // Scout / Hunter / Sniper: Active / Archived tabs
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

      {/* ── Search ── */}
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

      {/* ── Card grid ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
        {displayList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: T.textFaint }}>
            <p style={{ fontSize: 13 }}>
              {searchTerm ? 'No companies match your search.' : activeTab === 'archived' ? 'No archived companies.' : 'No companies to show.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(258px,1fr))', gap: 12 }}>
            {displayList.map(company => (
              <SharedCompanyCard
                key={company.id}
                company={company}
                T={T}
                isArchived={activeTab === 'archived'}
                sourceBadge={isCommandCenter ? company.source : null}
                onClick={() => handleCardClick(company)}
                onFindContacts={() => handleFindContacts(company)}
                onArchive={!isCommandCenter ? () => handleArchive(company) : undefined}
                onRestore={!isCommandCenter ? () => handleRestore(company) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Company Detail Modal ── */}
      {detailCompany && (
        <CompanyDetailModal
          company={detailCompany}
          onClose={() => setDetailCompany(null)}
          onFindMoreContacts={id => {
            setDetailCompany(null);
            const co = [...companies, ...archivedCompanies].find(x => x.id === id);
            if (co && co.contact_count > 0) navigate(`/scout/company/${id}/leads`);
            else navigate(`/scout/company/${id}`);
          }}
        />
      )}
    </div>
  );
}
