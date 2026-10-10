<script lang="ts">
  import { requestPersistence } from '../../../storage/durability';
  import ExportRow from '../../agora/ExportRow.svelte';
  import { app } from '../../app.svelte';
  import { OTHER_PLATE, persistenceText, plateChoice, plateOptions } from '../../agoraIndex';
  import { restBell } from '../../device';
  import Button from '../../kit/Button.svelte';
  import Icon from '../../kit/Icon.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import Segmented from '../../kit/Segmented.svelte';
  import Switch from '../../kit/Switch.svelte';
  import { promptDialog, showToast } from '../../overlays.svelte';
  import { parsePlate, PLATE_RANGE, type PlateUnit } from '../../prefs';
  import { routeHash } from '../../route';
  import { statusLine } from '../../status';

  /**
   * This device's settings: its name, the screen and the bell, whether the
   * browser may clear the log, the plate increments, and the way out for the
   * data (sync, and the two CSV files).
   */

  let persisted = $state<boolean | null>(null);
  let asking = $state(false);
  $effect(() => {
    void app.storage?.persisted.then((granted) => (persisted = granted));
  });

  const storage = $derived(persistenceText(persisted));
  const sync = $derived(app.status ? statusLine(app.status, app.inSession).text : 'Opening…');

  async function nameDevice(): Promise<void> {
    const name = await promptDialog({
      title: 'Name this device',
      body: 'Shown beside a version of a session when two devices changed it.',
      label: 'Device name',
      value: app.prefs.deviceName,
      placeholder: 'e.g. Phone',
      confirmLabel: 'Save name',
    });
    if (name) await app.setPrefs({ deviceName: name });
  }

  function chime(on: boolean): void {
    // iOS lets a page make sound only after a tap, and this is one.
    if (on) restBell().prime();
    void app.setPrefs({ chime: on });
  }

  const plateOf = (unit: PlateUnit) => (unit === 'kg' ? app.prefs.plateKg : app.prefs.plateLb);
  const setPlate = (unit: PlateUnit, step: number) =>
    app.setPrefs(unit === 'kg' ? { plateKg: step } : { plateLb: step });

  /** Picked, or with Other, typed in: the smallest change the plates allow. */
  async function pickPlate(unit: PlateUnit, value: string): Promise<void> {
    if (value !== OTHER_PLATE) return setPlate(unit, Number(value));
    const { min, max } = PLATE_RANGE[unit];
    const text = await promptDialog({
      title: unit === 'kg' ? 'Smallest step in kilograms' : 'Smallest step in pounds',
      body: 'The least the bar can change by: a pair of your lightest plates.',
      label: `Step, ${unit}`,
      value: String(plateOf(unit)),
      inputmode: 'decimal',
      confirmLabel: 'Save step',
    });
    if (text === null) return;
    const step = parsePlate(text, unit);
    if (step === null) {
      showToast({ message: 'Not saved', strong: `A step is ${min} to ${max} ${unit}` });
      return;
    }
    await setPlate(unit, step);
  }

  async function ask(): Promise<void> {
    asking = true;
    persisted = await requestPersistence();
    asking = false;
    if (!persisted) {
      showToast({ message: 'The browser has not agreed yet', strong: 'Installing the app helps' });
    }
  }
</script>

<ScreenHeader title="Settings" back={{ href: routeHash({ name: 'more', page: null }) }} />

<p class="sec caps">This device</p>
<ul class="group">
  <li class="row-link">
    <button onclick={nameDevice}>
      <span class="grow t">Device name</span>
      <span class="v" class:empty={!app.prefs.deviceName}
        >{app.prefs.deviceName || 'Not named'}</span
      >
      <Icon name="chev" size="sm" />
    </button>
  </li>
  <li>
    <span class="grow" id="awake-l">
      <span class="t">Keep screen on</span>
      <span class="s">during a session</span>
    </span>
    <Switch
      labelledby="awake-l"
      checked={app.prefs.keepAwake}
      onchange={(on) => void app.setPrefs({ keepAwake: on })}
    />
  </li>
  <li>
    <span class="grow" id="chime-l">
      <span class="t">Chime at zero</span>
      <span class="s">while the app is open</span>
    </span>
    <Switch labelledby="chime-l" checked={app.prefs.chime} onchange={chime} />
  </li>
  <li>
    <span class="grow">
      <span class="t">Persistent storage</span>
      <span class="s wraps">{storage.line}</span>
    </span>
    {#if storage.granted}
      <span class="granted"><Icon name="check" size="sm" stroke={2.4} /> Granted</span>
    {:else if persisted === false}
      <span class="v">Not yet</span>
      <Button variant="quiet" disabled={asking} onclick={ask}>Ask</Button>
    {/if}
  </li>
</ul>

<p class="sec caps">Plate increments</p>
<ul class="group">
  <li class="plates">
    <span class="grow t" id="kg-l">Kilograms</span>
    <Segmented
      full
      label="Kilogram plate increment"
      options={plateOptions('kg', app.prefs.plateKg)}
      value={plateChoice('kg', app.prefs.plateKg)}
      onchange={(value) => void pickPlate('kg', value)}
    />
  </li>
  <li class="plates">
    <span class="grow t" id="lb-l">Pounds</span>
    <Segmented
      full
      label="Pound plate increment"
      options={plateOptions('lb', app.prefs.plateLb)}
      value={plateChoice('lb', app.prefs.plateLb)}
      onchange={(value) => void pickPlate('lb', value)}
    />
  </li>
</ul>
<p class="group-foot">
  Steps the − and + buttons, and rounds percentage loads. Other takes any step, as 0.5 for
  fractional plates.
</p>

<p class="sec caps">Sync and export</p>
<ul class="group">
  <li class="row-link">
    <a href={routeHash({ name: 'more', page: 'sync' })}>
      <span class="grow">
        <span class="t">Sync</span>
        <span class="s">{sync}</span>
      </span>
      <Icon name="chev" size="sm" />
    </a>
  </li>
  <ExportRow />
</ul>
<p class="group-foot">
  Every set and every session as a spreadsheet, for a notebook or a coach. Nothing is sent anywhere.
</p>

<style>
  /* Four choices, Other among them, need the row's width: the unit sits above them. */
  .plates {
    flex-wrap: wrap;
    row-gap: var(--space-1);
    padding-block: var(--space-2) var(--space-3);
  }

  /* Beside Not yet and Ask the line is what the button is for: let it wrap, not cut. */
  .s.wraps {
    white-space: normal;
    text-wrap: balance;
  }

  .granted {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--success);
  }

  .empty {
    color: var(--muted);
  }

  .group :global(.seg) {
    flex: none;
  }
</style>
