/**
 * What the phone itself can do for a session: keep the screen on, and sound the
 * end of a rest. Both are extras. A home-screen app on iOS holds a wake lock
 * only from iOS 18.4, and plays sound only while it is open, so every call here
 * fails quietly and nothing else depends on them.
 */

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** Keeps the screen on while wanted and the app is visible. */
export interface ScreenAwake {
  set(wanted: boolean): void;
  dispose(): void;
}

export function screenAwake(
  doc: Document = document,
  wakeLock: WakeLockLike | undefined = (navigator as Navigator & { wakeLock?: WakeLockLike })
    .wakeLock,
): ScreenAwake {
  let wanted = false;
  let held: WakeLockSentinelLike | null = null;
  let asking = false;

  async function acquire(): Promise<void> {
    if (!wakeLock || held || asking || !wanted || doc.visibilityState !== 'visible') return;
    asking = true;
    try {
      const sentinel = await wakeLock.request('screen');
      // The browser drops the lock when the app is hidden or the battery is low.
      sentinel.addEventListener('release', () => {
        if (held === sentinel) held = null;
      });
      if (wanted) held = sentinel;
      else await sentinel.release();
    } catch {
      // Refused (hidden, Low Power Mode, or an iOS too old): the screen locks as usual.
    } finally {
      asking = false;
    }
  }

  async function release(): Promise<void> {
    const sentinel = held;
    held = null;
    try {
      await sentinel?.release();
    } catch {
      // Already released by the browser.
    }
  }

  // A lock is lost whenever the app leaves the screen, so it is asked for again on return.
  const onVisible = (): void => void acquire();
  doc.addEventListener('visibilitychange', onVisible);

  return {
    set(next) {
      wanted = next;
      void (next ? acquire() : release());
    },
    dispose() {
      wanted = false;
      doc.removeEventListener('visibilitychange', onVisible);
      void release();
    },
  };
}

type AudioContextClass = typeof AudioContext;

interface AudioSessionLike {
  type: string;
}

/** A short two-note bell for the end of a rest. */
export interface Chime {
  /** Called within a tap: iOS lets a page make sound only after one. */
  prime(): void;
  play(): void;
}

export function chime(win: Window = window): Chime {
  const audio = win as Window & {
    AudioContext?: AudioContextClass;
    webkitAudioContext?: AudioContextClass;
  };
  const Context = audio.AudioContext ?? audio.webkitAudioContext;
  let context: AudioContext | null = null;

  function ready(): AudioContext | null {
    if (!Context) return null;
    try {
      // 'transient' lowers the lifter's music for the bell instead of stopping it, and
      // plays with the ringer switch off, which a bell meant to be heard needs.
      const session = (win.navigator as Navigator & { audioSession?: AudioSessionLike })
        .audioSession;
      if (session) session.type = 'transient';
      context ??= new Context();
      if (context.state !== 'running') void context.resume().catch(() => undefined);
      return context;
    } catch {
      return null;
    }
  }

  return {
    prime() {
      ready();
    },
    play() {
      const ctx = ready();
      if (!ctx) return;
      const start = ctx.currentTime;
      for (const [frequency, at] of [
        [880, 0],
        [1320, 0.18],
      ] as const) {
        const tone = ctx.createOscillator();
        const gain = ctx.createGain();
        tone.type = 'sine';
        tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + at);
        gain.gain.exponentialRampToValueAtTime(0.25, start + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.9);
        tone.connect(gain).connect(ctx.destination);
        tone.start(start + at);
        tone.stop(start + at + 0.95);
      }
    },
  };
}
