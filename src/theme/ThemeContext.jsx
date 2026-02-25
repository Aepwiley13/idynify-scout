/**
 * src/theme/ThemeContext.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Global theme context. Provides the active theme token set (T) and a setter.
 * Theme preference persists to Firestore under preferences.theme.
 *
 * Usage:
 *   const T = useT();        // get current theme token set
 *   const { setThemeId } = useThemeCtx();  // change theme
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { THEMES } from "./tokens";

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
  const [themeId, setThemeIdState] = useState("mission");

  // Load persisted theme from Firestore on mount
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const prefs = userDoc.data()?.preferences;
          if (prefs?.theme && THEMES[prefs.theme]) {
            setThemeIdState(prefs.theme);
          }
        }
      } catch (err) {
        console.error("ThemeProvider: failed to load theme preference", err);
      }
    };
    loadTheme();
  }, []);

  // Persist theme to Firestore when it changes
  const setThemeId = useCallback(async (id) => {
    if (!THEMES[id]) return;
    setThemeIdState(id);
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
