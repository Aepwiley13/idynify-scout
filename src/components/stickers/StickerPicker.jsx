/**
 * StickerPicker — choose a sticker, or create one (UI spec §1.2).
 *
 * The combobox pattern: the search box is a combobox that owns a listbox;
 * arrow keys move through enabled options, Enter chooses, Escape closes. The
 * listbox is multi-select in meaning: stickers already on the contact are
 * aria-selected and cannot be added again.
 *
 * Desktop: a popover beside its button. placement 'auto' (the default) opens
 * it below, or above when the space below — inside the viewport and every
 * scrolling ancestor — is too short and there is more room above. Phone-sized
 * screens (the app's one breakpoint, useIsMobile): a bottom sheet that keeps
 * focus inside it, portaled to <body> so it layers above the app's bottom nav.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { STICKER_NAME_MAX } from '../../services/stickers/stickerCore';
import { buildPickerOptions } from './stickerPickerOptions';
import { shouldOpenAbove } from './pickerPlacement';
import { hexOf } from './stickerPalette';
import { LIMIT_MESSAGE } from './stickerMessages';
import './stickers.css';

const GROUP_LABELS = { recent: 'Recent', all: 'All stickers' };

export default function StickerPicker({
  stickers,
  assignedIds = new Set(),
  recentIds = [],
  atLimit = false,
  allowCreate = true,
  onPick,
  onCreate,
  onClose,
  ignoreRef = null,
  label = 'Add a sticker',
  placement = 'auto',
}) {
  const T = useT();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [autoAbove, setAutoAbove] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const closeRef = useRef(null);
  const listId = useId();
  const optionId = (index) => `${listId}-option-${index}`;

  const options = useMemo(
    () => buildPickerOptions({ stickers, assignedIds, recentIds, query, atLimit, allowCreate }),
    [stickers, assignedIds, recentIds, query, atLimit, allowCreate],
  );
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  // The popover places itself (below or above), so focusing must not scroll
  // its container first: that would move the anchor before it is measured.
  useEffect(() => { inputRef.current?.focus(isMobile ? undefined : { preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 'auto': measure once, before paint, against the visible area.
  useLayoutEffect(() => {
    if (isMobile || placement !== 'auto' || !rootRef.current) return;
    setAutoAbove(shouldOpenAbove(rootRef.current));
  }, [isMobile, placement]);

  // A click outside closes the popover (the sheet has its own backdrop).
  useEffect(() => {
    if (isMobile) return undefined;
    const onDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      if (ignoreRef?.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isMobile, onClose, ignoreRef]);

  function choose(index) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.kind === 'create') onCreate(option.name);
    else onPick(option.sticker);
  }

  function move(step) {
    if (!enabled.length) return;
    const at = enabled.indexOf(activeIndex);
    if (at === -1) setActiveIndex(step > 0 ? enabled[0] : enabled[enabled.length - 1]);
    else setActiveIndex(enabled[Math.min(enabled.length - 1, Math.max(0, at + step))]);
  }

  function onKeyDown(event) {
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(1); break;
      case 'ArrowUp': event.preventDefault(); move(-1); break;
      case 'Home':
        if (activeIndex >= 0 && enabled.length) { event.preventDefault(); setActiveIndex(enabled[0]); }
        break;
      case 'End':
        if (activeIndex >= 0 && enabled.length) { event.preventDefault(); setActiveIndex(enabled[enabled.length - 1]); }
        break;
      case 'Enter': {
        event.preventDefault();
        if (activeIndex >= 0) choose(activeIndex);
        else {
          const last = options[options.length - 1];
          if (last && last.group === 'create') choose(options.length - 1);
        }
        break;
      }
      case 'Escape': event.preventDefault(); onClose(); break;
      case 'Tab':
        if (isMobile) {
          // Keep focus in the sheet: the search box and the close button.
          event.preventDefault();
          (document.activeElement === inputRef.current ? closeRef.current : inputRef.current)?.focus();
        } else {
          onClose();
        }
        break;
      default:
    }
  }

  let lastGroup = null;
  const list = (
    <ul
      id={listId}
      role="listbox"
      aria-label="Stickers"
      aria-multiselectable="true"
      className="stk-picker-list"
    >
      {options.map((option, index) => {
        const header = option.group !== lastGroup && GROUP_LABELS[option.group]
          ? <li key={`h-${option.group}`} role="presentation" className="stk-picker-group" style={{ color: T.textFaint }}>{GROUP_LABELS[option.group]}</li>
          : null;
        lastGroup = option.group;
        const active = index === activeIndex;
        return [
          header,
          <li
            key={option.key}
            id={optionId(index)}
            role="option"
            aria-selected={option.assigned ? 'true' : 'false'}
            aria-disabled={option.disabled ? 'true' : undefined}
            data-active={active ? 'true' : undefined}
            className={`stk-picker-option${option.disabled ? ' stk-picker-option--disabled' : ''}`}
            style={{ color: option.disabled ? T.textFaint : T.text, background: active ? T.rowHov : 'transparent' }}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
            onClick={() => choose(index)}
          >
            {option.kind === 'create' ? (
              <>
                <Plus size={12} aria-hidden="true" />
                <span>Create sticker &ldquo;{option.name}&rdquo;</span>
              </>
            ) : option.kind === 'existing' ? (
              <>
                <span className="stk-dot" style={{ background: hexOf(option.sticker.color) }} aria-hidden="true" />
                <span>&ldquo;{option.sticker.name}&rdquo; already exists — use it</span>
              </>
            ) : (
              <>
                <span className="stk-dot" style={{ background: hexOf(option.sticker.color) }} aria-hidden="true" />
                {option.sticker.emoji ? <span className="stk-picker-emoji" aria-hidden="true">{option.sticker.emoji}</span> : null}
                <span className="stk-picker-name">{option.sticker.name}</span>
                {option.assigned ? <Check size={12} className="stk-picker-check" aria-hidden="true" /> : null}
              </>
            )}
          </li>,
        ];
      })}
    </ul>
  );

  const empty = options.length === 0
    ? <p className="stk-picker-empty" style={{ color: T.textFaint }}>{stickers.length ? 'No sticker matches.' : 'No stickers yet. Type a name to create one.'}</p>
    : null;

  const body = (
    <>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        className="stk-picker-input"
        style={{ background: T.input, color: T.text, border: `1px solid ${T.border}` }}
        placeholder="Search or create…"
        maxLength={STICKER_NAME_MAX}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }}
        onKeyDown={onKeyDown}
      />
      {atLimit ? <p className="stk-picker-limit" style={{ color: T.textMuted }}>{LIMIT_MESSAGE}</p> : null}
      {list}
      {empty}
    </>
  );

  if (isMobile) {
    // Portaled: the sheet is position:fixed, but inside the page it would
    // share an ancestor's stacking context and sit under the bottom nav.
    // React events (Escape, Tab, clicks) still bubble through the React tree.
    return createPortal(
      <>
        <div className="stk-sheet-backdrop" onMouseDown={onClose} aria-hidden="true" />
        <div
          ref={rootRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="stk-picker stk-picker--sheet"
          style={{ background: T.cardBg, borderColor: T.border }}
        >
          <div className="stk-sheet-header">
            <span className="stk-sheet-title" style={{ color: T.text }}>{label}</span>
            <button ref={closeRef} type="button" className="stk-sheet-close" aria-label="Close" onClick={onClose} onKeyDown={onKeyDown}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {body}
        </div>
      </>,
      document.body,
    );
  }

  const above = placement === 'above' || (placement === 'auto' && autoAbove);

  return (
    <div
      ref={rootRef}
      className={`stk-picker stk-picker--popover${above ? ' stk-picker--above' : ''}`}
      style={{ background: T.cardBg, border: `1px solid ${T.border}`, boxShadow: `0 8px 24px ${T.isDark ? '#00000080' : '#00000018'}` }}
    >
      {body}
    </div>
  );
}
