/**
 * UserMenu — the top bar's account control.
 *
 * Replaces what was there: the raw email address in a grey pill next to a
 * bordered "Log out" button, sitting alongside a separate Settings gear. Three
 * controls, one of which printed `aaron@utahadvocacycoalition.org` across the
 * top right of every screen.
 *
 * Now one control — avatar, display name, chevron — with the email demoted
 * into the dropdown where it identifies the account without announcing it, and
 * Settings, Theme and Log out gathered underneath it.
 *
 * Behaviour the dropdown has to get right, because a menu that traps you is
 * worse than no menu:
 *   · Escape closes and returns focus to the trigger
 *   · clicking outside closes
 *   · arrow keys move through items, Home/End jump to the ends
 *   · the trigger reports aria-expanded, the menu is a real role="menu"
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Settings, LogOut, Moon, Sun } from 'lucide-react';
import { displayNameFor, initialsFor } from '../../utils/userIdentity';
import { useThemeToggle } from '../../theme/useThemeToggle';

export default function UserMenu({ user, onLogout }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { isDark, nextLabel, toggleTheme } = useThemeToggle();

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const name = displayNameFor(user);
  const initials = initialsFor(user);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Close on outside click. Bound to the document while open only — a
  // permanently-bound listener on a control that is shut 99% of the time is
  // work on every click in the product.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Focus the first item when the menu opens, so keyboard users are not left
  // on the trigger with an open menu they have to tab into.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
  }, [open]);

  const onMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;

    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement);

    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = (index + 1) % items.length;
    else next = (index - 1 + items.length) % items.length;

    items[next].focus();
  };

  const run = (fn) => () => {
    // Close before acting: navigating with the menu still open leaves it
    // hanging over the page it just moved to.
    close(false);
    fn();
  };

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`user-menu-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name || user?.email || 'your account'}`}
      >
        <span className="user-menu-avatar" aria-hidden="true">{initials}</span>
        <span className="user-menu-name">{name || user?.email}</span>
        <ChevronDown size={15} className="user-menu-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="user-menu-dropdown"
          role="menu"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          aria-label="Account"
        >
          {/* The email lives here rather than in the top bar: it identifies
              which account you are in, which matters on exactly the occasions
              you open this menu and never the rest of the time. */}
          <div className="user-menu-email" title={user?.email}>{user?.email}</div>

          <div className="user-menu-sep" role="separator" />

          <button type="button" role="menuitem" className="user-menu-item" onClick={run(() => navigate('/settings'))}>
            <Settings size={15} aria-hidden="true" />
            <span>Settings</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={run(toggleTheme)}
          >
            {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            <span>{nextLabel}</span>
          </button>

          <div className="user-menu-sep" role="separator" />

          <button type="button" role="menuitem" className="user-menu-item danger" onClick={run(onLogout)}>
            <LogOut size={15} aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  );
}
