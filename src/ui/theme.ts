import type { Theme } from './prefs';

/**
 * Putting the appearance choice on the page. `data-theme` on <html> is what
 * src/app.css reads; with System there is no attribute and the phone's
 * setting decides, as it did before the choice existed.
 *
 * The choice is saved in the device's settings (IndexedDB), which cannot be
 * read before the first paint, so it is mirrored into localStorage and the
 * script in index.html reads it there, synchronously. Keep THEME_KEY and that
 * script in step.
 */

export const THEME_KEY = 'sisyphos.theme';

/**
 * The two theme-color tags of index.html (the page's ground in each mode). Each
 * keeps the colour it was written with in `data-system`, so System can restore it.
 */
function themeColourTags(): { light: HTMLMetaElement | null; dark: HTMLMetaElement | null } {
  let light: HTMLMetaElement | null = null;
  let dark: HTMLMetaElement | null = null;
  for (const tag of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    tag.dataset.system ??= tag.content;
    if (tag.media.includes('dark')) dark = tag;
    else light = tag;
  }
  return { light, dark };
}

/** Applies a theme: the attribute, the mirror and the browser chrome's colour. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be blocked: the choice is still in the settings, and a launch may flash.
  }

  // With a choice made, both tags say its colour whatever the phone is set to.
  const { light, dark } = themeColourTags();
  const chosen = theme === 'system' ? null : theme === 'dark' ? dark : light;
  for (const tag of [light, dark]) {
    if (tag) tag.content = (chosen ?? tag).dataset.system ?? tag.content;
  }
}
