/**
 * sidebarSlots — places in the sidebar that the active module may fill.
 *
 * The sidebar (Layer 1) stays a flat list of destinations: it knows nothing
 * about what is inside a module. Where a module is allowed its own entries
 * under its sidebar item, the sidebar draws one EMPTY element there, only
 * while that module is the active one and there is room for it, and registers
 * that element here. The module, which already holds its own data, draws into
 * it. So the sidebar loads nothing for the module, and a module that is not
 * open costs nothing.
 *
 * Today there is one such place: under Contact Hub (the approved exception to
 * the sidebar's "no nesting" rule; see Sidebar.jsx).
 *
 * A tiny store rather than context, so the module does not depend on where
 * the shell's providers sit and a page rendered without the sidebar simply
 * finds no slot.
 */
import { useSyncExternalStore } from 'react';

const slots = new Map();
const listeners = new Set();

/** Called by the sidebar's ref: the element, or null when it is removed. */
export function setSidebarSlot(id, element) {
  const current = slots.get(id) ?? null;
  const next = element ?? null;
  if (current === next) return;
  if (next) slots.set(id, next); else slots.delete(id);
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The element to draw into, or null when the sidebar is not offering one. */
export function useSidebarSlot(id) {
  return useSyncExternalStore(subscribe, () => slots.get(id) ?? null, () => null);
}
