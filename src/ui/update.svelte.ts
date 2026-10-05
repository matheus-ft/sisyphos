import { registerSW } from 'virtual:pwa-register';
import { CHECK_EVERY_MS } from './update';

/**
 * The app's updates. The service worker installs a new version in the
 * background and then waits: it takes over only when the lifter taps Reload,
 * which the shell offers outside a session (update.ts decides when). A fresh
 * launch uses the waiting version anyway.
 */
class Update {
  /** A new version is installed and waiting. */
  waiting = $state(false);
  #apply: ((reload?: boolean) => Promise<void>) | null = null;

  /** Registers the service worker; a no-op where the browser has none. */
  start = (): void => {
    if (this.#apply) return;
    this.#apply = registerSW({
      onNeedRefresh: () => (this.waiting = true),
      // A phone app can stay open for days: look for a new version now and then.
      onRegisteredSW: (_url, registration) => {
        if (registration) setInterval(() => void registration.update(), CHECK_EVERY_MS);
      },
    });
  };

  /** Switches to the waiting version and reloads. */
  reload = (): void => {
    void this.#apply?.(true);
  };
}

export const update = new Update();
