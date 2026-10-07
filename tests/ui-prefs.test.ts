import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/storage/store/memory';
import { DEFAULT_PREFS, parsePlate, PLATE_CHOICES, plateStep, readPrefs } from '../src/ui/prefs';

describe('device preferences', () => {
  it('fills every default when nothing was saved', () => {
    expect(readPrefs({})).toEqual({
      deviceName: '',
      plateKg: 2.5,
      plateLb: 5,
      keepAwake: false,
      chime: false,
    });
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it('reads what was saved, and fills only what was not', () => {
    expect(readPrefs({ deviceName: 'Gym phone', plateKg: 1.25, keepAwake: true })).toEqual({
      ...DEFAULT_PREFS,
      deviceName: 'Gym phone',
      plateKg: 1.25,
      keepAwake: true,
    });
  });

  it('takes any plate increment a pair of plates could make, and nothing else', () => {
    for (const kg of PLATE_CHOICES.kg) expect(readPrefs({ plateKg: kg }).plateKg).toBe(kg);
    for (const lb of PLATE_CHOICES.lb) expect(readPrefs({ plateLb: lb }).plateLb).toBe(lb);
    expect(readPrefs({ plateKg: 0.5 }).plateKg).toBe(0.5);
    expect(readPrefs({ plateLb: 1 }).plateLb).toBe(1);
    expect(readPrefs({ plateKg: 0 }).plateKg).toBe(2.5);
    expect(readPrefs({ plateKg: 0.1 }).plateKg).toBe(2.5);
    expect(readPrefs({ plateKg: 25 }).plateKg).toBe(2.5);
    expect(readPrefs({ plateLb: 45 }).plateLb).toBe(5);
    expect(readPrefs({ plateKg: Number.NaN }).plateKg).toBe(2.5);
    expect(readPrefs({ plateKg: '5' as unknown as number }).plateKg).toBe(2.5);
  });

  it('reads a typed increment, a comma for a point, to the hundredth', () => {
    expect(parsePlate('0,5', 'kg')).toBe(0.5);
    expect(parsePlate(' 1 ', 'lb')).toBe(1);
    expect(parsePlate('0.333', 'kg')).toBe(0.33);
    expect(parsePlate('', 'kg')).toBeNull();
    expect(parsePlate('half', 'kg')).toBeNull();
    expect(parsePlate('0.25', 'lb')).toBeNull();
  });

  it('takes a flag only for what it is, true', () => {
    expect(readPrefs({ chime: 'yes' as unknown as boolean }).chime).toBe(false);
    expect(readPrefs({ keepAwake: 1 as unknown as boolean }).keepAwake).toBe(false);
  });

  it('trims a device name and ignores one that is not text', () => {
    expect(readPrefs({ deviceName: '  Phone ' }).deviceName).toBe('Phone');
    expect(readPrefs({ deviceName: 7 as unknown as string }).deviceName).toBe('');
  });

  it('gives each unit its own step, and pins a step of one', () => {
    const prefs = readPrefs({ plateKg: 1.25, plateLb: 10 });
    expect(plateStep(prefs, 'kg')).toBe(1.25);
    expect(plateStep(prefs, 'lb')).toBe(10);
    expect(plateStep(prefs, 'pins')).toBe(1);
  });

  it("reads from the store's settings, saved before the preferences existed or after", async () => {
    const store = new MemoryStore();
    expect(readPrefs(await store.settings())).toEqual(DEFAULT_PREFS);
    await store.saveSettings({ deviceName: 'Phone', chime: true, plateLb: 2.5 });
    expect(readPrefs(await store.settings())).toEqual({
      ...DEFAULT_PREFS,
      deviceName: 'Phone',
      chime: true,
      plateLb: 2.5,
    });
  });
});
