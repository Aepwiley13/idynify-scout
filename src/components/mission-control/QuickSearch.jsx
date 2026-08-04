/**
 * QuickSearch — Mission Control's inline search field (PR #506).
 *
 * Option A of the global command bar sprint: this stays exactly as it was,
 * table-adjacent in the filter row, and the ⌘K overlay is an additional entry
 * point rather than a replacement. What changed here is only where the code
 * lives — the Firestore reads, cache, debounce, ranking and arrow-key cursor
 * moved into useQuickSearch, and the rows moved into SearchResults, so the
 * overlay reuses them instead of copying them. Behaviour, markup ids and
 * styling are unchanged.
 *
 * This component now owns just the inline concerns: the compact input, the
 * clear button, the dropdown's position and its open/closed rule.
 */

import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import useQuickSearch, { MIN_QUERY_LENGTH } from '../search/useQuickSearch';
import SearchResults from '../search/SearchResults';

export default function QuickSearch() {
  const T = useT();
  const [isOpen, setIsOpen] = useState(false);

  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const {
    inputValue,
    setInputValue,
    contactResults,
    companyResults,
    searchLoading,
    searchError,
    highlightIndex,
    setHighlightIndex,
    openContact,
    openCompany,
    handleListKeyDown,
  } = useQuickSearch({ onNavigate: () => setIsOpen(false) });

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleKeyDown(e) {
    if (!isOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    handleListKeyDown(e);
  }

  const showPanel = isOpen && inputValue.trim().length >= MIN_QUERY_LENGTH;

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
            if (inputValue.trim().length >= MIN_QUERY_LENGTH) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search contacts or companies..."
          style={{
            width: '100%',
            padding: '10px 36px 10px 36px',
            borderRadius: 10,
            border: `1.5px solid ${isOpen && inputValue.trim().length >= MIN_QUERY_LENGTH ? BRAND.pink + '60' : T.border2}`,
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
          <SearchResults
            contactResults={contactResults}
            companyResults={companyResults}
            searchLoading={searchLoading}
            searchError={searchError}
            highlightIndex={highlightIndex}
            onHighlight={setHighlightIndex}
            onSelectContact={openContact}
            onSelectCompany={openCompany}
            T={T}
            idPrefix="qs"
            size="compact"
          />
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
