/**
 * The one keyboard shortcut the shell owns: ⌘K on Mac, Ctrl+K everywhere else.
 *
 * Lives beside CommandBar rather than inside it so the component file exports
 * only a component (fast refresh), and so the match rule can be tested without
 * mounting an overlay.
 *
 * Conflicts, as of the global command bar sprint: none. The only pre-existing
 * modifier shortcuts in the app are Cmd/Ctrl+Z (Scout → Saved Companies undo)
 * and Cmd/Ctrl+Enter (ICP messaging flow and service profile setup, both
 * "next"). Alt is excluded so a future Alt-modified binding stays available.
 */
export function isCommandBarShortcut(e) {
  return Boolean(e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K');
}

export default isCommandBarShortcut;
