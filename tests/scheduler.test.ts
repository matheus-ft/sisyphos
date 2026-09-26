import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SaveScheduler, type SchedulerOptions } from '../src/storage/scheduler';

function make(overrides: Partial<SchedulerOptions> = {}) {
  const saveLocal = vi.fn(async () => {});
  const pushRemote = vi.fn(async () => ({ remaining: 0 }));
  const s = new SaveScheduler({ saveLocal, pushRemote, ...overrides });
  return { s, saveLocal, pushRemote };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('local saving', () => {
  it('writes a second after the last change, not on every keystroke', async () => {
    const { s, saveLocal } = make();
    s.changed();
    s.changed();
    s.changed();
    expect(saveLocal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveLocal).toHaveBeenCalledTimes(1);
  });

  it('can be forced without waiting out the debounce', async () => {
    const { s, saveLocal } = make();
    s.changed();
    await s.saveNow();
    expect(saveLocal).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing pending', async () => {
    const { s, saveLocal } = make();
    await s.saveNow();
    expect(saveLocal).not.toHaveBeenCalled();
  });

  it('keeps a change made while the previous one was being written', async () => {
    let finish: () => void = () => {};
    const saveLocal = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { s } = make({ saveLocal });
    s.changed();
    const writing = s.saveNow();
    s.changed(); // typed during the write
    finish();
    await writing;
    // That write did not contain the second change, so it is still pending...
    expect(s.getState().savePending).toBe(true);
    // ...and the debounce it armed writes it.
    const second = vi.advanceTimersByTimeAsync(1000);
    finish();
    await second;
    expect(saveLocal).toHaveBeenCalledTimes(2);
  });

  it('keeps a change whose write failed, and tries again', async () => {
    const saveLocal = vi
      .fn()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValue(undefined);
    const { s } = make({ saveLocal });
    s.changed();
    await expect(s.saveNow()).rejects.toThrow('quota');
    expect(s.getState().savePending).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveLocal).toHaveBeenCalledTimes(2);
    expect(s.getState().savePending).toBe(false);
  });
});

describe('remote pushing', () => {
  it('waits for real quiet before pushing', async () => {
    const { s, pushRemote } = make();
    s.changed();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(pushRemote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pushRemote).toHaveBeenCalledWith('quiet');
  });

  it('restarts the quiet clock on every change, so mid-session typing never pushes', async () => {
    const { s, pushRemote } = make();
    for (let i = 0; i < 10; i++) {
      s.changed();
      await vi.advanceTimersByTimeAsync(9 * 60_000);
    }
    expect(pushRemote).not.toHaveBeenCalled();
  });

  it('pushes immediately when you leave the app', async () => {
    const { s, pushRemote } = make();
    s.changed();
    await s.flush('hidden');
    expect(pushRemote).toHaveBeenCalledWith('hidden');
  });

  it('saves locally before pushing, so an interrupted push loses nothing', async () => {
    const order: string[] = [];
    const { s } = make({
      saveLocal: vi.fn(async () => void order.push('save')),
      pushRemote: vi.fn(async () => {
        order.push('push');
        return { remaining: 0 };
      }),
    });
    s.changed();
    await s.flush('session_ended');
    expect(order).toEqual(['save', 'push']);
  });

  it('asks the pusher even when it believes nothing changed', async () => {
    // The dirty queue is the authority, not this object's own flag. A session
    // deleted straight through storage is outstanding whether or not the
    // scheduler was told, and must not be stranded by a stale boolean.
    const { s, pushRemote } = make();
    await s.flush('launch');
    expect(pushRemote).toHaveBeenCalledWith('launch');
  });

  it('stays pending while the pusher reports work left over', async () => {
    const { s } = make({ pushRemote: vi.fn(async () => ({ remaining: 2 })) });
    s.changed();
    await s.flush('manual');
    expect(s.getState().pushPending).toBe(true);
  });

  it('clears pending state once a push succeeds', async () => {
    const { s } = make();
    s.changed();
    await s.flush('manual');
    const st = s.getState();
    expect(st.pushPending).toBe(false);
    expect(st.oldestUnpushedAt).toBeNull();
    expect(st.failures).toBe(0);
  });
});

describe('failure handling', () => {
  it('retries with exponential backoff', async () => {
    const pushRemote = vi.fn(async () => {
      throw new Error('offline');
    });
    const { s } = make({ pushRemote });
    s.changed();
    await s.flush('manual');
    expect(s.getState().failures).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000); // first backoff
    expect(pushRemote).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); // doubled
    expect(pushRemote).toHaveBeenCalledTimes(3);
  });

  it('keeps the original timestamp across failures, so exposure grows', async () => {
    const pushRemote = vi.fn(async () => {
      throw new Error('offline');
    });
    const { s } = make({ pushRemote });
    s.changed();
    const first = s.getState().oldestUnpushedAt;
    await s.flush('manual');
    await s.flush('manual');
    expect(s.getState().oldestUnpushedAt).toEqual(first);
    expect(s.getState().pushPending).toBe(true);
  });

  it('caps the backoff rather than growing forever', async () => {
    const pushRemote = vi.fn(async () => {
      throw new Error('offline');
    });
    const { s } = make({ pushRemote, baseBackoffMs: 1000, maxBackoffMs: 4000 });
    s.changed();
    for (let i = 0; i < 6; i++) await s.flush('manual');
    await vi.advanceTimersByTimeAsync(4000);
    expect(pushRemote).toHaveBeenCalledTimes(7);
  });

  it('recovers when the network comes back', async () => {
    let fail = true;
    const pushRemote = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return { remaining: 0 };
    });
    const { s } = make({ pushRemote });
    s.changed();
    await s.flush('manual');
    expect(s.getState().pushPending).toBe(true);

    fail = false;
    await s.flush('online');
    expect(s.getState().pushPending).toBe(false);
    expect(s.getState().failures).toBe(0);
  });
});

describe('state reporting', () => {
  it('tells the UI on every transition so exposure is never stale', async () => {
    const seen: boolean[] = [];
    const { s } = make({
      onStateChange: (st) => void seen.push(st.pushPending),
    });
    s.changed();
    await s.flush('manual');
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.at(-1)).toBe(false);
  });
});
