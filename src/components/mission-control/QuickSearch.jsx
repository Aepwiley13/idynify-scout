import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUserId } from '../../context/ImpersonationContext';
import { Search, User, Building2, Loader, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';

const AVATAR_COLORS = [
  '#e85d7a', '#7c3aed', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function rankResults(items, term, nameGetter) {
  const q = term.toLowerCase();
  return items.map(item => {
    const name = nameGetter(item).toLowerCase();
    let rank = 4;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else rank = 3;
    return { item, rank };
  }).sort((a, b) => a.rank - b.rank).map(r => r.item);
}

export default function QuickSearch() {
  const T = useT();
  const navigate = useNavigate();
  const activeUserId = useActiveUserId();

  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [contactResults, setContactResults] = useState([]);
  const [companyResults, setCompanyResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const querySeqRef = useRef(0);

  // Session-level caches: loaded once from Firestore on first search, reused
  // for all subsequent queries within this Mission Control session.
  const contactCacheRef = useRef(null);
  const companyCacheRef = useRef(null);
  const contactLoadPromiseRef = useRef(null);
  const companyLoadPromiseRef = useRef(null);

  const allResults = [...contactResults, ...companyResults];
  const totalResults = allResults.length;

  const loadContacts = useCallback(() => {
    if (contactCacheRef.current) return Promise.resolve(contactCacheRef.current);
    if (contactLoadPromiseRef.current) return contactLoadPromiseRef.current;

    const promise = (async () => {
      if (!activeUserId) return [];
      const peopleRef = collection(db, 'users', activeUserId, 'contacts');
      const q = query(
        peopleRef,
        where('is_archived', '==', false),
        orderBy('name', 'asc'),
        limit(500)
      );
      const snap = await getDocs(q);
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      contactCacheRef.current = records;
      return records;
    })();

    contactLoadPromiseRef.current = promise;
    promise.catch(() => { contactLoadPromiseRef.current = null; });
    return promise;
  }, [activeUserId]);

  const loadCompanies = useCallback(() => {
    if (companyCacheRef.current) return Promise.resolve(companyCacheRef.current);
    if (companyLoadPromiseRef.current) return companyLoadPromiseRef.current;

    const promise = (async () => {
      if (!activeUserId) return [];
      const companiesRef = collection(db, 'users', activeUserId, 'companies');
      const snap = await getDocs(companiesRef);
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      companyCacheRef.current = records;
      return records;
    })();

    companyLoadPromiseRef.current = promise;
    promise.catch(() => { companyLoadPromiseRef.current = null; });
    return promise;
  }, [activeUserId]);

  // Invalidate caches when user changes (e.g. impersonation switch).
  useEffect(() => {
    contactCacheRef.current = null;
    companyCacheRef.current = null;
    contactLoadPromiseRef.current = null;
    companyLoadPromiseRef.current = null;
  }, [activeUserId]);

  function filterContacts(contacts, term) {
    const lowerTerm = term.toLowerCase();
    const matches = [];
    for (const data of contacts) {
      const name = (data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim()).toLowerCase();
      const company = (data.company || '').toLowerCase();
      const email = (data.email || '').toLowerCase();
      const title = (data.title || '').toLowerCase();
      if (name.includes(lowerTerm) || company.includes(lowerTerm) ||
          email.includes(lowerTerm) || title.includes(lowerTerm)) {
        matches.push(data);
      }
    }
    return rankResults(matches, term, c =>
      c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()
    ).slice(0, 5);
  }

  function filterCompanies(companies, term) {
    const lowerTerm = term.toLowerCase();
    const matches = companies.filter(c => {
      const name = (c.name || c.company_name || '').toLowerCase();
      const domain = (c.domain || c.website || '').toLowerCase();
      const industry = (c.industry || '').toLowerCase();
      return name.includes(lowerTerm) || domain.includes(lowerTerm) || industry.includes(lowerTerm);
    });
    return rankResults(matches, term, c => c.name || c.company_name || '').slice(0, 5);
  }

  useEffect(() => {
    const term = inputValue.trim();
    if (term.length < 2) {
      setContactResults([]);
      setCompanyResults([]);
      setSearchError(false);
      setSearchLoading(false);
      setHighlightIndex(-1);
      return;
    }

    setSearchLoading(true);
    setSearchError(false);
    setHighlightIndex(-1);
    const seq = ++querySeqRef.current;

    const timer = setTimeout(async () => {
      try {
        const [contacts, companies] = await Promise.all([
          loadContacts(),
          loadCompanies(),
        ]);
        if (seq !== querySeqRef.current) return;
        setContactResults(filterContacts(contacts, term));
        setCompanyResults(filterCompanies(companies, term));
        setSearchLoading(false);
      } catch {
        if (seq !== querySeqRef.current) return;
        setSearchError(true);
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, loadContacts, loadCompanies]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function openContact(contact) {
    setIsOpen(false);
    setInputValue('');
    navigate(`/scout/contact/${contact.id}`);
  }

  function openCompany(company) {
    setIsOpen(false);
    setInputValue('');
    navigate(`/scout/company/${company.id}`);
  }

  function handleSelect(index) {
    if (index < 0 || index >= totalResults) return;
    const item = allResults[index];
    if (index < contactResults.length) {
      openContact(item);
    } else {
      openCompany(item);
    }
  }

  function handleKeyDown(e) {
    if (!isOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => {
        const next = prev + 1;
        return next >= totalResults ? 0 : next;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => {
        const next = prev - 1;
        return next < 0 ? totalResults - 1 : next;
      });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0) {
        handleSelect(highlightIndex);
      }
    }
  }

  const showPanel = isOpen && inputValue.trim().length >= 2;
  const hasResults = contactResults.length > 0 || companyResults.length > 0;

  let resultIndex = 0;

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: '1 1 200px' }}>
      <div style={{ position: 'relative' }}>
        <Search
          size={16}
          color={T.textFaint}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-haspopup="listbox"
          aria-controls="quick-search-results"
          aria-autocomplete="list"
          aria-activedescendant={highlightIndex >= 0 ? `qs-item-${highlightIndex}` : undefined}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (inputValue.trim().length >= 2) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search contacts or companies..."
          style={{
            width: '100%',
            padding: '10px 36px 10px 36px',
            borderRadius: 10,
            border: `1.5px solid ${isOpen && inputValue.trim().length >= 2 ? BRAND.pink + '60' : T.border2}`,
            background: T.input,
            color: T.text,
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
        />
        {inputValue && (
          <button
            onClick={() => {
              setInputValue('');
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={14} color={T.textMuted} />
          </button>
        )}
      </div>

      {showPanel && (
        <div
          id="quick-search-results"
          role="listbox"
          aria-label="Search results"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            maxHeight: 420,
            overflowY: 'auto',
            background: T.cardBg,
            border: `1px solid ${T.border2}`,
            borderRadius: 12,
            boxShadow: `0 16px 48px ${T.isDark ? '#00000080' : '#00000018'}`,
            zIndex: 100,
            animation: 'qsFadeIn 0.12s ease-out',
          }}
        >
          {searchLoading && !hasResults && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '24px 16px', color: T.textMuted, fontSize: 13,
            }}>
              <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Searching...
            </div>
          )}

          {searchError && !hasResults && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
              Search could not be completed. Try again.
            </div>
          )}

          {!searchLoading && !searchError && !hasResults && (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 4 }}>
                No matching contacts or companies
              </div>
              <div style={{ color: T.textFaint, fontSize: 12 }}>
                Try a different name, company, email, or domain.
              </div>
            </div>
          )}

          {contactResults.length > 0 && (
            <div>
              <div style={{
                padding: '10px 16px 6px',
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: T.textFaint,
              }}>
                Contacts
              </div>
              {contactResults.map((contact) => {
                const idx = resultIndex++;
                const name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unknown';
                const subtitle = [contact.title, contact.company].filter(Boolean).join(' · ');
                const isHighlighted = idx === highlightIndex;
                return (
                  <div
                    key={`c-${contact.id}`}
                    id={`qs-item-${idx}`}
                    role="option"
                    aria-selected={isHighlighted}
                    onClick={() => openContact(contact)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      cursor: 'pointer',
                      background: isHighlighted ? (T.isDark ? '#ffffff08' : '#00000006') : 'transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    {contact.photo_url ? (
                      <img
                        src={contact.photo_url}
                        alt=""
                        style={{
                          width: 34, height: 34, borderRadius: '50%',
                          objectFit: 'cover', flexShrink: 0,
                        }}
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      />
                    ) : null}
                    <div
                      style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: `${getAvatarColor(name)}20`,
                        border: `1px solid ${getAvatarColor(name)}40`,
                        display: contact.photo_url ? 'none' : 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: getAvatarColor(name),
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(name)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {name}
                      </div>
                      {subtitle && (
                        <div style={{ fontSize: 12, color: T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                          {subtitle}
                        </div>
                      )}
                    </div>
                    <User size={14} color={T.textFaint} style={{ flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )}

          {companyResults.length > 0 && (
            <div>
              {contactResults.length > 0 && (
                <div style={{ borderTop: `1px solid ${T.border}`, margin: '4px 0' }} />
              )}
              <div style={{
                padding: '10px 16px 6px',
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: T.textFaint,
              }}>
                Companies
              </div>
              {companyResults.map((company) => {
                const idx = resultIndex++;
                const name = company.name || company.company_name || 'Unknown';
                const secondary = [company.industry, company.domain || company.website].filter(Boolean).join(' · ');
                const isHighlighted = idx === highlightIndex;
                return (
                  <div
                    key={`co-${company.id}`}
                    id={`qs-item-${idx}`}
                    role="option"
                    aria-selected={isHighlighted}
                    onClick={() => openCompany(company)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      cursor: 'pointer',
                      background: isHighlighted ? (T.isDark ? '#ffffff08' : '#00000006') : 'transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%',
                      background: `${BRAND.cyan}15`,
                      border: `1px solid ${BRAND.cyan}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, color: BRAND.cyan,
                      flexShrink: 0,
                    }}>
                      {getInitials(name)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {name}
                      </div>
                      {secondary && (
                        <div style={{ fontSize: 12, color: T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                          {secondary}
                        </div>
                      )}
                    </div>
                    <Building2 size={14} color={T.textFaint} style={{ flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )}

          {searchLoading && hasResults && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '8px 16px', borderTop: `1px solid ${T.border}`,
              color: T.textFaint, fontSize: 11,
            }}>
              <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
              Loading more...
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes qsFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
