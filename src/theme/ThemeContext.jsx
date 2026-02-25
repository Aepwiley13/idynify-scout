/**
 * src/theme/ThemeContext.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Global theme context. Provides the active theme token set (T) and a setter.
 * Theme preference persists to localStorage as 'idynify_theme' ('light'|'dark').
 * Firestore is used as secondary persistence (keeps existing user prefs in sync).
 *
 * Default: 'light' (workspace theme) on first visit.
 *
 * Usage:
 *   const T = useT();                              // get current theme token set
 *   const { themeId, setThemeId } = useThemeCtx(); // change theme
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { THEMES } from "./tokens";

const LS_KEY = "idynify_theme";

/** Map localStorage string ('light'|'dark') → internal themeId */
function lsToThemeId(lsVal) {
  if (lsVal === "dark") return "mission";
  return "workspace"; // 'light' or no value → light default
}

/** Map internal themeId → localStorage string ('light'|'dark') */
function themeIdToLs(themeId) {
  return THEMES[themeId]?.isDark ? "dark" : "light";
}

// ─── Context ──────────────────────────────────────────────────────────────────
export const ThemeCtx = createContext({
  T: THEMES.workspace,
  themeId: "workspace",
  setThemeId: () => {},
});

export const useT = () => useContext(ThemeCtx).T;
export const useThemeCtx = () => useContext(ThemeCtx);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  // Initialize from localStorage; fall back to 'workspace' (light) if unset
  const [themeId, setThemeIdState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return lsToThemeId(stored);
    } catch {
      return "workspace";
    }
  });

  // Apply body class whenever theme changes
  useEffect(() => {
    const isDark = THEMES[themeId]?.isDark ?? false;
    document.body.classList.toggle("theme-dark", isDark);
    document.body.classList.toggle("theme-light", !isDark);
  }, [themeId]);

  // Load from Firestore only when localStorage has no value yet (first-ever visit)
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const stored = localStorage.getItem(LS_KEY);
        if (stored) return; // localStorage already set — don't override

        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const prefs = userDoc.data()?.preferences;
          if (prefs?.theme && THEMES[prefs.theme]) {
            const id = prefs.theme;
            setThemeIdState(id);
            localStorage.setItem(LS_KEY, themeIdToLs(id));
          }
        }
      } catch (err) {
        console.error("ThemeProvider: failed to load theme preference", err);
      }
    };
    loadTheme();
  }, []);

  // Change theme: persist to localStorage (primary) + Firestore (secondary)
  const setThemeId = useCallback(async (id) => {
    if (!THEMES[id]) return;
    setThemeIdState(id);
    try {
      localStorage.setItem(LS_KEY, themeIdToLs(id));
    } catch {
      // ignore storage errors
    }
    try {
      const user = auth.currentUser;
      if (!user) return;
      await setDoc(
        doc(db, "users", user.uid),
        { preferences: { theme: id } },
        { merge: true }
      );
    } catch (err) {
      console.error("ThemeProvider: failed to save theme preference", err);
    }
  }, []);

  const T = THEMES[themeId] ?? THEMES.workspace;

  return (
    <ThemeCtx.Provider value={{ T, themeId, setThemeId }}>
      {children}
    </ThemeCtx.Provider>
  );
}
