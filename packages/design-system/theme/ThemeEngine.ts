/**
 * ThemeEngine — platform-agnostic theme state machine.
 *
 * Owns:
 *   - current theme name (dark/light)
 *   - user-preference flag (explicit choice vs OS-follow)
 *   - subscription bus for listeners
 *
 * Does NOT know about:
 *   - localStorage / AsyncStorage  → injected via `Storage` adapter
 *   - document.classList / RN Appearance → injected via `Apply` adapter
 *
 * Behaviour contract (IDENTICAL on web + mobile):
 *   1. Boot: storage.read() → if user-pref → use it. else → OS preference.
 *   2. setTheme('dark'|'light') → user-pref = true, persist, apply, notify.
 *   3. setTheme('system') → user-pref = false, clear storage, re-read OS, apply, notify.
 *   4. OS theme changes → only auto-apply if user-pref = false.
 */

import type { ThemeName } from '../tokens/palette';
export type { ThemeName };

const STORAGE_KEY = 'atlas_theme';

export interface ThemeStorage {
  read():  Promise<ThemeName | null>;
  write(t: ThemeName): Promise<void>;
  clear(): Promise<void>;
}

export interface ThemeApply {
  apply(t: ThemeName): void;
  /** Subscribe to OS theme changes. Returns unsubscribe fn. */
  onSystemChange(cb: (t: ThemeName) => void): () => void;
  /** Read current OS preference (no storage). */
  readSystem(): ThemeName;
}

export interface ThemeEngineConfig {
  storage: ThemeStorage;
  apply:   ThemeApply;
  fallback?: ThemeName;  // when no OS info available — default 'dark'
}

export class ThemeEngine {
  private _theme: ThemeName;
  private _isUserPref = false;
  private _listeners = new Set<(t: ThemeName) => void>();
  private _unsubSystem: (() => void) | null = null;

  constructor(private cfg: ThemeEngineConfig) {
    this._theme = cfg.apply.readSystem() || cfg.fallback || 'dark';
  }

  get theme(): ThemeName { return this._theme; }
  get isUserPref(): boolean { return this._isUserPref; }
  get storageKey(): string { return STORAGE_KEY; }

  /** Read storage + OS, apply, start listening for OS changes. */
  async boot(): Promise<void> {
    const stored = await this.cfg.storage.read();
    if (stored === 'dark' || stored === 'light') {
      this._isUserPref = true;
      this._theme = stored;
    } else {
      this._isUserPref = false;
      this._theme = this.cfg.apply.readSystem() || this.cfg.fallback || 'dark';
    }
    this.cfg.apply.apply(this._theme);
    this._notify();

    // OS change subscription — auto-apply only when no user pref.
    this._unsubSystem = this.cfg.apply.onSystemChange((osTheme) => {
      if (this._isUserPref) return;
      this._theme = osTheme;
      this.cfg.apply.apply(this._theme);
      this._notify();
    });
  }

  /** Stop OS listener. Call from teardown. */
  destroy(): void {
    if (this._unsubSystem) { this._unsubSystem(); this._unsubSystem = null; }
    this._listeners.clear();
  }

  /**
   * Set theme. Pass 'system' to clear user-pref and follow OS again.
   */
  async setTheme(next: ThemeName | 'system'): Promise<void> {
    if (next === 'system') {
      this._isUserPref = false;
      await this.cfg.storage.clear();
      this._theme = this.cfg.apply.readSystem() || this.cfg.fallback || 'dark';
    } else {
      this._isUserPref = true;
      await this.cfg.storage.write(next);
      this._theme = next;
    }
    this.cfg.apply.apply(this._theme);
    this._notify();
  }

  async toggle(): Promise<void> {
    await this.setTheme(this._theme === 'dark' ? 'light' : 'dark');
  }

  subscribe(cb: (t: ThemeName) => void): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  private _notify(): void {
    for (const l of this._listeners) {
      try { l(this._theme); } catch { /* swallow */ }
    }
  }
}

export { STORAGE_KEY };
