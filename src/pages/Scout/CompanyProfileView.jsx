/**
 * CompanyProfileView.jsx — Inline company profile drill-down inside ScoutMain.
 *
 * Renders inside the ScoutMain shell (no separate page/layout).
 * Shows company info, decision makers, saved contacts, and title-based contact search.
 */
import { useEffect, useState, useRef } from 'react';
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
  FileText, Tag, Phone, ExternalLink, Loader, Zap, ChevronLeft, Code, User,
} from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import CompanyLogo from '../../components/scout/CompanyLogo';
import ContactProfile from './ContactProfile';
import { searchPeople, updatePerson } from '../../services/peopleService';

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
  const [showKeywords, setShowKeywords] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [engageContactId, setEngageContactId] = useState(null);
  // Swipe queue return: populated when user drilled in from the Find Contacts swipe deck
  const [swipeQueueLeft, setSwipeQueueLeft] = useState(() => {
    const val = sessionStorage.getItem('sc_fromSwipe');
    return val !== null ? parseInt(val, 10) : null;
  });

  // ── Add Your Contacts (people search) state ─────────────────────────────────
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState([]);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [selectedPeopleToAdd, setSelectedPeopleToAdd] = useState([]);
  const [addingPeopleToCompany, setAddingPeopleToCompany] = useState(false);
  const [addPeopleSuccess, setAddPeopleSuccess] = useState(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    if (!companyId) return;
    // Reset UI state when switching companies so nothing stays hidden
    setShowKeywords(true);
    setEnrichedData(null);
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

      let titles = data.selected_titles || [];
      // Auto-populate from ICP if no titles saved yet
      if (titles.length === 0) {
        try {
          const icpDoc = await getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current'));
          if (icpDoc.exists()) {
            const icpTitles = icpDoc.data().targetTitles || [];
            if (icpTitles.length > 0) {
              titles = icpTitles.map((title, index) => ({ title, rank: index + 1, score: 100 - (index * 10), source: 'icp' }));
              await updateDoc(doc(db, 'users', user.uid, 'companies', companyId), {
                selected_titles: titles, titles_source: 'icp_auto', titles_updated_at: new Date().toISOString(),
              });
            }
          }
        } catch { /* non-fatal */ }
      }
      setSelectedTitles(titles);
      // Pass `data` directly — React state (company) is not yet committed here
      if (titles.length > 0) searchContacts(titles, data);

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
      const domain = companyData.domain || extractDomain(companyData.website_url) || null;
      // apollo_organization_id is stored by the swipe-deck pipeline; apollo_id by the contact-search pipeline
      const organizationId = companyData.apollo_id || companyData.apollo_organization_id || null;

      const res = await fetch('/.netlify/functions/enrichCompany', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid, authToken,
          domain,
          organizationId,
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
  // companyData is optional — pass it when calling before React has committed
  // the setCompany() update (e.g. from loadCompany), where the `company` state
  // variable may still be null due to async batching.
  async function searchContacts(titles, companyData) {
    const resolvedCompany = companyData || company;
    if (!titles.length || !resolvedCompany) return;
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
          organizationId: resolvedCompany.apollo_organization_id,
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

  // ── Add Your Contacts (people search) ──────────────────────────────────────
  function handlePeopleSearch(e) {
    const q = e.target.value;
    setPeopleSearchQuery(q);
    clearTimeout(searchTimeoutRef.current);
    if (q.trim().length < 2) { setPeopleResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearchingPeople(true);
      try {
        const user = auth.currentUser;
        if (!user) return;
        const results = await searchPeople(user.uid, q);
        setPeopleResults(results);
      } finally {
        setSearchingPeople(false);
      }
    }, 300);
  }

  function handleTogglePersonSelection(person) {
    setSelectedPeopleToAdd(prev => {
      const isSelected = prev.some(p => p.id === person.id);
      return isSelected ? prev.filter(p => p.id !== person.id) : [...prev, person];
    });
  }

  async function handleAddPeopleToCompany() {
    if (!selectedPeopleToAdd.length) return;
    setAddingPeopleToCompany(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      for (const person of selectedPeopleToAdd) {
        await updatePerson(user.uid, person.id, {
          company_id: companyId, company_name: company.name,
          company_industry: company.industry || null, company: company.name,
        });
      }
      const companyRef = doc(db, 'users', user.uid, 'companies', companyId);
      const companyDoc = await getDoc(companyRef);
      await updateDoc(companyRef, { contact_count: (companyDoc.data()?.contact_count || 0) + selectedPeopleToAdd.length });
      setAddPeopleSuccess(true);
      setSelectedPeopleToAdd([]);
      setPeopleSearchQuery('');
      setPeopleResults([]);
      setTimeout(() => setAddPeopleSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to add people to company:', err);
    } finally {
      setAddingPeopleToCompany(false);
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
          onClick={() => {
            sessionStorage.removeItem('sc_fromSwipe');
            setSwipeQueueLeft(null);
            onBack();
          }}
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
            <div style={{ fontSize: 10, color: T.textFaint }}>{snap.industry || company.industry}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {enriching && <Loader size={14} color={T.textFaint} style={{ animation: 'spin 1s linear infinite' }} />}
          <button
            onClick={() => enrichCompany(company, true)}
            disabled={enriching}
            title="Refresh company data"
            style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.textFaint, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <RefreshCw size={11} style={enriching ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
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

      {/* ── Swipe queue return banner ── */}
      {swipeQueueLeft !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 20px', flexShrink: 0,
          background: `linear-gradient(90deg, ${BRAND.pink}18, ${BRAND.cyan}12)`,
          borderBottom: `1px solid ${BRAND.pink}30`,
        }}>
          <span style={{ fontSize: 16 }}>🎯</span>
          <span style={{ flex: 1, fontSize: 12, color: T.text, fontWeight: 500 }}>
            {swipeQueueLeft === 0
              ? 'Add a contact here — this is your last one!'
              : `Add a contact here, then tackle ${swipeQueueLeft} more.`}
          </span>
          <button
            onClick={() => {
              sessionStorage.removeItem('sc_fromSwipe');
              setSwipeQueueLeft(null);
              onBack();
            }}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 8,
              border: `1px solid ${BRAND.pink}40`,
              background: `${BRAND.pink}15`, color: BRAND.pink,
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${BRAND.pink}28`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${BRAND.pink}15`; }}
          >
            <ArrowLeft size={11} /> Back to Swipe
          </button>
        </div>
      )}

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Company info card ── */}
        <div style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 13, overflow: 'hidden' }}>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 0 }}>
            {[
              ['Employees', snap.estimated_num_employees || company.employee_count || company.company_size || 'N/A', Users],
              ['Founded', snap.founded_year || company.founded_year || 'N/A', Calendar],
              ['Location', snap.location?.full || company.location || 'N/A', MapPin],
              ['Industry', snap.industry || company.industry || 'N/A', Briefcase],
              ...(snap.annual_revenue || snap.revenue_range || company.revenue ? [['Revenue', snap.revenue_range || snap.annual_revenue || company.revenue, DollarSign]] : []),
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
          <div style={{ padding: '10px 14px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${T.border}` }}>
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

          {/* Company Overview — always visible, never collapsed */}
          <div style={{ borderBottom: (company.industry || snap.keywords?.length > 0) ? `1px solid ${T.border}` : 'none', padding: '10px 14px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
              <FileText size={12} color={T.textFaint} />
              <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, letterSpacing: 0.3, textTransform: 'uppercase' }}>Company Overview</span>
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.65 }}>
              {snap.description
                ? snap.description
                : enriching
                  ? <span style={{ color: T.textFaint, fontStyle: 'italic' }}>Loading overview…</span>
                  : <span style={{ color: T.textFaint, fontStyle: 'italic' }}>No overview available.</span>
              }
            </div>
          </div>

          {/* Collapsible keywords — shown when industry OR keywords are present */}
          {(snap.industry || company.industry || snap.keywords?.length > 0) && (
            <div>
              <button onClick={() => setShowKeywords(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Tag size={12} />Industries & Keywords</span>
                {showKeywords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showKeywords && (
                <div style={{ padding: '0 14px 12px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {(snap.industry || company.industry) && <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: `${BRAND.pink}15`, color: BRAND.pink, border: `1px solid ${BRAND.pink}30` }}>{snap.industry || company.industry}</span>}
                  {snap.keywords?.map((kw, i) => (
                    <span key={i} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: T.surface, color: T.textMuted, border: `1px solid ${T.border}` }}>{kw}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Tech Stack ── */}
        {enrichedData?.techStack?.length > 0 && (
          <Section title={`Tech Stack (${enrichedData.techStack.length})`} icon={<Code size={14} color={BRAND.cyan} />} T={T}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
              {enrichedData.techStack.map((tech, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: T.surface, border: `1px solid ${T.border}` }}>
                  <Code size={13} color={BRAND.cyan} style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tech.name}</div>
                    {tech.category && <div style={{ fontSize: 9, color: T.textFaint, marginTop: 1 }}>{tech.category}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Data Confidence ── */}
        {enrichedData?.dataQuality && (
          <Section title="Data Confidence" icon={<Award size={14} color={STATUS.green} />} T={T}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textMuted }}>Last Updated</span>
                <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>
                  {new Date(enrichedData._raw?.enrichedAt || Date.now()).toLocaleDateString()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textMuted }}>Status</span>
                <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 6, background: `${STATUS.green}15`, color: STATUS.green, border: `1px solid ${STATUS.green}30`, fontWeight: 600 }}>
                  {enrichedData.dataQuality.organization_status || 'Active'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ fontSize: 12, color: T.textMuted }}>Source</span>
                <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>Verified Data</span>
              </div>
            </div>
          </Section>
        )}

        {/* ── Saved Contacts ── */}
        {approvedContacts.length > 0 && (
          <Section title={`Saved Contacts (${approvedContacts.length})`} icon={<CheckCircle size={14} color={STATUS.green} />} T={T}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
              {approvedContacts.map(c => (
                <ContactPhotoCard
                  key={c.id}
                  contact={c}
                  badge={<div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, background: `${STATUS.green}20`, color: STATUS.green, borderRadius: 6, padding: '2px 6px' }}><CheckCircle size={9} />Saved</div>}
                  footer={
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button onClick={() => setEngageContactId(c.id)}
                        style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Zap size={13} />Engage
                      </button>
                      <button onClick={() => navigate(`/scout/contact/${c.id}`)}
                        style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.cyan},#009aa0)`, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        View Full Profile →
                      </button>
                    </div>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
              {decisionMakers.map((person, i) => {
                const isSelected = selectedDecisionMakers.some(p => p.id === person.id);
                const alreadySaved = approvedContacts.some(c => c.apollo_person_id === person.id);
                const savedContact = alreadySaved
                  ? approvedContacts.find(c => c.apollo_person_id === person.id)
                  : null;
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
                    footer={savedContact ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button onClick={() => setEngageContactId(savedContact.id)}
                          style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <Zap size={13} />Engage
                        </button>
                        <button onClick={() => navigate(`/scout/contact/${savedContact.id}`)}
                          style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.cyan},#009aa0)`, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                          View Full Profile →
                        </button>
                      </div>
                    ) : undefined}
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
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
                            style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                            <UserPlus size={12} />Save to Leads
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
              {suggestedContacts.map(c => (
                <ContactPhotoCard
                  key={c.id}
                  contact={c}
                  badge={<div style={{ fontSize: 9, background: `${BRAND.cyan}15`, color: BRAND.cyan, borderRadius: 6, padding: '2px 6px' }}>Suggested</div>}
                  footer={
                    <button onClick={e => { e.stopPropagation(); approveContact({ id: c.apollo_person_id || c.id, ...c }); }}
                      style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                      <UserPlus size={12} />Save to Leads
                    </button>
                  }
                  getLeadershipBadge={getLeadershipBadge}
                  T={T}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Add Your Contacts ── */}
        <Section title="Add Your Contacts" subtitle="Search your existing leads & people by name and link them to this company" icon={<UserPlus size={14} color={BRAND.pink} />} T={T}>
          {addPeopleSuccess && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 8, background: `${STATUS.green}15`, border: `1px solid ${STATUS.green}30`, color: STATUS.green, fontSize: 12, marginBottom: 10 }}>
              <CheckCircle size={13} />Contacts successfully linked to {company.name}!
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 11px', marginBottom: 10 }}>
            <Search size={13} color={T.textFaint} />
            <input
              type="text"
              value={peopleSearchQuery}
              onChange={handlePeopleSearch}
              placeholder="Search all leads & people by name..."
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: T.text }}
            />
            {peopleSearchQuery && (
              <button onClick={() => { setPeopleSearchQuery(''); setPeopleResults([]); setSelectedPeopleToAdd([]); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, display: 'flex', padding: 0 }}>
                <X size={13} />
              </button>
            )}
          </div>

          {searchingPeople && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: T.textFaint, fontSize: 12 }}>
              <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />Searching…
            </div>
          )}

          {!searchingPeople && peopleResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {peopleResults.map(person => {
                const isSelected = selectedPeopleToAdd.some(p => p.id === person.id);
                const isAlreadyLinked = person.company_id === companyId;
                return (
                  <div
                    key={person.id}
                    onClick={() => !isAlreadyLinked && handleTogglePersonSelection(person)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9,
                      background: isSelected ? `${BRAND.pink}10` : T.surface,
                      border: `1px solid ${isSelected ? BRAND.pink + '40' : T.border}`,
                      cursor: isAlreadyLinked ? 'default' : 'pointer', opacity: isAlreadyLinked ? 0.6 : 1,
                    }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: T.border, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {person.photo_url
                        ? <img src={person.photo_url} alt={person.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <User size={15} color={T.textFaint} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{person.name}</div>
                      <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[person.title, person.company_name || person.company].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {isAlreadyLinked
                      ? <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: `${STATUS.green}15`, color: STATUS.green, flexShrink: 0 }}>Already linked</span>
                      : <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${isSelected ? BRAND.pink : T.border}`, background: isSelected ? BRAND.pink : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {isSelected && <CheckCircle size={11} color="#fff" />}
                        </div>
                    }
                  </div>
                );
              })}
            </div>
          )}

          {!searchingPeople && peopleSearchQuery.length >= 2 && peopleResults.length === 0 && (
            <div style={{ fontSize: 12, color: T.textFaint, padding: '8px 0' }}>No contacts found for &ldquo;{peopleSearchQuery}&rdquo;</div>
          )}

          {selectedPeopleToAdd.length > 0 && (
            <button onClick={handleAddPeopleToCompany} disabled={addingPeopleToCompany}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {addingPeopleToCompany
                ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />Adding…</>
                : <><UserPlus size={13} />Add {selectedPeopleToAdd.length} to {company.name}</>}
            </button>
          )}
        </Section>

      </div>

      {/* ── Engage panel overlay ── */}
      {engageContactId && (
        <EngagePanel contactId={engageContactId} onClose={() => setEngageContactId(null)} T={T} />
      )}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, subtitle, icon, children, T }) {
  return (
    <div style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 13 }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 7, borderRadius: '13px 13px 0 0', overflow: 'hidden' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {/* Photo card — capped at 220px tall so cards never overflow the viewport */}
      <div
        onClick={onClick}
        style={{
          position: 'relative', width: '100%',
          height: 'clamp(160px, 30vw, 220px)',
          borderRadius: 12, overflow: 'hidden', cursor: onClick ? 'pointer' : 'default',
          border: `2px solid ${selected ? BRAND.pink : alreadySaved ? STATUS.green : T.border}`,
          boxShadow: selected ? `0 0 0 3px ${BRAND.pink}30` : alreadySaved ? `0 0 0 3px ${STATUS.green}20` : 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center top' }} />
        {/* Gradient overlay */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', background: 'linear-gradient(to top,rgba(0,0,0,0.92) 0%,rgba(0,0,0,0.6) 50%,transparent 100%)' }} />
        {/* Leadership badge */}
        {lbadge && (
          <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, background: `${lbadge.color}dd`, color: '#fff', borderRadius: 5, padding: '3px 7px' }}>
            <Award size={10} />{lbadge.letter}
          </div>
        )}
        {/* Badge top right */}
        {badge && (
          <div style={{ position: 'absolute', top: 8, right: 8 }}>{badge}</div>
        )}
        {/* Name / title */}
        <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.25, marginBottom: 3, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{contact.name || 'Unknown'}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{contact.title}</div>
        </div>
      </div>
      {/* LinkedIn */}
      {contact.linkedin_url && (
        <button onClick={e => { e.stopPropagation(); window.open(contact.linkedin_url, '_blank'); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 0', borderRadius: 7, border: `1px solid #0077b540`, background: '#0077b512', color: '#3b82f6', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <Linkedin size={12} />View LinkedIn
        </button>
      )}
      {/* Footer action */}
      {footer}
    </div>
  );
}

// ── Engage panel ──────────────────────────────────────────────────────────────
function EngagePanel({ contactId, onClose, T }) {
  const isMobile = window.innerWidth <= 768;

  // Escape key to close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock body scroll while panel is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#00000070', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: isMobile ? '100%' : '480px',
          background: T.appBg,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.25)',
          animation: 'slideInEngagePanel 0.22s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${T.border}`, background: T.navBg, flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 7, padding: '5px 11px', color: T.textMuted, fontSize: 11, cursor: 'pointer' }}
          >
            <ChevronLeft size={13} />Close
          </button>
          <span style={{ fontSize: 11, color: T.textFaint }}>Contact Profile</span>
        </div>
        <ContactProfile
          key={contactId}
          contactId={contactId}
          autoEngage={true}
          onClose={onClose}
        />
      </div>
      <style>{`@keyframes slideInEngagePanel { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}

