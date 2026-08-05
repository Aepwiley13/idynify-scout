/**
 * ShellContext — the contract between the global shell and whatever it renders.
 *
 * Replaces MainLayout's React.cloneElement prop injection, which could only
 * reach a direct child and therefore stopped working the moment routes became
 * <Outlet/> children. Context reaches any depth, so Contact Profile and Quick
 * Engage can talk to shell-owned Barry without prop drilling through Scout.
 *
 * Two things live here:
 *
 *   1. Shell-owned Barry controls (open/close, orientation, page KPI context)
 *   2. The Phase 7 navigation context contract passed to Barry on every message
 *
 * The contract's shape is fixed by the brief:
 *
 *   user_id · organization_id · current_module · current_route ·
 *   current_entity_type · current_entity_id · current_pipeline_stage ·
 *   current_action · source_route · navigation_history
 *
 * The shell derives route-shaped fields itself. Modules contribute only what
 * the shell cannot know — which entity is open, and what the user is doing to
 * it — via useShellEntity() and useShellAction().
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { useLocation } from 'react-router-dom';
import { resolveModule } from '../constants/navigationModel';

const ShellContext = createContext(null);

/** How many prior routes the contract carries. Enough for "how did I get here". */
const NAV_HISTORY_LIMIT = 10;

/** Module-level constant so resetting entity state is referentially stable. */
const EMPTY_ENTITY = Object.freeze({ type: null, id: null, stage: null, label: null });

/**
 * Consume the shell. Safe to call from routes rendered outside the shell —
 * returns a null-object so out-of-scope modules (Hunter, Sniper, Recon, …)
 * can call it without crashing during the incremental migration.
 */
export function useShell() {
  return useContext(ShellContext) ?? FALLBACK_SHELL;
}

/** No-op shell for routes that are not yet inside the migration. */
const FALLBACK_SHELL = {
  inShell: false,
  shellUser: null,
  updateDisplayName: () => {},
  barryOpen: false,
  openBarry: () => {},
  closeBarry: () => {},
  toggleBarry: () => {},
  orientation: { status: 'idle', brief: null, suggestedPrompts: [], mode: null, error: null },
  setBarryPageContext: () => {},
  navigationContext: null,
  setEntityContext: () => {},
  clearEntityContext: () => {},
  setCurrentAction: () => {},
  announce: () => {},
  announcements: [],
  dismissAnnouncement: () => {},
  quickEngage: null,
  openQuickEngage: () => {},
  closeQuickEngage: () => {},
  sidebarMode: 'wide',
  toggleSidebar: () => {},
  arrival: null,
  setArrival: () => {},
  clearArrival: () => {},
};

/** Nothing arrived. Frozen so resetting arrival state is referentially stable. */
const NO_ARRIVAL = Object.freeze({
  intent: null,
  originModuleId: null,
  sessionKey: null,
  memoryLoaded: false,
});

/**
 * Sidebar mode is shell state, not sidebar state.
 *
 * The sidebar is position:fixed, so the content area is offset by margin —
 * which means MainLayout has to know the width too. Keeping the mode in one
 * place stops the sidebar and the content boundary from ever disagreeing
 * about how wide the sidebar currently is.
 */
const SIDEBAR_MODE_KEY = 'idynify_sidebar_mode';

function readSidebarMode() {
  try {
    return localStorage.getItem(SIDEBAR_MODE_KEY) === 'compact' ? 'compact' : 'wide';
  } catch {
    return 'wide'; // private mode / storage disabled — wide is the default
  }
}

export function ShellProvider({ children, user, userData }) {
  const location = useLocation();

  // Display-name override, applied after Settings saves one. See shellUser
  // below for why this exists.
  const [displayNameOverride, setDisplayNameOverride] = useState(null);
  const updateDisplayName = useCallback((name) => {
    setDisplayNameOverride(name?.trim() || '');
  }, []);

  // ── Barry shell state ───────────────────────────────────────────────────
  const [barryOpen, setBarryOpen] = useState(false);
  const [orientation, setOrientation] = useState({
    status: 'loading',
    brief: null,
    suggestedPrompts: [],
    mode: null,
    error: null,
  });
  const [barryPageContext, setBarryPageContext] = useState({
    kpiContext: {},
    kpiContextReady: false,
  });

  // ── Contract fields the shell cannot derive from the route ──────────────
  // `label` is beyond the contract's required minimum. The breadcrumb needs a
  // human name for the open entity ("Sarah Chen"), and the module is the only
  // thing that knows it. Carried alongside rather than in a second store.
  const [entity, setEntity] = useState(EMPTY_ENTITY);
  const [currentAction, setCurrentAction] = useState(null);

  // ── Arrival: the ephemeral "why am I here" ──────────────────────────────
  // Set by the canonical Contact and Company pages from router state, read by
  // the breadcrumb and by Barry. Deliberately shell state and not a contact
  // field: the reason a screen opened belongs to the navigation, not to the
  // person. It is cleared on every pathname change alongside entity context,
  // so an intent cannot follow the user to an unrelated screen.
  const [arrival, setArrivalState] = useState(NO_ARRIVAL);

  // Quick Engage drawer — shell-owned, see openQuickEngage below.
  const [quickEngage, setQuickEngage] = useState(null);

  // Wide (220px) or compact (64px). Persisted, so it survives navigation and
  // reload — a layout preference the user set should not reset on them.
  const [sidebarMode, setSidebarMode] = useState(readSidebarMode);

  const toggleSidebar = useCallback(() => {
    setSidebarMode(prev => {
      const next = prev === 'wide' ? 'compact' : 'wide';
      try { localStorage.setItem(SIDEBAR_MODE_KEY, next); } catch { /* storage disabled */ }
      return next;
    });
  }, []);

  // ── Route bookkeeping ───────────────────────────────────────────────────
  // Done DURING RENDER, not in an effect. This is React's documented
  // "adjusting state when a prop changes" pattern, and it is the right one
  // here for a specific reason: navigationContext is assembled during render.
  // If history were appended in an effect, the contract built in this same
  // render would still hold the previous route — source_route would lag one
  // navigation behind and Barry would be told the wrong origin. Adjusting
  // during render means the contract is correct on the first render after a
  // navigation, with no cascading effect pass.
  //
  // The `!==` guard is what makes this terminate: after React re-runs the
  // component, currentPath matches and nothing is set again.
  const currentPath = location.pathname + (location.search || '');

  const [nav, setNav] = useState(() => ({
    path: currentPath,
    pathname: location.pathname,
    history: [currentPath],
  }));

  if (nav.path !== currentPath) {
    const pathnameChanged = nav.pathname !== location.pathname;

    setNav({
      path: currentPath,
      pathname: location.pathname,
      history: [...nav.history, currentPath].slice(-NAV_HISTORY_LIMIT),
    });

    // Entity context is per-screen. Clearing it when the pathname changes
    // stops a stale contact id from following the user into an unrelated
    // module — the class of bug that has Barry answer about the wrong person.
    // A query-only change (a Scout tab switch) is not a screen change, so
    // this deliberately keys on pathname, not the full path.
    if (pathnameChanged) {
      setEntity(EMPTY_ENTITY);
      setCurrentAction(null);
      // A drawer must never outlive the screen it was opened over.
      setQuickEngage(null);
      // Neither must an arrival. The canonical page re-declares it on mount
      // from the new location's state; if there is none, there was none.
      setArrivalState(NO_ARRIVAL);
    }
  }

  // The route before the current one. Derived from the same array it came
  // from, so the two can never disagree.
  const sourceRoute = nav.history.length > 1 ? nav.history[nav.history.length - 2] : null;

  // ── Stage-transition announcements ──────────────────────────────────────
  // "Barry acknowledges meaningful stage transitions when useful — does not
  // narrate every click." Only explicit announce() calls land here; routine
  // navigation never produces one.
  const [announcements, setAnnouncements] = useState([]);

  const announce = useCallback((event) => {
    if (!event?.message) return;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...event,
    };
    setAnnouncements(prev => [...prev, entry].slice(-5));
  }, []);

  const dismissAnnouncement = useCallback((id) => {
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  }, []);

  // ── Barry open/close ────────────────────────────────────────────────────
  const returnFocusRef = useRef(null);

  const openBarry = useCallback((opts = {}) => {
    if (opts.returnFocusTo) returnFocusRef.current = opts.returnFocusTo;
    if (opts.action) setCurrentAction(opts.action);
    setBarryOpen(true);
  }, []);

  const closeBarry = useCallback(() => {
    setBarryOpen(false);
    returnFocusRef.current?.focus?.();
  }, []);

  const toggleBarry = useCallback((opts = {}) => {
    setBarryOpen(prev => {
      if (prev) {
        returnFocusRef.current?.focus?.();
        return false;
      }
      if (opts.returnFocusTo) returnFocusRef.current = opts.returnFocusTo;
      return true;
    });
  }, []);

  const setEntityContext = useCallback((next) => {
    setEntity(prev => {
      const merged = {
        type: next?.type ?? null,
        id: next?.id ?? null,
        stage: next?.stage ?? null,
        label: next?.label ?? null,
      };
      if (
        prev.type === merged.type &&
        prev.id === merged.id &&
        prev.stage === merged.stage &&
        prev.label === merged.label
      ) {
        return prev; // referential stability — avoids a render loop from effects
      }
      return merged;
    });
  }, []);

  const clearEntityContext = useCallback(() => {
    setEntity(EMPTY_ENTITY);
  }, []);

  const setArrival = useCallback((next) => {
    setArrivalState(prev => {
      const merged = {
        intent: next?.intent ?? null,
        originModuleId: next?.originModuleId ?? null,
        sessionKey: next?.sessionKey ?? null,
        memoryLoaded: Boolean(next?.memoryLoaded),
      };
      if (
        prev.intent === merged.intent &&
        prev.originModuleId === merged.originModuleId &&
        prev.sessionKey === merged.sessionKey &&
        prev.memoryLoaded === merged.memoryLoaded
      ) {
        return prev; // referential stability — effects depend on this object
      }
      return merged;
    });
  }, []);

  const clearArrival = useCallback(() => setArrivalState(NO_ARRIVAL), []);

  // ── Quick Engage ────────────────────────────────────────────────────────
  // Shell-owned so it can open from a Scout row or from Contact Profile and
  // overlay whatever is underneath without touching global navigation. The
  // underlying screen is never unmounted, so closing restores exact context —
  // no scroll, filter or selection state to rebuild.
  const openQuickEngage = useCallback((contact, opts = {}) => {
    if (!contact?.id) return;
    if (opts.returnFocusTo) returnFocusRef.current = opts.returnFocusTo;
    setQuickEngage({ contact, channel: opts.channel ?? null, origin: opts.origin ?? null });
    setCurrentAction('quick_engage');
  }, []);

  const closeQuickEngage = useCallback(() => {
    setQuickEngage(null);
    setCurrentAction(null);
    returnFocusRef.current?.focus?.();
  }, []);

  // ── The contract ────────────────────────────────────────────────────────
  const module = resolveModule(location.pathname);

  const navigationContext = useMemo(() => ({
    user_id: user?.id || user?.uid || null,

    // SCHEMA DRIFT — documented, not invented.
    // Idynify has no tenant/organization model today; all data is scoped
    // users/{uid}/… and `organization_id` elsewhere in the codebase refers to
    // Apollo prospect companies, not the account's org. The field is carried
    // because the contract specifies it, and reads from userData if an org
    // model lands later. See PHASE7_BARRY_CONTEXT_CONTRACT.md.
    organization_id: userData?.organizationId ?? userData?.tenantId ?? null,

    current_module: module.id,
    current_route: location.pathname + (location.search || ''),
    current_entity_type: entity.type,
    current_entity_id: entity.id,
    current_pipeline_stage: entity.stage,
    current_action: currentAction,
    source_route: sourceRoute,
    navigation_history: nav.history,

    // Beyond the required minimum — drives the shell breadcrumb.
    entity_label: entity.label,

    // ── Arrival (ephemeral) ───────────────────────────────────────────────
    // This is what lets Barry open with "the follow-up here is overdue —
    // that's why Mission Control surfaced this" instead of "how can I help".
    // It travels to Barry on every message and is never written to Firestore;
    // the contact record holds the OUTCOME of what the user does next, not the
    // reason the screen was opened.
    entry_point: arrival.intent?.entryPoint ?? null,
    arrival_reason: arrival.intent?.reason ?? null,
    recommended_action: arrival.intent?.recommendedAction ?? null,
    return_to: arrival.intent?.returnTo ?? null,
    source_module: arrival.originModuleId ?? null,

    // Barry's session key for this screen — contact-scoped memory, with a
    // separate session beneath it per originating module. See decision 6 of
    // the sprint brief and docs/STATUS_ARCHITECTURE.md.
    barry_session_key: arrival.sessionKey ?? null,
    barry_memory_loaded: arrival.memoryLoaded,
  }), [
    user?.id, user?.uid,
    userData?.organizationId, userData?.tenantId,
    module.id,
    location.pathname, location.search,
    entity.type, entity.id, entity.stage, entity.label,
    currentAction,
    sourceRoute, nav.history,
    arrival,
  ]);

  /**
   * The signed-in user, as the chrome should render them right now.
   *
   * `user` comes from App, which reads users/{uid} once when auth resolves and
   * does not read it again. So saving a display name in Settings would not
   * reach the top bar until a reload — you would type your name, press Save,
   * see "Saved", and watch the corner keep calling you something else.
   *
   * Settings calls updateDisplayName() after a successful write and the
   * override applies until the next auth-driven read supersedes it. It is a
   * display concern only; Firestore is still the source of truth, and this
   * never writes.
   */
  const shellUser = useMemo(() => (
    displayNameOverride == null ? user : { ...user, displayName: displayNameOverride }
  ), [user, displayNameOverride]);

  const value = useMemo(() => ({
    inShell: true,
    shellUser,
    updateDisplayName,
    barryOpen,
    openBarry,
    closeBarry,
    toggleBarry,
    orientation,
    setOrientation,
    barryPageContext,
    setBarryPageContext,
    navigationContext,
    setEntityContext,
    clearEntityContext,
    setCurrentAction,
    announce,
    announcements,
    dismissAnnouncement,
    quickEngage,
    openQuickEngage,
    closeQuickEngage,
    sidebarMode,
    toggleSidebar,
    arrival,
    setArrival,
    clearArrival,
  }), [
    shellUser, updateDisplayName,
    barryOpen, openBarry, closeBarry, toggleBarry,
    orientation, barryPageContext,
    navigationContext, setEntityContext, clearEntityContext,
    announce, announcements, dismissAnnouncement,
    quickEngage, openQuickEngage, closeQuickEngage,
    sidebarMode, toggleSidebar,
    arrival, setArrival, clearArrival,
  ]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/**
 * Declare the entity this screen is about.
 *
 * Contact Profile calls this with the open contact so Barry knows who is on
 * screen without the module having to reach into Barry. Clears on unmount so
 * closing a panel returns the contract to the list-level view.
 *
 *   useShellEntity({ type: 'contact', id: contact.id, stage: contact.stage });
 */
export function useShellEntity({ type, id, stage, label } = {}) {
  const { setEntityContext, clearEntityContext } = useShell();

  useEffect(() => {
    if (!id) return undefined;
    setEntityContext({ type, id, stage, label });
    return () => clearEntityContext();
  }, [type, id, stage, label, setEntityContext, clearEntityContext]);
}

/**
 * Declare the arrival this screen was opened by.
 *
 * Called by the canonical Contact and Company pages with the intent read from
 * router state. Clears on unmount, so leaving the record takes the reason with
 * it — an arrival is a property of a navigation, not of a session.
 */
export function useArrival({ intent, originModuleId, sessionKey, memoryLoaded } = {}) {
  const { setArrival, clearArrival } = useShell();

  useEffect(() => {
    if (!intent && !originModuleId) return undefined;
    setArrival({ intent, originModuleId, sessionKey, memoryLoaded });
    return () => clearArrival();
  }, [intent, originModuleId, sessionKey, memoryLoaded, setArrival, clearArrival]);
}

/**
 * Declare what the user is currently doing — 'quick_engage', 'composing', …
 * Clears on unmount so a closed drawer stops claiming the action.
 */
export function useShellAction(action) {
  const { setCurrentAction } = useShell();

  useEffect(() => {
    if (!action) return undefined;
    setCurrentAction(action);
    return () => setCurrentAction(null);
  }, [action, setCurrentAction]);
}

export default ShellContext;
