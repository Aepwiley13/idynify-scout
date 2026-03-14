/**
 * useMissionControlTheme() — Route-level Space theme enforcement.
 *
 * Mission Control always renders in the "mission" (Space) theme regardless
 * of the user's global theme preference. This hook temporarily overrides
 * the active theme on mount and restores it on unmount.
 *
 * Usage:
 *   function MissionControlPage() {
 *     useMissionControlTheme();
 *     // ... render as normal, useT() returns mission tokens
 *   }
 */
import { useEffect, useRef } from "react";
import { useThemeCtx } from "./ThemeContext";

const MISSION_CONTROL_THEME = "mission";

export function useMissionControlTheme() {
  const { themeId, setThemeId } = useThemeCtx();
  const previousThemeRef = useRef(null);

  useEffect(() => {
    // Save the user's real theme on first mount
    if (previousThemeRef.current === null) {
      previousThemeRef.current = themeId;
    }

    // Force mission theme if not already active
    if (themeId !== MISSION_CONTROL_THEME) {
      setThemeId(MISSION_CONTROL_THEME);
    }

    // Restore user's theme on unmount
    return () => {
      const saved = previousThemeRef.current;
      if (saved && saved !== MISSION_CONTROL_THEME) {
        setThemeId(saved);
      }
    };
  }, []); // Run once on mount/unmount only
}
