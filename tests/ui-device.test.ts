import { describe, expect, it } from 'vitest';
import { chime, screenAwake } from '../src/ui/device';

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';

  hide(): void {
    this.visibilityState = 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }

  show(): void {
    this.visibilityState = 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

class FakeLock {
  held = 0;
  requests = 0;
  refuse = false;
  private sentinels: EventTarget[] = [];

  request = (): Promise<{
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
  }> => {
    this.requests++;
    if (this.refuse) return Promise.reject(new Error('NotAllowedError'));
    this.held++;
    const target = new EventTarget();
    this.sentinels.push(target);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.held--;
      target.dispatchEvent(new Event('release'));
    };
    return Promise.resolve({
      release: () => Promise.resolve(release()),
      addEventListener: (type: 'release', listener: () => void) =>
        target.addEventListener(type, listener),
    });
  };

  /** The browser letting go on its own, as when the app is hidden. */
  drop(): void {
    for (const target of this.sentinels) target.dispatchEvent(new Event('release'));
    this.held = 0;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const doc = new FakeDocument();
  const lock = new FakeLock();
  const awake = screenAwake(doc as unknown as Document, lock);
  return { doc, lock, awake };
}

describe('keeping the screen on', () => {
  it('holds a lock only while wanted', async () => {
    const { lock, awake } = setup();
    awake.set(true);
    await settle();
    expect(lock.held).toBe(1);
    awake.set(false);
    await settle();
    expect(lock.held).toBe(0);
  });

  it('asks again when the app comes back after the browser let go', async () => {
    const { doc, lock, awake } = setup();
    awake.set(true);
    await settle();
    doc.hide();
    lock.drop();
    doc.show();
    await settle();
    expect(lock.requests).toBe(2);
    expect(lock.held).toBe(1);
  });

  it('does not ask while hidden, nor when not wanted', async () => {
    const { doc, lock, awake } = setup();
    doc.visibilityState = 'hidden';
    awake.set(true);
    await settle();
    expect(lock.requests).toBe(0);
    awake.set(false);
    doc.show();
    await settle();
    expect(lock.requests).toBe(0);
  });

  it('fails quietly when refused', async () => {
    const { lock, awake } = setup();
    lock.refuse = true;
    awake.set(true);
    await settle();
    expect(lock.held).toBe(0);
  });

  it('lets go and stops listening when disposed', async () => {
    const { doc, lock, awake } = setup();
    awake.set(true);
    await settle();
    awake.dispose();
    await settle();
    doc.show();
    await settle();
    expect(lock.held).toBe(0);
    expect(lock.requests).toBe(1);
  });

  it('does nothing where there is no wake lock', () => {
    const awake = screenAwake(new FakeDocument() as unknown as Document, undefined);
    expect(() => awake.set(true)).not.toThrow();
  });
});

describe('the rest chime', () => {
  it('does nothing where there is no audio', () => {
    const bell = chime({ navigator: {} } as unknown as Window);
    expect(() => {
      bell.prime();
      bell.play();
    }).not.toThrow();
  });
});
