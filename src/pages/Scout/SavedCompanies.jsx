/**
 * SavedCompanies.jsx — Saved/matched company list with stats header, cards/list toggle.
 *
 * UI: idynify-v5 design with theme tokens.
 * Data: Firebase Firestore (all original data wiring preserved).
 */
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Search, Globe, Linkedin, Target, Archive, RotateCcw, TrendingUp } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import TitleSelectionModal from '../../components/TitleSelectionModal';
import CompanyLogo from '../../components/scout/CompanyLogo';

// ─── SavedCompanies ───────────────────────────────────────────────────────────
export default function SavedCompanies() {
  const T = useT();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState([]);
  const [archivedCompanies, setArchivedCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'list'
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'archived'
  const [searchTerm, setSearchTerm] = useState('');
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);

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
    if (company.contact_count > 0) {
      navigate(`/scout/company/${company.id}/leads`);
    } else {
      setSelectedCompany(company);
      const hasTitles = company.selected_titles?.length > 0;
      if (hasTitles) navigate(`/scout/company/${company.id}`);
      else setShowTitleModal(true);
    }
  }

  function handleTitlesSelected() {
    setShowTitleModal(false);
    if (selectedCompany) navigate(`/scout/company/${selectedCompany.id}`);
  }

  // KPIs
  const totalContacts = companies.reduce((sum, c) => sum + (c.contact_count || 0), 0);
  const companiesWithContacts = companies.filter(c => c.contact_count > 0).length;
  const completionRate = companies.length > 0 ? Math.round((companiesWithContacts / companies.length) * 100) : 0;

  // Filtered list
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
      <div style={{ padding: '18px 22px 0', borderBottom: `1px solid ${T.border}`, background: T.navBg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>Saved Companies</h2>
          {/* View toggle */}
          <div style={{ display: 'flex', gap: 4, background: T.surface, borderRadius: 8, padding: 3 }}>
            {[['cards', '⊞'], ['list', '☰']].map(([m, l]) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                style={{ padding: '5px 13px', borderRadius: 6, border: 'none', background: viewMode === m ? BRAND.pink : 'transparent', color: viewMode === m ? '#fff' : T.textMuted, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s' }}
              >{l}</button>
            ))}
          </div>
        </div>

        {/* Stats header */}
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

        {/* Active / Archived tabs */}
        <div style={{ display: 'flex', gap: 0 }}>
          {[['active', `Active (${companies.length})`], ['archived', `Archived (${archivedCompanies.length})`]].map(([id, label]) => (
            <div
              key={id}
              onClick={() => { setActiveTab(id); setSearchTerm(''); }}
              style={{ padding: '7px 16px', fontSize: 12, cursor: 'pointer', borderBottom: `2px solid ${activeTab === id ? BRAND.pink : 'transparent'}`, color: activeTab === id ? BRAND.pink : T.textMuted }}
            >{label}</div>
          ))}
        </div>
      </div>

      {/* ── Search ── */}
      <div style={{ padding: '11px 22px', borderBottom: `1px solid ${T.border}` }}>
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

      {/* ── Content ── */}
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
                    onClick={e => { e.stopPropagation(); }}
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

      {showTitleModal && selectedCompany && (
        <TitleSelectionModal
          company={selectedCompany}
          onComplete={handleTitlesSelected}
          onClose={() => setShowTitleModal(false)}
        />
      )}
    </div>
  );
}

// ─── Company Card (v5 style) ──────────────────────────────────────────────────
function CompanyCardV5({ company, isArchived, T, onClick, onArchive, onRestore }) {
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
          onClick={e => { e.stopPropagation(); onClick(); }}
          style={{ width: '100%', padding: 7, borderRadius: 7, border: 'none', background: company.contact_count > 0 ? T.cyanBg : `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: company.contact_count > 0 ? T.cyan : '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', borderColor: company.contact_count > 0 ? T.cyanBdr : 'none' }}
        >
          {company.contact_count > 0 ? 'View Contacts →' : 'Find Contacts →'}
        </button>
      </div>
    </div>
  );
}
