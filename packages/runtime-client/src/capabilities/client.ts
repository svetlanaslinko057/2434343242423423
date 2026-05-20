/**
 * Capability client — reads `/api/integrations/manifest` and feeds the store.
 *
 * Refresh policy:
 *  - Cold start: hydrate from persistent (sync), then trigger background refresh.
 *  - Periodic: every TTL_MS; manual `client.refresh()` is also exposed.
 *  - On hard-policy capability flip we also notify subscribers immediately.
 */
import type {
  CapabilityManifest,
  PlatformAdapter,
  RuntimeClientConfig,
} from '../core/types';
import { capabilityStore } from './store';

export class CapabilityClient {
  constructor(
    private runtime: RuntimeClientConfig,
    private adapter: PlatformAdapter,
  ) {}

  /** Boot sequence: hydrate sync, then network refresh in background. */
  async boot(): Promise<void> {
    await capabilityStore.hydrate(this.adapter);
    void this.refresh().catch(() => { /* non-fatal */ });
  }

  /** Public refresh — dedupes concurrent calls via the store. */
  refresh(): Promise<CapabilityManifest> {
    return capabilityStore.refresh(
      async () => {
        const url = `${this.runtime.baseURL.replace(/\/+$/, '')}/api/integrations/manifest`;
        const init = this.adapter.decorateInit(
          { method: 'GET', headers: { accept: 'application/json' } },
          { url: '/api/integrations/manifest', method: 'GET' },
        );
        const resp = await fetch(url, init);
        if (!resp.ok) throw new Error(`manifest fetch failed: ${resp.status}`);
        return (await resp.json()) as CapabilityManifest;
      },
      this.adapter,
    );
  }

  subscribe(listener: (m: CapabilityManifest) => void): () => void {
    return capabilityStore.subscribe(listener);
  }

  peek = capabilityStore.peek.bind(capabilityStore);
  getManifest = capabilityStore.getManifest.bind(capabilityStore);
  isStale = capabilityStore.isStale.bind(capabilityStore);
}
