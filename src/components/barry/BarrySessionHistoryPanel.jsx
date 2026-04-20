/**
 * BarrySessionHistoryPanel — slide-in drawer showing all Barry session history.
 *
 * Three data sources:
 *   RECON    → users/{uid}/recon_sessions
 *   Mission  → users/{uid}/barry_sessions
 *   Hunter   → contacts with engage_state.last_barry_session (lightweight, no subcollection fan-out)
 *
 * Unified feed ordered by updatedAt desc.
 * Search filters across all summaries.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import {
  collection, query, orderBy, limit, getDocs, where, collectionGroup,
} from 'firebase/firestore';
import { X, Search, Brain, BookOpen, Target, Clock, ChevronRight } from 'lucide-react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import './BarrySessionHistoryPanel.css';

const SECTION_TITLES = {
  1: 'Business Foundation', 2: 'Product Deep Dive', 3: 'Target Market',
  4: 'Customer Psychographics', 5: 'Pain Points', 6: 'Buying Behavior',
  7: 'Decision Process', 8: 'Competitive Landscape', 9: 'Messaging & Voice',
  10: 'Behavioral Signals',
};

const SECTION_TO_PATH = {
  1: '/recon/icp-intelligence', 2: '/recon/icp-intelligence',
  3: '/recon/icp-intelligence', 4: '/recon/icp-intelligence',
  5: '/recon/objections', 6: '/recon/objections',
  7: '/recon/buying-signals', 8: '/recon/competitive-intel',
  9: '/recon/messaging', 10: '/recon/buying-signals',
};

function relativeTime(ts) {
  if (!ts) return '';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(date.getTime())) return '';
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

function SessionRow({ session, onClick }) {
  const icon = session.type === 'recon'
    ? <BookOpen size={14} className="bsh-row-icon recon" />
    : session.type === 'hunter'
    ? <Target size={14} className="bsh-row-icon hunter" />
    : <Brain size={14} className="bsh-row-icon mission" />;

  return (
    <div className="bsh-row" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick(); }}>
      <div className="bsh-row-left">
        {icon}
        <div className="bsh-row-body">
          <p className="bsh-row-title">{session.title}</p>
          {session.summary && <p className="bsh-row-summary">{session.summary}</p>}
        </div>
      </div>
      <div className="bsh-row-right">
        <span className="bsh-row-time">{relativeTime(session.sortTs)}</span>
        <ChevronRight size={12} className="bsh-row-arrow" />
      </div>
    </div>
  );
}

export default function BarrySessionHistoryPanel({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const panelRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      loadSessions();
      setSearch('');
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const loadSessions = async () => {
    const user = getEffectiveUser();
    if (!user) return;
    setLoading(true);

    try {
      const uid = user.uid;

      const [reconSnap, missionSnap, contactsSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'users', uid, 'recon_sessions'),
          orderBy('createdAt', 'desc'), limit(30)
        )),
        getDocs(query(
          collection(db, 'users', uid, 'barry_sessions'),
          orderBy('updatedAt', 'desc'), limit(30)
        )),
        getDocs(query(
          collection(db, 'users', uid, 'contacts'),
          where('hunter_status', '!=', 'none'),
          limit(30)
        )).catch(() => null),
      ]);

      const all = [];

      reconSnap.forEach(d => {
        const data = d.data();
        all.push({
          id: d.id,
          type: 'recon',
          title: data.sectionTitle || `Section ${data.sectionId}`,
          summary: data.summary || null,
          sortTs: data.createdAt,
          nav: () => navigate(SECTION_TO_PATH[data.sectionId] || '/recon'),
        });
      });

      missionSnap.forEach(d => {
        const data = d.data();
        if (!data.messageCount) return; // skip empty sessions created on mount
        all.push({
          id: d.id,
          type: 'mission',
          title: 'Mission Control',
          summary: data.summary || null,
          sortTs: data.updatedAt,
          nav: () => navigate('/mission-control-v2'),
        });
      });

      if (contactsSnap) {
        contactsSnap.forEach(d => {
          const data = d.data();
          const session = data.engage_state?.last_barry_session;
          if (!session) return;
          all.push({
            id: d.id,
            type: 'hunter',
            title: data.name || 'Unknown Contact',
            summary: session.summary || null,
            sortTs: data.engage_state?.last_session_at || null,
            nav: () => navigate(`/scout/contact/${d.id}`),
          });
        });
      }

      // Sort unified feed by sortTs desc
      all.sort((a, b) => {
        const ta = a.sortTs?.toDate ? a.sortTs.toDate().getTime() : new Date(a.sortTs || 0).getTime();
        const tb = b.sortTs?.toDate ? b.sortTs.toDate().getTime() : new Date(b.sortTs || 0).getTime();
        return tb - ta;
      });

      setSessions(all);
    } catch (err) {
      console.error('[BarrySessionHistoryPanel] Load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = search.trim()
    ? sessions.filter(s =>
        (s.title + ' ' + (s.summary || '')).toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  // Group by type for the sectioned view
  const reconSessions   = filtered.filter(s => s.type === 'recon');
  const missionSessions = filtered.filter(s => s.type === 'mission');
  const hunterSessions  = filtered.filter(s => s.type === 'hunter');

  const isEmpty = filtered.length === 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`bsh-backdrop ${isOpen ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        className={`bsh-drawer ${isOpen ? 'open' : ''}`}
        role="dialog"
        aria-label="Barry Session History"
      >
        {/* Header */}
        <div className="bsh-header">
          <div className="bsh-header-left">
            <Brain size={16} className="bsh-header-icon" />
            <h2 className="bsh-header-title">Session History</h2>
          </div>
          <button className="bsh-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="bsh-search-wrap">
          <Search size={14} className="bsh-search-icon" />
          <input
            className="bsh-search-input"
            type="text"
            placeholder="Search sessions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Body */}
        <div className="bsh-body">
          {loading ? (
            <div className="bsh-loading">
              <div className="bsh-loading-dot" />
              <p>Loading sessions...</p>
            </div>
          ) : isEmpty ? (
            <div className="bsh-empty">
              <Clock size={24} />
              <p>{search ? 'No sessions match your search.' : 'No sessions yet. Start a conversation with Barry.'}</p>
            </div>
          ) : (
            <>
              {reconSessions.length > 0 && (
                <section className="bsh-section">
                  <p className="bsh-section-label">RECON</p>
                  {reconSessions.map(s => (
                    <SessionRow key={s.id} session={s} onClick={() => { s.nav(); onClose(); }} />
                  ))}
                </section>
              )}

              {missionSessions.length > 0 && (
                <section className="bsh-section">
                  <p className="bsh-section-label">Mission Control</p>
                  {missionSessions.map(s => (
                    <SessionRow key={s.id} session={s} onClick={() => { s.nav(); onClose(); }} />
                  ))}
                </section>
              )}

              {hunterSessions.length > 0 && (
                <section className="bsh-section">
                  <p className="bsh-section-label">Hunter</p>
                  {hunterSessions.map(s => (
                    <SessionRow key={s.id} session={s} onClick={() => { s.nav(); onClose(); }} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
