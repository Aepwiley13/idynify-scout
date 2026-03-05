/**
 * CompaniesSection — Saved companies view in Hunter.
 *
 * Shows all saved companies (status='accepted') from Scout enriched with
 * Hunter engagement data: how many contacts are being engaged, next
 * touchpoints, last activity. Companies with active missions float to top.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import {
  Building2, Users, Zap, Clock, Archive as ArchiveIcon,
  ChevronRight, Target, TrendingUp,
} from 'lucide-react';
import CompanyLogo from '../../../components/scout/CompanyLogo';
import './CompaniesSection.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(val) {
  if (!val) return null;
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function getEngagementBadge(engagedCount, totalContacts) {
  if (engagedCount === 0) return null;
  if (engagedCount === totalContacts && totalContacts > 0) return { label: 'All Engaged', color: '#10b981' };
  return { label: 'Active', color: '#3b82f6' };
}

// ── CompanyCard ───────────────────────────────────────────────────────────────

function CompanyCard({ company, contactStats, onViewContacts }) {
  const { engagedCount, deckCount, archivedCount, totalCount, nextTouchpoint, lastActivity } = contactStats;
  const badge = getEngagementBadge(engagedCount, totalCount);

  const name = company.name || 'Unnamed Company';
  const industry = company.industry || company.apolloEnrichment?.snapshot?.industry;
  const location = company.hq_location || company.location ||
    (company.headquarters_city ? `${company.headquarters_city}${company.headquarters_state ? ', ' + company.headquarters_state : ''}` : null);
  const size = company.employee_count || company.apolloEnrichment?.snapshot?.estimated_num_employees;

  const engagementPct = totalCount > 0 ? Math.round((engagedCount / totalCount) * 100) : 0;

  return (
    <div className={`hc-company-card ${engagedCount > 0 ? 'hc-company-card--active' : ''}`}>
      <div className="hc-company-card-top">
        <div className="hc-company-logo">
          <CompanyLogo company={company} size={40} />
        </div>
        <div className="hc-company-identity">
          <div className="hc-company-name">
            {name}
            {badge && (
              <span className="hc-company-badge" style={{ background: badge.color + '20', color: badge.color }}>
                {badge.label}
              </span>
            )}
          </div>
          <div className="hc-company-meta">
            {industry && <span>{industry}</span>}
            {location && <span>{location}</span>}
            {size && <span>{size.toLocaleString()} employees</span>}
          </div>
        </div>
      </div>

      {totalCount > 0 ? (
        <>
          {/* Engagement progress bar */}
          {engagedCount > 0 && (
            <div className="hc-progress-wrap">
              <div className="hc-progress-bar">
                <div className="hc-progress-fill" style={{ width: `${engagementPct}%` }} />
              </div>
              <span className="hc-progress-label">{engagementPct}% engaged</span>
            </div>
          )}

          {/* Contact stats row */}
          <div className="hc-contact-stats">
            {engagedCount > 0 && (
              <div className="hc-stat hc-stat--engaged">
                <Zap size={11} />
                <span>{engagedCount} engaged</span>
              </div>
            )}
            {deckCount > 0 && (
              <div className="hc-stat hc-stat--deck">
                <Target size={11} />
                <span>{deckCount} in deck</span>
              </div>
            )}
            {archivedCount > 0 && (
              <div className="hc-stat hc-stat--archived">
                <ArchiveIcon size={11} />
                <span>{archivedCount} archived</span>
              </div>
            )}
          </div>

          {/* Touchpoint / activity row */}
          <div className="hc-timing-row">
            {nextTouchpoint ? (
              <div className="hc-timing-item">
                <Clock size={11} />
                <span>Next touchpoint: <strong>{formatDate(nextTouchpoint)}</strong></span>
              </div>
            ) : lastActivity ? (
              <div className="hc-timing-item hc-timing-item--muted">
                <Clock size={11} />
                <span>Last activity: {formatDate(lastActivity)}</span>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="hc-no-contacts">
          <Users size={12} />
          <span>No contacts added yet</span>
        </div>
      )}

      <button className="hc-view-btn" onClick={() => onViewContacts(company)}>
        <Users size={13} />
        View contacts
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

// ── CompaniesSection ──────────────────────────────────────────────────────────

export default function CompaniesSection() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [contactMap, setContactMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    const user = auth.currentUser;
    if (!user) { navigate('/login'); return; }

    try {
      // Load saved companies + all contacts in parallel
      const [companiesSnap, contactsSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'users', user.uid, 'companies'),
          where('status', '==', 'accepted')
        )),
        getDocs(collection(db, 'users', user.uid, 'contacts')),
      ]);

      const companiesList = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Group contacts by company_id
      const grouped = {};
      contactsSnap.docs.forEach(d => {
        const contact = { id: d.id, ...d.data() };
        const cid = contact.company_id;
        if (!cid) return;
        if (!grouped[cid]) grouped[cid] = [];
        grouped[cid].push(contact);
      });

      setCompanies(companiesList);
      setContactMap(grouped);
    } catch (err) {
      console.error('[CompaniesSection] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }

  // Compute per-company stats
  function getContactStats(company) {
    const contacts = contactMap[company.id] || [];
    const engagedCount = contacts.filter(c =>
      c.hunter_status === 'active_mission' || c.hunter_status === 'engaged_pending'
    ).length;
    const deckCount = contacts.filter(c => c.hunter_status === 'deck').length;
    const archivedCount = contacts.filter(c => c.hunter_status === 'archived').length;

    // Next touchpoint — earliest next_step_due across active contacts
    const touchpoints = contacts
      .filter(c => c.next_step_due && (c.hunter_status === 'active_mission' || c.hunter_status === 'engaged_pending'))
      .map(c => c.next_step_due);
    const nextTouchpoint = touchpoints.length > 0 ? touchpoints.sort()[0] : null;

    // Last activity — most recent updated_at
    const activities = contacts
      .map(c => c.updated_at)
      .filter(Boolean)
      .sort()
      .reverse();
    const lastActivity = activities[0] || null;

    return { engagedCount, deckCount, archivedCount, totalCount: contacts.length, nextTouchpoint, lastActivity };
  }

  // Sort: companies with engaged contacts first, then by last activity
  const sortedCompanies = [...companies].sort((a, b) => {
    const sa = getContactStats(a);
    const sb = getContactStats(b);
    if (sb.engagedCount !== sa.engagedCount) return sb.engagedCount - sa.engagedCount;
    if (sb.totalCount !== sa.totalCount) return sb.totalCount - sa.totalCount;
    return String(sb.lastActivity || '').localeCompare(String(sa.lastActivity || ''));
  });

  const totalEngaged = sortedCompanies.reduce((sum, c) => sum + getContactStats(c).engagedCount, 0);
  const engagedCompanies = sortedCompanies.filter(c => getContactStats(c).engagedCount > 0).length;

  function handleViewContacts(company) {
    // Navigate to People tab — AllLeads will show all contacts, user can filter by company
    navigate('/hunter?tab=people');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="hc-loading">
        <div className="hc-loading-spinner" />
        <span>Loading companies...</span>
      </div>
    );
  }

  return (
    <div className="hc-companies-section">
      {/* Stats bar */}
      <div className="hc-stats-bar">
        <div className="hc-stat-card">
          <Building2 size={16} className="hc-stat-card-icon" />
          <div>
            <div className="hc-stat-card-value">{sortedCompanies.length}</div>
            <div className="hc-stat-card-label">Saved Companies</div>
          </div>
        </div>
        <div className="hc-stat-card">
          <Zap size={16} className="hc-stat-card-icon hc-stat-card-icon--active" />
          <div>
            <div className="hc-stat-card-value">{engagedCompanies}</div>
            <div className="hc-stat-card-label">Companies Engaged</div>
          </div>
        </div>
        <div className="hc-stat-card">
          <TrendingUp size={16} className="hc-stat-card-icon hc-stat-card-icon--blue" />
          <div>
            <div className="hc-stat-card-value">{totalEngaged}</div>
            <div className="hc-stat-card-label">Active Contacts</div>
          </div>
        </div>
      </div>

      {/* Company grid */}
      {sortedCompanies.length === 0 ? (
        <div className="hc-empty">
          <Building2 size={36} className="hc-empty-icon" />
          <p className="hc-empty-title">No saved companies yet</p>
          <p className="hc-empty-sub">Save companies in Scout to start tracking engagement here.</p>
          <button className="hc-empty-cta" onClick={() => navigate('/scout')}>
            Go to Scout
          </button>
        </div>
      ) : (
        <div className="hc-companies-grid">
          {sortedCompanies.map(company => (
            <CompanyCard
              key={company.id}
              company={company}
              contactStats={getContactStats(company)}
              onViewContacts={handleViewContacts}
            />
          ))}
        </div>
      )}
    </div>
  );
}
