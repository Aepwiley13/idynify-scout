/**
 * CompanyProfileView.jsx — Inline company profile drill-down inside ScoutMain.
 *
 * Renders inside the ScoutMain shell (no separate page/layout).
 * Shows company info, decision makers, saved contacts, and title-based contact search.
 */
import { useEffect, useState } from 'react';
import {
  collection, query, where, getDocs, doc, getDoc,
  setDoc, updateDoc, arrayUnion,
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, Users, Globe, Linkedin, MapPin, Calendar,
  DollarSign, Briefcase, Target, Search, X, UserPlus, CheckCircle,
  Award, Archive, RotateCcw, RefreshCw, ChevronDown, ChevronUp,
  FileText, Tag, Phone, ExternalLink, Loader,
} from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import CompanyLogo from '../../components/scout/CompanyLogo';

export default function CompanyProfileView({ companyId, onBack }) {
  const T = useT();
  const navigate = useNavigate();

  // ── Company state ──────────────────────────────────────────────────────────
  const [company, setCompany] = useState(null);
  const [enrichedData, setEnrichedData] = useState(null);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [enriching, setEnriching] = useState(false);

  // ── Contacts state ─────────────────────────────────────────────────────────
  const [approvedContacts, setApprovedContacts] = useState([]);
  const [suggestedContacts, setSuggestedContacts] = useState([]);

  // ── Title search state ─────────────────────────────────────────────────────
  const [selectedTitles, setSelectedTitles] = useState([]);
  const [customTitleInput, setCustomTitleInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());
  const [approvingContactIds, setApprovingContactIds] = useState(new Set());
  const [savingBulk, setSavingBulk] = useState(false);

  // ── Decision makers state ──────────────────────────────────────────────────
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState([]);
  const [savingDMs, setSavingDMs] = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showOverview, setShowOverview] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    loadCompany();
    loadContacts();
  }, [companyId]);

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadCompany() {
    setLoadingCompany(true);
    try {
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }
      const companyDoc = await getDoc(doc(db, 'users', user.uid, 'companies', companyId));
      if (!companyDoc.exists()) { onBack(); return; }
      const data = { id: companyDoc.id, ...companyDoc.data() };
      setCompany(data);
      setSelectedTitles(data.selected_titles || []);
      if (data.apolloEnrichment) {
        setEnrichedData(data.apolloEnrichment);
      } else {
        enrichCompany(data, false);
      }
    } catch (err) {
      console.error('Failed to load company:', err);
    } finally {
      setLoadingCompany(false);
    }
  }

  async function loadContacts() {
    try {
      const userId = auth.currentUser.uid;
      const snap = await getDocs(
        query(collection(db, 'users', userId, 'contacts'), where('company_id', '==', companyId))
      );
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setApprovedContacts(all.filter(c => c.status !== 'suggested'));
      setSuggestedContacts(all.filter(c => c.status === 'suggested'));
    } catch (err) {
      console.error('Failed to load contacts:', err);
    }
  }

  async function enrichCompany(companyData, forceRefresh = false) {
    setEnriching(true);
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Check cache (14 days) unless force-refreshing
      if (!forceRefresh && companyData.apolloEnrichment && companyData.apolloEnrichedAt &&
        Date.now() - companyData.apolloEnrichedAt < 14 * 24 * 60 * 60 * 1000) {
        setEnrichedData(companyData.apolloEnrichment);
        return;
      }

      const authToken = await user.getIdToken();
      const domain = companyData.domain || extractDomain(companyData.website_url);

      const res = await fetch('/.netlify/functions/enrichCompany', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid, authToken,
          domain,
          organizationId: companyData.apollo_id || null,
        }),
      });
      const result = await res.json();
      if (result.success) {
        await updateDoc(doc(db, 'users', user.uid, 'companies', companyId), {
          apolloEnrichment: result.data,
          apolloEnrichedAt: Date.now(),
          apollo_id: result.data._raw?.apolloOrgId || null,
        });
        setEnrichedData(result.data);
      }
    } catch (err) {
      console.error('Enrichment failed:', err);
    } finally {
      setEnriching(false);
    }
  }

  // ── Title search ───────────────────────────────────────────────────────────
  async function searchContacts(titles) {
    if (!titles.length || !company) return;
    setSearchingContacts(true);
    setSearchResults([]);
    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/searchPeople', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid, authToken,
          organizationId: company.apollo_organization_id,
          titles: titles.map(t => t.title),
        }),
      });
      const data = await res.json();
      if (data.success) setSearchResults(data.people || []);
    } catch (err) {
      console.error('Contact search failed:', err);
    } finally {
      setSearchingContacts(false);
    }
  }

  function addTitle(e) {
    e.preventDefault();
    const title = customTitleInput.trim();
    if (!title) return;
    if (selectedTitles.some(t => t.title.toLowerCase() === title.toLowerCase())) return;
    const newTitle = { title, rank: selectedTitles.length + 1, score: 100, custom: true };
    const updated = [...selectedTitles, newTitle];
    setSelectedTitles(updated);
    setCustomTitleInput('');
    searchContacts(updated);
  }

  function removeTitle(title) {
    const updated = selectedTitles.filter(t => t.title !== title);
    setSelectedTitles(updated);
    if (updated.length > 0) searchContacts(updated);
    else setSearchResults([]);
  }

  // ── Contact approval ───────────────────────────────────────────────────────
  async function approveContact(contact) {
    if (approvedContacts.some(c => c.apollo_person_id === contact.id)) return;
    setApprovingContactIds(prev => new Set(prev).add(contact.id));
    try {
      const user = auth.currentUser;
      const contactDocId = `${companyId}_${contact.id}`;
      await setDoc(doc(db, 'users', user.uid, 'contacts', contactDocId), {
        apollo_person_id: contact.id,
        name: contact.name || 'Unknown', title: contact.title || '',
        email: contact.email || null, phone: contact.phone_numbers?.[0] || null,
        linkedin_url: contact.linkedin_url || null,
        company_id: companyId, company_name: company.name,
        company_industry: company.industry || null,
        lead_owner: user.uid,
        status: 'pending_enrichment',
        saved_at: new Date().toISOString(), source: 'apollo_people_search',
      });
      await enrichContact(user.uid, contact.id);
      await loadContacts();
    } catch (err) {
      console.error('Failed to approve contact:', err);
    } finally {
      setApprovingContactIds(prev => { const s = new Set(prev); s.delete(contact.id); return s; });
    }
  }

  async function bulkApprove() {
    if (!selectedContactIds.size) return;
    setSavingBulk(true);
    try {
      const user = auth.currentUser;
      const toApprove = searchResults.filter(c => selectedContactIds.has(c.id));
      for (const c of toApprove) {
        const id = `${companyId}_${c.id}`;
        await setDoc(doc(db, 'users', user.uid, 'contacts', id), {
          apollo_person_id: c.id,
          name: c.name || 'Unknown', title: c.title || '',
          email: c.email || null, phone: c.phone_numbers?.[0] || null,
          linkedin_url: c.linkedin_url || null,
          company_id: companyId, company_name: company.name,
          company_industry: company.industry || null,
          lead_owner: user.uid,
          status: 'pending_enrichment',
          saved_at: new Date().toISOString(), source: 'apollo_people_search',
        });
        await enrichContact(user.uid, c.id);
      }
      await loadContacts();
      setSelectedContactIds(new Set());
    } catch (err) {
      console.error('Bulk approve failed:', err);
    } finally {
      setSavingBulk(false);
    }
  }

  async function enrichContact(userId, apolloPersonId) {
    try {
      const authToken = await auth.currentUser.getIdToken();
      const res = await fetch('/.netlify/functions/enrichContact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, authToken, contactId: apolloPersonId }),
      });
      const data = await res.json();
      const contactDocId = `${companyId}_${apolloPersonId}`;
      if (data.success) {
        await updateDoc(doc(db, 'users', userId, 'contacts', contactDocId), {
          ...data.enrichedData, status: 'active', enriched_at: new Date().toISOString(),
        });
      } else {
        await updateDoc(doc(db, 'users', userId, 'contacts', contactDocId), {
          status: 'enrichment_failed',
        });
      }
    } catch {
      /* enrichment errors are non-fatal */
    }
  }

  // ── Decision makers ────────────────────────────────────────────────────────
  async function saveDecisionMakers() {
    if (!selectedDecisionMakers.length) return;
    setSavingDMs(true);
    try {
      const user = auth.currentUser;
      for (const person of selectedDecisionMakers) {
        const id = `${companyId}_${person.id}`;
        await setDoc(doc(db, 'users', user.uid, 'contacts', id), {
          apollo_person_id: person.id,
          name: person.name || 'Unknown', title: person.title || '',
          email: person.email || null, phone: person.phone || null,
          linkedin_url: person.linkedin_url || null, photo_url: person.photo_url || null,
          company_id: companyId, company_name: company.name,
          company_industry: company.industry || null,
          department: person.department || null, seniority: person.seniority || null,
          lead_owner: user.uid,
          status: 'pending_enrichment',
          saved_at: new Date().toISOString(), source: 'decision_makers',
        });
        await enrichContact(user.uid, person.id);
      }
      await loadContacts();
      setSelectedDecisionMakers([]);
    } catch (err) {
      console.error('Failed to save decision makers:', err);
    } finally {
      setSavingDMs(false);
    }
  }

  // ── Archive / restore ──────────────────────────────────────────────────────
  async function handleArchive() {
    if (!window.confirm(`Archive ${company?.name}? You can restore it later.`)) return;
    setArchiving(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'companies', companyId), {
        status: 'archived', archived_at: new Date().toISOString(),
        activity_log: arrayUnion({ type: 'status_changed', from: 'accepted', to: 'archived', timestamp: new Date().toISOString() }),
      });
      onBack();
    } catch (err) {
      console.error('Archive failed:', err);
      setArchiving(false);
    }
  }

  async function handleRestore() {
    setArchiving(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'companies', companyId), {
        status: 'accepted', archived_at: null,
        activity_log: arrayUnion({ type: 'status_changed', from: 'archived', to: 'accepted', timestamp: new Date().toISOString() }),
      });
      setCompany(prev => ({ ...prev, status: 'accepted' }));
      setArchiving(false);
    } catch (err) {
      console.error('Restore failed:', err);
      setArchiving(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function extractDomain(url) {
    if (!url) return null;
    try { return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
    catch { return null; }
  }

  function getLeadershipBadge(contact) {
    const seniority = (contact.seniority || '').toLowerCase();
    const title = (contact.title || '').toLowerCase();
    if (seniority.includes('c_') || title.includes('ceo') || title.includes('cfo') || title.includes('cto') || title.includes('chief'))
      return { letter: 'C', color: '#f59e0b' };
    if (seniority.includes('vp') || title.includes('vice president') || title.includes(' vp '))
      return { letter: 'V', color: '#a78bfa' };
    if (seniority.includes('director') || title.includes('director'))
      return { letter: 'D', color: '#38bdf8' };
    if (seniority.includes('manager') || title.includes('manager'))
      return { letter: 'M', color: '#34d399' };
    return null;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loadingCompany) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: T.textMuted }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${BRAND.pink}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: 13, margin: 0 }}>Loading company profile...</p>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!company) return null;

  const snap = enrichedData?.snapshot || {};
  const decisionMakers = enrichedData?.decisionMakers || [];
  const availableResults = searchResults.filter(c => !approvedContacts.some(ac => ac.apollo_person_id === c.id));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>

      {/* ── Top bar ── */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}`, background: T.navBg, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: T.surface, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            <CompanyLogo company={company} size="small" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company.name}</div>
            <div style={{ fontSize: 10, color: T.textFaint }}>{company.industry}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {enriching && <Loader size={14} color={T.textFaint} style={{ animation: 'spin 1s linear infinite' }} />}
          {company.status === 'archived' ? (
            <button onClick={handleRestore} disabled={archiving}
              style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <RotateCcw size={11} />{archiving ? 'Restoring…' : 'Restore'}
            </button>
          ) : (
            <button onClick={handleArchive} disabled={archiving}
              style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Archive size={11} />{archiving ? 'Archiving…' : 'Archive'}
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Company info card ── */}
        <div style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 13, overflow: 'hidden' }}>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 0 }}>
            {[
              ['Employees', company.employee_count || company.company_size || 'N/A', Users],
              ['Founded', company.founded_year || snap.founded_year || 'N/A', Calendar],
              ['Location', company.location || snap.location?.full || 'N/A', MapPin],
              ['Industry', company.industry || 'N/A', Briefcase],
              ...(company.revenue || snap.annual_revenue ? [['Revenue', company.revenue || snap.annual_revenue, DollarSign]] : []),
            ].map(([label, value, Icon]) => (
              <div key={label} style={{ padding: '12px 14px', borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <Icon size={11} color={T.textFaint} />
                  <span style={{ fontSize: 9, letterSpacing: 1, color: T.textFaint, fontWeight: 600 }}>{label.toUpperCase()}</span>
                </div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(value)}</div>
              </div>
            ))}
          </div>

          {/* Quick links */}
          <div style={{ padding: '10px 14px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: (snap.description || snap.keywords?.length) ? `1px solid ${T.border}` : 'none' }}>
            {(company.website_url || snap.website_url) && (
              <button onClick={() => window.open(company.website_url || snap.website_url, '_blank')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 7, border: `1px solid #7c5ce430`, background: '#7c5ce410', color: '#b388ff', fontSize: 11, cursor: 'pointer' }}>
                <Globe size={11} />Website
              </button>
            )}
            {(company.linkedin_url || snap.linkedin_url) && (
              <button onClick={() => window.open(company.linkedin_url || snap.linkedin_url, '_blank')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 7, border: `1px solid #0077b530`, background: '#0077b510', color: '#3b82f6', fontSize: 11, cursor: 'pointer' }}>
                <Linkedin size={11} />LinkedIn
              </button>
            )}
            {snap.phone && (
              <button onClick={() => window.location.href = `tel:${snap.phone}`}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted, fontSize: 11, cursor: 'pointer' }}>
                <Phone size={11} />{snap.phone}
              </button>
            )}
          </div>

          {/* Collapsible overview */}
          {snap.description && (
            <div style={{ borderBottom: `1px solid ${T.border}` }}>
              <button onClick={() => setShowOverview(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={12} />Company Overview</span>
                {showOverview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showOverview && (
                <div style={{ padding: '0 14px 12px', fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>{snap.description}</div>
              )}
            </div>
          )}

          {/* Collapsible keywords */}
          {snap.keywords?.length > 0 && (
            <div>
              <button onClick={() => setShowKeywords(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Tag size={12} />Industries & Keywords</span>
                {showKeywords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showKeywords && (
                <div style={{ padding: '0 14px 12px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {company.industry && <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: `${BRAND.pink}15`, color: BRAND.pink, border: `1px solid ${BRAND.pink}30` }}>{company.industry}</span>}
                  {snap.keywords.map((kw, i) => (
                    <span key={i} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: T.surface, color: T.textMuted, border: `1px solid ${T.border}` }}>{kw}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Saved Contacts ── */}
        {approvedContacts.length > 0 && (
          <Section title={`Saved Contacts (${approvedContacts.length})`} icon={<CheckCircle size={14} color={STATUS.green} />} T={T}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
              {approvedContacts.map(c => (
                <ContactPhotoCard
                  key={c.id}
                  contact={c}
                  badge={<div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, background: `${STATUS.green}20`, color: STATUS.green, borderRadius: 6, padding: '2px 6px' }}><CheckCircle size={9} />Saved</div>}
                  footer={
                    <button onClick={() => navigate(`/scout/contact/${c.id}`)}
                      style={{ width: '100%', padding: '5px 0', borderRadius: 6, border: 'none', background: T.cyanBg, color: T.cyan, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                      View Profile →
                    </button>
                  }
                  getLeadershipBadge={getLeadershipBadge}
                  T={T}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Decision Makers from Apollo ── */}
        {decisionMakers.length > 0 && (
          <Section title="Key Decision Makers" subtitle="Select contacts to add as leads" icon={<Users size={14} color={BRAND.cyan} />} T={T}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
              {decisionMakers.map((person, i) => {
                const isSelected = selectedDecisionMakers.some(p => p.id === person.id);
                const alreadySaved = approvedContacts.some(c => c.apollo_person_id === person.id);
                return (
                  <ContactPhotoCard
                    key={i}
                    contact={person}
                    selected={isSelected}
                    alreadySaved={alreadySaved}
                    onClick={!alreadySaved ? () => {
                      setSelectedDecisionMakers(prev =>
                        isSelected ? prev.filter(p => p.id !== person.id) : [...prev, person]
                      );
                    } : undefined}
                    badge={alreadySaved
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, background: `${STATUS.green}20`, color: STATUS.green, borderRadius: 6, padding: '2px 6px' }}><CheckCircle size={9} />Saved</div>
                      : isSelected ? <div style={{ fontSize: 9, background: `${BRAND.pink}20`, color: BRAND.pink, borderRadius: 6, padding: '2px 6px' }}>Selected</div> : null
                    }
                    getLeadershipBadge={getLeadershipBadge}
                    T={T}
                  />
                );
              })}
            </div>
            {selectedDecisionMakers.length > 0 && (
              <button onClick={saveDecisionMakers} disabled={savingDMs}
                style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {savingDMs ? <><div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', animation: 'spin 1s linear infinite' }} />Saving…</>
                  : <><UserPlus size={13} />Add {selectedDecisionMakers.length} to Leads</>}
              </button>
            )}
          </Section>
        )}

        {/* ── Contact Search by Title ── */}
        <Section title="Find Contacts by Title" subtitle="Search Apollo for people at this company" icon={<Search size={14} color={BRAND.pink} />} T={T}>
          {/* Title input */}
          <form onSubmit={addTitle} style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 11px' }}>
              <Search size={13} color={T.textFaint} />
              <input
                value={customTitleInput}
                onChange={e => setCustomTitleInput(e.target.value)}
                placeholder='Add a title (e.g. "VP Sales", "CEO", "Marketing Manager")…'
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: T.text }}
              />
            </div>
            <button type="submit" disabled={!customTitleInput.trim()}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: customTitleInput.trim() ? `linear-gradient(135deg,${BRAND.pink},#c0146a)` : T.surface, color: customTitleInput.trim() ? '#fff' : T.textFaint, fontSize: 12, fontWeight: 600, cursor: customTitleInput.trim() ? 'pointer' : 'default' }}>
              Add
            </button>
          </form>

          {/* Active titles */}
          {selectedTitles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {selectedTitles.map(t => (
                <div key={t.title} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 7, background: `${BRAND.pink}12`, border: `1px solid ${BRAND.pink}30`, fontSize: 11, color: BRAND.pink }}>
                  <Target size={10} />
                  <span>{t.title}</span>
                  <button onClick={() => removeTitle(t.title)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND.pink, display: 'flex', padding: 0 }}><X size={11} /></button>
                </div>
              ))}
              {selectedTitles.length > 1 && (
                <button onClick={() => { setSelectedTitles([]); setSearchResults([]); }}
                  style={{ padding: '4px 9px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 11, cursor: 'pointer' }}>
                  Clear All
                </button>
              )}
            </div>
          )}

          {/* Search results */}
          {searchingContacts ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 30, color: T.textFaint, fontSize: 12 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${BRAND.pink}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
              Searching for contacts at {company.name}…
            </div>
          ) : availableResults.length > 0 ? (
            <>
              {/* Bulk action bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: T.textFaint }}>{availableResults.length} contact{availableResults.length !== 1 ? 's' : ''} found</span>
                <div style={{ display: 'flex', gap: 7 }}>
                  {selectedContactIds.size > 0 ? (
                    <>
                      <span style={{ fontSize: 11, color: T.textMuted, alignSelf: 'center' }}>{selectedContactIds.size} selected</span>
                      <button onClick={bulkApprove} disabled={savingBulk}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        {savingBulk ? 'Saving…' : <><UserPlus size={11} />Add {selectedContactIds.size} to Leads</>}
                      </button>
                      <button onClick={() => setSelectedContactIds(new Set())}
                        style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 11, cursor: 'pointer' }}>
                        Clear
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setSelectedContactIds(new Set(availableResults.map(c => c.id)))}
                      style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted, fontSize: 11, cursor: 'pointer' }}>
                      Select All
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
                {availableResults.map(c => {
                  const isSelected = selectedContactIds.has(c.id);
                  const isApproving = approvingContactIds.has(c.id);
                  const badge = getLeadershipBadge(c);
                  return (
                    <ContactPhotoCard
                      key={c.id}
                      contact={c}
                      selected={isSelected}
                      onClick={() => setSelectedContactIds(prev => {
                        const s = new Set(prev);
                        s.has(c.id) ? s.delete(c.id) : s.add(c.id);
                        return s;
                      })}
                      badge={isSelected ? <div style={{ fontSize: 9, background: `${BRAND.pink}20`, color: BRAND.pink, borderRadius: 6, padding: '2px 6px' }}>Selected</div> : null}
                      footer={
                        isApproving ? (
                          <div style={{ width: '100%', padding: '5px 0', textAlign: 'center', fontSize: 10, color: T.textFaint }}>Saving…</div>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); approveContact(c); }}
                            style={{ width: '100%', padding: '5px 0', borderRadius: 6, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                            <UserPlus size={10} style={{ display: 'inline', marginRight: 3 }} />Add
                          </button>
                        )
                      }
                      getLeadershipBadge={getLeadershipBadge}
                      T={T}
                    />
                  );
                })}
              </div>
            </>
          ) : selectedTitles.length > 0 && !searchingContacts ? (
            <div style={{ textAlign: 'center', padding: 24, color: T.textFaint, fontSize: 12 }}>
              {searchResults.length > 0 && availableResults.length === 0
                ? <><CheckCircle size={28} color={STATUS.green} style={{ display: 'block', margin: '0 auto 8px' }} />All found contacts are already saved!</>
                : <>No contacts found for these titles at {company.name}. Try different titles.</>}
            </div>
          ) : selectedTitles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: T.textFaint, fontSize: 12 }}>
              <Target size={28} color={T.textFaint} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.4 }} />
              Add job titles above to start finding contacts
            </div>
          ) : null}
        </Section>

        {/* ── Suggested Contacts ── */}
        {suggestedContacts.length > 0 && (
          <Section title={`Suggested Contacts (${suggestedContacts.length})`} subtitle="Auto-discovered from your ICP" icon={<Target size={14} color={BRAND.cyan} />} T={T}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10 }}>
              {suggestedContacts.map(c => (
                <ContactPhotoCard
                  key={c.id}
                  contact={c}
                  badge={<div style={{ fontSize: 9, background: `${BRAND.cyan}15`, color: BRAND.cyan, borderRadius: 6, padding: '2px 6px' }}>Suggested</div>}
                  getLeadershipBadge={getLeadershipBadge}
                  T={T}
                />
              ))}
            </div>
          </Section>
        )}

      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, subtitle, icon, children, T }) {
  return (
    <div style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 13, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10, color: T.textFaint, marginTop: 1 }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

// ── Contact photo card ────────────────────────────────────────────────────────
function ContactPhotoCard({ contact, selected, alreadySaved, onClick, badge, footer, getLeadershipBadge, T }) {
  const bg = contact.photo_url || '/barry.png';
  const lbadge = getLeadershipBadge(contact);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {/* Photo card */}
      <div
        onClick={onClick}
        style={{
          position: 'relative', width: '100%', paddingTop: '120%',
          borderRadius: 10, overflow: 'hidden', cursor: onClick ? 'pointer' : 'default',
          border: `2px solid ${selected ? BRAND.pink : alreadySaved ? STATUS.green : T.border}`,
          transition: 'border-color 0.15s',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center top' }} />
        {/* Gradient overlay */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', background: 'linear-gradient(to top,rgba(0,0,0,0.85),transparent)' }} />
        {/* Leadership badge */}
        {lbadge && (
          <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, background: `${lbadge.color}cc`, color: '#fff', borderRadius: 5, padding: '2px 5px' }}>
            <Award size={9} />{lbadge.letter}
          </div>
        )}
        {/* Badge top right */}
        {badge && (
          <div style={{ position: 'absolute', top: 6, right: 6 }}>{badge}</div>
        )}
        {/* Name / title */}
        <div style={{ position: 'absolute', bottom: 7, left: 7, right: 7 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.2, marginBottom: 2 }}>{contact.name || 'Unknown'}</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{contact.title}</div>
        </div>
      </div>
      {/* LinkedIn */}
      {contact.linkedin_url && (
        <button onClick={e => { e.stopPropagation(); window.open(contact.linkedin_url, '_blank'); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 0', borderRadius: 6, border: `1px solid #0077b530`, background: '#0077b510', color: '#3b82f6', fontSize: 10, cursor: 'pointer' }}>
          <Linkedin size={10} />LinkedIn
        </button>
      )}
      {/* Footer action */}
      {footer}
    </div>
  );
}
