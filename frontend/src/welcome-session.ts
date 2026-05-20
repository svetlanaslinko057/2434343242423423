/**
 * Welcome session-flag.
 *
 * Production rule: show /welcome ONCE per browser tab / app launch — not on
 * every reload. We don't use AsyncStorage / localStorage because those
 * persist forever, which means a returning user is forced through the
 * onboarding screen and bounces.
 *
 * Implementation:
 *   - Web   → window.sessionStorage  (cleared on tab close)
 *   - Native → in-memory module variable (cleared on app cold-start)
 *
 * Both behave identically: "fresh launch → show welcome, in-session
 * navigation → skip welcome."
 */
import { Platform } from 'react-native';

const KEY = 'eva_welcome_seen_session_v1';

// Native fallback — module-scoped variable lives until JS bundle reloads.
let nativeSeen = false;

export function markWelcomeSeenForSession(): void {
  if (Platform.OS === 'web') {
    try {
      window.sessionStorage?.setItem(KEY, '1');
    } catch {
      /* private mode / quota — fall through to in-memory */
    }
  }
  nativeSeen = true;
}

export function hasWelcomeBeenSeenInSession(): boolean {
  if (Platform.OS === 'web') {
    try {
      if (window.sessionStorage?.getItem(KEY) === '1') return true;
    } catch {
      /* ignore */
    }
  }
  return nativeSeen;
}

// Transient flag — true for ONE render of the describe screen right after
// the user clicked "See my product plan" on /welcome. Used to render the
// continuity strip ("STEP 1 OF 3 — Let's build your product"). Cleared
// after first read so it doesn't stick on subsequent navigation back to /.
let justLeftWelcome = false;

export function markJustLeftWelcome(): void {
  justLeftWelcome = true;
}

export function consumeJustLeftWelcome(): boolean {
  const v = justLeftWelcome;
  justLeftWelcome = false;
  return v;
}
