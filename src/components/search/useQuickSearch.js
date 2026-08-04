/**
 * useQuickSearch — the search brain behind both search entry points.
 *
 * Extracted verbatim from QuickSearch.jsx (PR #506) when the global command
 * bar shipped. Nothing about the behaviour changed; it just stopped living
 * inside a component that also owned Mission Control's inline layout.
 *
 * What lives here: the Firestore reads, the session cache, the 300ms debounce,
 * the stale-response guard, the match filters and the exact → starts-with →
 * contains ranking, plus the arrow-key cursor and the routing on select.
 *
 * What does NOT live here: anything about where the input sits on screen, when
 * a panel is open, or how a row looks. Two containers consume this hook —
 * QuickSearch (inline, Mission Control) and CommandBar (overlay, global) — and
 * they disagree about all of that.
 *
 * Cache scope: per hook instance, as before. The overlay is mounted once for
 * the life of the shell and Mission Control's inline field for the life of the
 * page, so each still loads the workspace once per session. A shared
 * module-level cache would save one duplicate read and was deliberately not
 * taken: it would outlive both components and change PR #506's semantics.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUserId } from '../../context/ImpersonationContext';

export const MAX_RESULTS_PER_SECTION = 5;
export const MIN_QUERY_LENGTH = 2;

export function rankResults(items, term, nameGetter) {
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

/**
 * The user sees "Search could not be completed. Try again." — deliberately
 * vague, and useless to anyone debugging it. PR #506 caught these with a bare
 * `catch {}`, which discarded the only evidence that mattered: which of the
 * two queries failed, and why. Staging then hit exactly that wall.
 *
 * Firestore's error code is the whole diagnosis:
 *   permission-denied    → the path is not the signed-in user's (impersonation)
 *   failed-precondition  → a composite index is missing (message carries a link)
 *   unavailable          → offline or blocked
 */
function logSearchFailure(source, err, activeUserId) {
  console.error(
    `[quick-search] ${source} query failed`,
    { code: err?.code, message: err?.message, activeUserId, path: `users/${activeUserId}/${source}` },
    err
  );
}

export function contactName(contact) {
  return contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
}

export function companyName(company) {
  return company.name || company.company_name || '';
}

function filterContacts(contacts, term) {
  const lowerTerm = term.toLowerCase();
  const matches = [];
  for (const data of contacts) {
    const name = contactName(data).toLowerCase();
    const company = (data.company || '').toLowerCase();
    const email = (data.email || '').toLowerCase();
    const title = (data.title || '').toLowerCase();
    if (name.includes(lowerTerm) || company.includes(lowerTerm) ||
        email.includes(lowerTerm) || title.includes(lowerTerm)) {
      matches.push(data);
    }
  }
  return rankResults(matches, term, contactName).slice(0, MAX_RESULTS_PER_SECTION);
}

function filterCompanies(companies, term) {
  const lowerTerm = term.toLowerCase();
  const matches = companies.filter(c => {
    const name = companyName(c).toLowerCase();
    const domain = (c.domain || c.website || '').toLowerCase();
    const industry = (c.industry || '').toLowerCase();
    return name.includes(lowerTerm) || domain.includes(lowerTerm) || industry.includes(lowerTerm);
  });
  return rankResults(matches, term, companyName).slice(0, MAX_RESULTS_PER_SECTION);
}

/**
 * @param {object}   options
 * @param {Function} options.onNavigate  Called just before navigation fires, so
 *                                       the container can close itself.
 */
export default function useQuickSearch({ onNavigate } = {}) {
  const navigate = useNavigate();
  const activeUserId = useActiveUserId();

  const [inputValue, setInputValue] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [companyResults, setCompanyResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const querySeqRef = useRef(0);

  // Session-level caches: loaded once from Firestore on first search, reused
  // for all subsequent queries within this session.
  const contactCacheRef = useRef(null);
  const companyCacheRef = useRef(null);
  const contactLoadPromiseRef = useRef(null);
  const companyLoadPromiseRef = useRef(null);

  // Held in a ref so a container that passes an inline arrow function does not
  // force the navigation callbacks to be rebuilt on every render.
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);

  const allResults = [...contactResults, ...companyResults];
  const totalResults = allResults.length;
  const hasResults = totalResults > 0;

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
    promise.catch((err) => {
      logSearchFailure('contacts', err, activeUserId);
      contactLoadPromiseRef.current = null;
    });
    return promise;
  }, [activeUserId]);

  const loadCompanies = useCallback(() => {
    if (companyCacheRef.current) return Promise.resolve(companyCacheRef.current);
    if (companyLoadPromiseRef.current) return companyLoadPromiseRef.current;

    const promise = (async () => {
      if (!activeUserId) return [];
      const companiesRef = collection(db, 'users', activeUserId, 'companies');
      const q = query(companiesRef, where('status', '!=', 'archived'));
      const snap = await getDocs(q);
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      companyCacheRef.current = records;
      return records;
    })();

    companyLoadPromiseRef.current = promise;
    promise.catch((err) => {
      logSearchFailure('companies', err, activeUserId);
      companyLoadPromiseRef.current = null;
    });
    return promise;
  }, [activeUserId]);

  // Invalidate caches when user changes (e.g. impersonation switch).
  useEffect(() => {
    contactCacheRef.current = null;
    companyCacheRef.current = null;
    contactLoadPromiseRef.current = null;
    companyLoadPromiseRef.current = null;
  }, [activeUserId]);

  useEffect(() => {
    const term = inputValue.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      // Dropping below two characters clears the panel synchronously, so a
      // retype never flashes the previous query's rows. This is PR #506's
      // code unchanged; react-hooks/set-state-in-effect applies to custom
      // hooks but not to components, so it starts reporting purely because
      // the logic moved out of QuickSearch and into a hook. Rewriting the
      // whole debounce into derived state to satisfy it was out of scope for
      // an extraction whose job was to change nothing.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      } catch (err) {
        // Reached either because a loader rejected — already logged above with
        // its Firestore code — or because filtering threw on a malformed
        // record, which nothing else would report.
        console.error('[quick-search] search failed', { term, activeUserId }, err);
        if (seq !== querySeqRef.current) return;
        setSearchError(true);
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, loadContacts, loadCompanies, activeUserId]);

  const reset = useCallback(() => {
    setInputValue('');
    setContactResults([]);
    setCompanyResults([]);
    setSearchError(false);
    setSearchLoading(false);
    setHighlightIndex(-1);
    // Bump the sequence so an in-flight query cannot repopulate a cleared panel.
    querySeqRef.current++;
  }, []);

  const openContact = useCallback((contact) => {
    onNavigateRef.current?.();
    setInputValue('');
    navigate(`/scout/contact/${contact.id}`);
  }, [navigate]);

  const openCompany = useCallback((company) => {
    onNavigateRef.current?.();
    setInputValue('');
    navigate(`/scout/company/${company.id}`);
  }, [navigate]);

  function selectAt(index) {
    if (index < 0 || index >= totalResults) return;
    if (index < contactResults.length) {
      openContact(allResults[index]);
    } else {
      openCompany(allResults[index]);
    }
  }

  /**
   * Arrow / Enter handling shared by both containers. Escape is deliberately
   * NOT handled here — closing means something different inline than it does
   * in the overlay, so each container owns it.
   *
   * @returns {boolean} true when the key was consumed.
   */
  function handleListKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => {
        const next = prev + 1;
        return next >= totalResults ? 0 : next;
      });
      return true;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => {
        const next = prev - 1;
        return next < 0 ? totalResults - 1 : next;
      });
      return true;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0) selectAt(highlightIndex);
      return true;
    }

    return false;
  }

  return {
    inputValue,
    setInputValue,
    contactResults,
    companyResults,
    searchLoading,
    searchError,
    highlightIndex,
    setHighlightIndex,
    allResults,
    totalResults,
    hasResults,
    reset,
    openContact,
    openCompany,
    selectAt,
    handleListKeyDown,
  };
}
