import { describe, expect, it } from 'vitest';
import { CHECK_EVERY_MS, onTakeover, showUpdateNotice } from '../src/ui/update';

describe('when another tab takes the new version', () => {
  it('reloads the tab where Reload was tapped, even mid-session', () => {
    expect(onTakeover({ tapped: true, inSession: true })).toBe('reload');
  });

  it('reloads an idle tab', () => {
    expect(onTakeover({ tapped: false, inSession: false })).toBe('reload');
  });

  it('leaves a tab with a live session alone, to be offered the update after', () => {
    expect(onTakeover({ tapped: false, inSession: true })).toBe('wait');
  });
});

describe('when a new version is offered', () => {
  it('stays quiet until one is waiting', () => {
    expect(showUpdateNotice({ waiting: false, inSession: false })).toBe(false);
  });

  it('is offered once nothing is running', () => {
    expect(showUpdateNotice({ waiting: true, inSession: false })).toBe(true);
  });

  it('never interrupts a session, and is offered when it ends', () => {
    expect(showUpdateNotice({ waiting: true, inSession: true })).toBe(false);
    expect(showUpdateNotice({ waiting: true, inSession: false })).toBe(true);
  });

  it('waits behind a fuller screen such as setup', () => {
    expect(showUpdateNotice({ waiting: true, inSession: false, takeover: true })).toBe(false);
  });

  it('asks the browser for a new version at most hourly', () => {
    expect(CHECK_EVERY_MS).toBe(3_600_000);
  });
});
