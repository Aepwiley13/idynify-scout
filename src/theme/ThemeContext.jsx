/**
 * src/theme/ThemeContext.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Global theme context. Provides the active theme token set (T) and a setter.
 * Theme preference persists to localStorage as 'idynify_theme' (full theme ID).
 * Firestore is used as secondary persistence (keeps existing user prefs in sync).
 *
 * Default: 'mission' (Space theme) on first visit.
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

/** Resolve a stored value (full themeId or legacy 'light'/'dark') → valid themeId */
function resolveThemeId(stored) {
  if (!stored) return "mission";
  if (THEMES[stored]) return stored;
  // Legacy: 'dark' → mission, 'light' → workspace
  if (stored === "dark")  return "mission";
  if (stored === "light") return "workspace";
  return "mission";
}

// ─── Context ──────────────────────────────────────────────────────────────────
export const ThemeCtx = createContext({
  T: THEMES.mission,
  themeId: "mission",
  setThemeId: () => {},
});

export const useT = () => useContext(ThemeCtx).T;
export const useThemeCtx = () => useContext(ThemeCtx);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  // Initialize from localStorage; fall back to 'mission' (Space) if unset
  const [themeId, setThemeIdState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return resolveThemeId(stored);
    } catch {
      return "mission";
    }
  });

  // Apply body class, data-theme attribute, and CSS custom properties whenever theme changes
  useEffect(() => {
    const theme = THEMES[themeId];
    const isDark = theme?.isDark ?? false;
    document.body.classList.toggle("theme-dark", isDark);
    document.body.classList.toggle("theme-light", !isDark);
    document.documentElement.setAttribute("data-theme", themeId);
    // Module-driven CSS variable for Barry's chakra glow color
    document.documentElement.style.setProperty("--barry-chakra-color", theme?.cyan || "#00c4cc");
  }, [themeId]);

  // Load from Firestore only when localStorage has no value yet (first-ever visit)
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const stored = localStorage.getItem(LS_KEY);
        if (stored && THEMES[resolveThemeId(stored)]) return; // localStorage already set

        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const prefs = userDoc.data()?.preferences;
          if (prefs?.theme && THEMES[prefs.theme]) {
            const id = prefs.theme;
            setThemeIdState(id);
            localStorage.setItem(LS_KEY, id);
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
      localStorage.setItem(LS_KEY, id);
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

  const T = THEMES[themeId] ?? THEMES.mission;

  return (
    <ThemeCtx.Provider value={{ T, themeId, setThemeId }}>
      {children}
    </ThemeCtx.Provider>
  );
}
