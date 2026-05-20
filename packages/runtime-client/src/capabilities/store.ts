/**
 * Capability store — layered cache (memory → persistent → network).
 *
 * Source of truth = backend `/api/integrations/manifest`.
 *
 * Cache layers:
 *  1. **Memory** — primary, per-process. Subscribed to by UI components.
 *  2. **Persistent** — secondary, via PlatformAdapter (web=cookie/localStorage
 *     wrapper, expo=AsyncStorage). Used to hydrate fast on cold start.
 *  3. **Network refresh** — source of truth, max staleness = 5 minutes.
 *
 * Invariants:
 *  - `peek()` is sync and never blocks UI render.
 *  - `refresh()` deduplicates concurrent calls (in-flight promise reuse).
 *  - On hard policy capability flip live→non-live, immediately notify
 *    subscribers (UI re-renders gates).
 *
 * NOTE: this is platform-agnostic. The persistent layer is plugged in by
 * the runtime client during `createRuntimeClient()` setup.
 */
import type {
  CapabilityManifest,
  CapabilityName,
  CapabilityState,
  PlatformAdapter,
} from '../core/types';

const STORAGE_KEY = 'evax_capability_manifest_v1';
const MAX_AGE_MS = 5 * 60 * 1000; // 5 min

type Listener = (manifest: CapabilityManifest) => void;

class CapabilityStore {
  private mem: CapabilityManifest | null = null;
  private listeners = new Set<Listener>();
  private inflight: Promise<CapabilityManifest> | null = null;

  /** Sync read. Returns null if nothing cached. */
  peek(name: CapabilityName): CapabilityState | null {
    return this.mem?.capabilities?.[name] ?? null;
  }

  getManifest(): CapabilityManifest | null {
    return this.mem;
  }

  /** True if cached manifest is older than TTL or missing. */
  isStale(): boolean {
    if (!this.mem) return true;
    const fetched = this.mem.fetched_at ?? 0;
    return Date.now() - fetched > MAX_AGE_MS;
  }

  setManifest(m: CapabilityManifest): void {
    this.mem = { ...m, fetched_at: Date.now() };
    for (const l of this.listeners) {
      try { l(this.mem); } catch { /* listener errors are isolated */ }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  /** Hydrate from persistent store on cold start. Best-effort. */
  async hydrate(adapter: PlatformAdapter): Promise<void> {
    try {
      const raw = await adapter.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CapabilityManifest;
      // Only adopt if not too old (e.g. 24h) — avoids stale lies on next boot.
      const fetched = parsed.fetched_at ?? 0;
      if (Date.now() - fetched > 24 * 60 * 60 * 1000) return;
      this.mem = parsed;
    } catch {
      // ignore — corrupted cache is non-fatal
    }
  }

  async persist(adapter: PlatformAdapter): Promise<void> {
    if (!this.mem) return;
    try {
      await adapter.setItem(STORAGE_KEY, JSON.stringify(this.mem));
    } catch {
      // ignore
    }
  }

  /**
   * Network refresh — the only path that calls the backend manifest endpoint.
   * Deduplicates concurrent invocations.
   */
  async refresh(
    fetcher: () => Promise<CapabilityManifest>,
    adapter?: PlatformAdapter,
  ): Promise<CapabilityManifest> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const m = await fetcher();
        this.setManifest(m);
        if (adapter) await this.persist(adapter);
        return this.mem!;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

export const capabilityStore = new CapabilityStore();
