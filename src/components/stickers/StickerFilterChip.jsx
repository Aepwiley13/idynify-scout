/**
 * The Sticker filter in People's filter row (S6, UI spec §2.1). Looks and
 * behaves like the Tag filter beside it: one sticker at a time, each listed
 * with how many people the current tab shows with it. Counts are worked out
 * in one pass when the list opens, from contacts People already loaded.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { useStickers } from './stickersRegistry';
import { countStickers } from './peopleStickers';
import { hexOf } from './stickerPalette';
import './stickers.css';

export default function StickerFilterChip({ selected, contacts, onSelect }) {
  const { ready, active } = useStickers();
  const T = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const counts = useMemo(() => (open ? countStickers(contacts, active) : null), [open, contacts, active]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    listRef.current?.querySelector('button')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!ready) return null;

  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  const choose = (sticker) => { onSelect(selected?.id === sticker.id ? null : sticker.id); close(); };

  function onListKeyDown(event) {
    const items = [...(listRef.current?.querySelectorAll('button') ?? [])];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[Math.min(items.length - 1, at + 1)]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[Math.max(0, at - 1)]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus(); }
  }

  return (
    <div className="stk-filter" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open ? 'true' : 'false'}
        aria-label={selected ? `Sticker filter: ${selected.name}` : 'Filter by sticker'}
        onClick={() => setOpen((o) => !o)}
        className="stk-filter-btn"
        style={{
          border: `1px solid ${selected ? T.accentBdr : T.border}`,
          background: selected ? T.accentBg : 'transparent',
          color: selected ? BRAND.pink : T.textFaint,
        }}
      >
        {selected ? <span className="stk-dot" style={{ background: hexOf(selected.color) }} aria-hidden="true" /> : <span className="stk-dot stk-dot--outline" aria-hidden="true" />}
        <span>{selected ? selected.name : 'Sticker'}</span>
        <ChevronDown size={9} style={{ opacity: 0.6 }} aria-hidden="true" />
      </button>
      {selected ? (
        <button type="button" className="stk-filter-clear" aria-label="Clear sticker filter" style={{ color: BRAND.pink }} onClick={() => onSelect(null)}>
          <X size={10} aria-hidden="true" />
        </button>
      ) : null}
      {open ? (
        <div
          ref={listRef}
          role="group"
          aria-label="Filter by sticker"
          className="stk-filter-pop"
          style={{ background: T.cardBg, border: `1px solid ${T.border}`, boxShadow: `0 8px 28px ${T.isDark ? '#00000080' : '#0000001a'}` }}
          onKeyDown={onListKeyDown}
        >
          <div className="stk-filter-title" style={{ color: T.textFaint }} aria-hidden="true">Filter by Sticker</div>
          {active.length === 0 ? (
            <div className="stk-filter-empty" style={{ color: T.textFaint }}>No stickers yet</div>
          ) : active.map((sticker) => {
            const isActive = selected?.id === sticker.id;
            const n = counts?.get(sticker.id) ?? 0;
            return (
              <button
                key={sticker.id}
                type="button"
                aria-pressed={isActive ? 'true' : 'false'}
                className="stk-filter-item"
                style={{
                  background: isActive ? T.accentBg : 'transparent',
                  color: isActive ? BRAND.pink : T.textMuted,
                  borderLeft: `3px solid ${isActive ? BRAND.pink : 'transparent'}`,
                  fontWeight: isActive ? 600 : 400,
                }}
                onClick={() => choose(sticker)}
              >
                <span className="stk-dot" style={{ background: hexOf(sticker.color) }} aria-hidden="true" />
                <span className="stk-filter-name">{sticker.name}</span>
                <span className="stk-filter-count" style={{ color: T.textFaint }} aria-hidden="true">{n}</span>
                <span className="stk-sr-only">{`, ${n} ${n === 1 ? 'person' : 'people'}`}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
