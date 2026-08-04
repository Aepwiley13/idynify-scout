/**
 * CommandBar — the global search overlay. ⌘K from anywhere.
 *
 * Mounted once by MainLayout, above every route, so it is reachable from
 * Mission Control, Scout, Hunter, Sniper, Basecamp, Recon, Reinforcements,
 * Fallback and Command Center alike without any module knowing it exists.
 *
 * It owns the overlay and nothing else. Every piece of search behaviour —
 * the workspace-scoped Firestore reads, the session cache, the debounce, the
 * stale-response guard, the ranking, the arrow-key cursor, the record
 * destinations — comes from useQuickSearch, the same hook Mission Control's
 * inline Quick Search uses. There is no second search implementation.
 *
 * The component stays mounted while closed: the ⌘K listener lives here, so
 * unmounting it would take the shortcut with it. Closed means "render no
 * panel", not "go away".
 *
 * Escape is handled in the CAPTURE phase and stopped there. Several pages
 * (Mission Control's dossier, for one) listen for Escape on window, and
 * without this a single Escape would close the overlay AND clear whatever was
 * open behind it.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import useQuickSearch, { MIN_QUERY_LENGTH } from '../search/useQuickSearch';
import SearchResults from '../search/SearchResults';
import { isCommandBarShortcut } from './commandBarShortcut';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CommandBar({ isOpen, onOpen, onClose }) {
  const T = useT();
  const [inputFocused, setInputFocused] = useState(true);

  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const previousFocusRef = useRef(null);
  // Set when a result was chosen, so close() knows not to yank focus back off
  // the record the user just opened.
  const navigatedRef = useRef(false);

  const close = useCallback(() => { onClose(); }, [onClose]);

  const {
    inputValue,
    setInputValue,
    contactResults,
    companyResults,
    searchLoading,
    searchError,
    highlightIndex,
    setHighlightIndex,
    totalResults,
    reset,
    openContact,
    openCompany,
    handleListKeyDown,
  } = useQuickSearch({
    onNavigate: () => {
      navigatedRef.current = true;
      close();
    },
  });

  // ⌘K / Ctrl+K. One listener for the life of the shell — this component never
  // unmounts, and the effect has no reactive dependencies, so it is registered
  // exactly once no matter how often the shell re-renders.
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  useEffect(() => {
    function onKeyDown(e) {
      if (!isCommandBarShortcut(e)) return;
      e.preventDefault();
      onOpenRef.current();
      // Already open: put the caret back where the user expects it.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Open: remember what had focus, focus the input, and stop the page behind
  // from scrolling. Close: restore both.
  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;
    navigatedRef.current = false;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus after paint so the input exists.
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      reset();
      const previous = previousFocusRef.current;
      if (!navigatedRef.current && previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [isOpen, reset]);

  // Escape, captured before any page-level handler can also act on it.
  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const showResults = inputValue.trim().length >= MIN_QUERY_LENGTH;

  function handleKeyDown(e) {
    // Tab walks the results while any are showing — focus stays in the input,
    // which is what aria-activedescendant expects. With no results to walk,
    // Tab wraps inside the panel so focus cannot escape to the page behind.
    if (e.key === 'Tab') {
      if (showResults && totalResults > 0) {
        e.preventDefault();
        setHighlightIndex(prev => {
          const next = e.shiftKey ? prev - 1 : prev + 1;
          if (next >= totalResults) return 0;
          if (next < 0) return totalResults - 1;
          return next;
        });
        return;
      }

      const items = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    handleListKeyDown(e);
  }

  return (
    <div
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        // Slightly above vertical centre, and never crowding a short viewport.
        paddingTop: 'max(12vh, 64px)',
        paddingLeft: 16,
        paddingRight: 16,
        background: T.isDark ? '#00000099' : '#0f0f1499',
        backdropFilter: 'blur(2px)',
        animation: 'cmdBackdropIn 0.12s ease-out',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search contacts and companies"
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          maxWidth: 600,
          maxHeight: 'min(70vh, 560px)',
          display: 'flex',
          flexDirection: 'column',
          background: T.cardBg,
          border: `1px solid ${T.border2}`,
          borderRadius: 14,
          boxShadow: `0 24px 64px ${T.isDark ? '#000000b0' : '#00000026'}`,
          overflow: 'hidden',
          animation: 'cmdPanelIn 0.14s ease-out',
        }}
      >
        <div style={{
          position: 'relative',
          flexShrink: 0,
          borderBottom: showResults ? `1px solid ${T.border}` : 'none',
        }}>
          <Search
            size={18}
            color={T.textFaint}
            style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={showResults}
            aria-haspopup="listbox"
            aria-controls="command-bar-results"
            aria-autocomplete="list"
            aria-activedescendant={highlightIndex >= 0 ? `cmd-item-${highlightIndex}` : undefined}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Search contacts or companies..."
            style={{
              width: '100%',
              padding: '18px 18px 18px 48px',
              border: 'none',
              borderRadius: 14,
              background: 'transparent',
              color: T.text,
              fontSize: 16,
              outline: 'none',
              boxSizing: 'border-box',
              // Inset accent ring rather than a browser outline: the input
              // fills the panel's rounded top row, where an outline would
              // trace a rectangle across the corner radius.
              boxShadow: inputFocused ? `inset 0 0 0 1.5px ${T.accentBdr}` : 'none',
              transition: 'box-shadow 0.15s',
            }}
          />
        </div>

        {showResults && (
          <div
            id="command-bar-results"
            role="listbox"
            aria-label="Search results"
            style={{ overflowY: 'auto', flex: 1 }}
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
              idPrefix="cmd"
              size="comfortable"
            />
          </div>
        )}

        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '8px 18px',
          borderTop: `1px solid ${T.border}`,
          background: T.surface,
          color: T.textFaint,
          fontSize: 11,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={kbdStyle(T)}>↑</kbd><kbd style={kbdStyle(T)}>↓</kbd> navigate
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={kbdStyle(T)}><CornerDownLeft size={10} /></kbd> open
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={kbdStyle(T)}>esc</kbd> close
          </span>
        </div>
      </div>

      <style>{`
        @keyframes cmdBackdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes cmdPanelIn {
          from { opacity: 0; transform: scale(0.98); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function kbdStyle(T) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    padding: '0 4px',
    borderRadius: 4,
    border: `1px solid ${T.border2}`,
    background: T.input,
    color: T.textMuted,
    fontSize: 10,
    fontFamily: 'inherit',
  };
}
