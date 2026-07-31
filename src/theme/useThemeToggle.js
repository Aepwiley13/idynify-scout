import { useContext } from 'react';
import { ThemeCtx } from './ThemeContext';
import { THEMES } from './tokens';

/**
 * Light ⇄ dark in one click, for the places that offer a toggle rather than
 * the full picker: the top bar's user menu, the mobile drawer and the More
 * sheet.
 *
 * Those three had — or were about to have — three copies of the same
 * `setThemeId(isLight ? 'mission' : 'workspace')` line and three different
 * labels for it ("Light Mode", "Dark Mode", "Theme"). One hook so a user
 * cannot find the same control named two things in the same product.
 *
 * `mission` and `workspace` are the canonical dark and light themes. The
 * others (navy, sand, the Star Wars set) are chosen deliberately in Settings →
 * Appearance, and toggling from one lands on whichever of the two canonical
 * themes is the opposite of what is on screen — a toggle cannot round-trip
 * through six themes, and pretending otherwise would strand the user.
 */
export function useThemeToggle() {
  const { themeId, setThemeId } = useContext(ThemeCtx);
  const isDark = THEMES[themeId]?.isDark ?? false;

  return {
    isDark,
    /** What the toggle switches TO — the honest label for the action. */
    nextLabel: isDark ? 'Light mode' : 'Dark mode',
    toggleTheme: () => setThemeId(isDark ? 'workspace' : 'mission'),
  };
}
