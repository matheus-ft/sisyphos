<script lang="ts">
  import type { IsoDate } from '../../model';
  import type { E1rmPoint, SetE1rmPoint } from '../../metrics/e1rm';
  import type { HoverText } from '../athloi';
  import {
    areaPath,
    CHART,
    dateScale,
    monotonePath,
    monthMarks,
    nearestPoint,
    strataPaths,
    toChartX,
    toChartY,
    tooltipLeft,
    valueScale,
  } from '../chart';
  import { BOULDER_RADIUS, STONE_INCISIONS, STONE_PATH } from '../hill';

  /**
   * One lift's best e1RM per day as the hill the boulder climbs: the line, the
   * ground beneath it incised with strata and the stone resting on the latest.
   * Behind the line, every working set as a faint dot; over it, each
   * single solid at the weight lifted, and a gilded mark on a record day. A finger or pointer
   * draws a crosshair that snaps to a set, the arrow keys step through them.
   * The geometry is `ui/chart.ts`; this only paints it.
   */
  interface Props {
    /** The best of each day: the line, and what the stone rests on. */
    points: E1rmPoint[];
    /** Every working set in view, oldest first; at least one per day of `points`. */
    sets: SetE1rmPoint[];
    /** What the tooltip says of each set, in step with `sets`. */
    texts: HoverText[];
    /** The chart in a sentence, for a screen reader. */
    label: string;
    /** Where the plot ends on the right: today, so a gap since the last session shows. */
    to: IsoDate;
  }
  let { points, sets, texts, label, to }: Props = $props();

  // With one day there is nothing to run between: it stands in the middle.
  const span = $derived<{ from: IsoDate; to: IsoDate }>(
    points.length < 2
      ? { from: points[0].date, to: points[0].date }
      : { from: points[0].date, to: to > points.at(-1)!.date ? to : points.at(-1)!.date },
  );
  const scale = $derived(valueScale([...points, ...sets].map((p) => p.e1rm)));
  const xOf = $derived(dateScale(span.from, span.to));
  const xy = $derived(points.map((p) => ({ x: xOf(p.date), y: scale.y(p.e1rm) })));
  const setXy = $derived(sets.map((p) => ({ x: xOf(p.date), y: scale.y(p.e1rm) })));
  const line = $derived(monotonePath(xy));
  const area = $derived(areaPath(xy));
  const strata = $derived(strataPaths(xy));
  const months = $derived(points.length < 2 ? [] : monthMarks(span.from, span.to));
  const latest = $derived(xy.at(-1)!);
  // Every set is drawn, always: faint dots behind the line. The singles are marked again,
  // solid, over it, at the weight actually lifted; the records are gilded on the line.
  const scatter = $derived(setXy.map((p, i) => ({ ...p, key: sets[i].set_id })));
  const singles = $derived(
    sets.flatMap((p, i) => (p.kind === 'single' ? [{ ...setXy[i], key: p.set_id }] : [])),
  );
  const records = $derived(
    points.flatMap((p, i) => (p.record ? [{ ...xy[i], key: p.set_id }] : [])),
  );

  let hover = $state<number | null>(null);
  let box = $state<HTMLDivElement | null>(null);
  let boxWidth = $state(0);
  let tipWidth = $state(150);

  const at = $derived(hover === null || hover >= sets.length ? null : hover);
  const tipLeftPx = $derived(
    at === null ? 0 : tooltipLeft((setXy[at].x / CHART.width) * boxWidth, tipWidth, boxWidth),
  );
  // The stone rests on the latest day's best, so a ring there would sit under it.
  const underStone = $derived(at !== null && sets[at].set_id === points.at(-1)!.set_id);

  function aim(event: PointerEvent): void {
    if (!box) return;
    const rect = box.getBoundingClientRect();
    hover = nearestPoint(
      setXy,
      toChartX(event.clientX, rect.left, box.clientWidth),
      toChartY(event.clientY, rect.top, box.clientHeight),
    );
  }

  function key(event: KeyboardEvent): void {
    const last = sets.length - 1;
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (event.key === 'Escape') hover = null;
    else if (event.key === 'Home') hover = 0;
    else if (event.key === 'End') hover = last;
    else if (step !== 0)
      hover = Math.min(last, Math.max(0, (at ?? (step > 0 ? -1 : last + 1)) + step));
    else return;
    event.preventDefault();
  }

  const id = $props.id();
</script>

<!-- A finger drags along the hill; a swipe up or down still scrolls the page. The slider
     role is what the arrow keys do: step from set to set, with the set read out. -->
<div
  class="chart"
  bind:this={box}
  bind:clientWidth={boxWidth}
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-orientation="horizontal"
  aria-valuemin={1}
  aria-valuemax={sets.length}
  aria-valuenow={(at ?? sets.length - 1) + 1}
  aria-valuetext="{texts[at ?? sets.length - 1].value}, {texts[
    at ?? sets.length - 1
  ].kind.toLowerCase()}, {texts[at ?? sets.length - 1].detail}"
  onpointerdown={aim}
  onpointermove={(e) => {
    if (e.pointerType === 'mouse' || e.buttons) aim(e);
  }}
  onpointerleave={(e) => {
    if (e.pointerType === 'mouse') hover = null;
  }}
  onkeydown={key}
  onblur={() => (hover = null)}
>
  <svg viewBox="0 0 {CHART.width} {CHART.height}" aria-hidden="true">
    <defs>
      <clipPath id="{id}-ground"><path d={area} /></clipPath>
    </defs>

    {#each scale.ticks as tick (tick)}
      <line class="grid" x1={CHART.left} x2={CHART.right} y1={scale.y(tick)} y2={scale.y(tick)} />
      <text class="tick" x={CHART.labelX} y={scale.y(tick) + 4}>{tick}</text>
    {/each}

    {#if points.length > 1}
      <path class="area" d={area} />
      <g clip-path="url(#{id}-ground)">
        {#each strata as d, i (i)}<path class="stratum" {d} />{/each}
      </g>
    {/if}

    {#each scatter as d (d.key)}
      <circle class="scatter" cx={d.x} cy={d.y} r="3" />
    {/each}

    {#if points.length > 1}
      <path class="line" d={line} />
    {/if}

    {#each months as m (m.x)}
      <text class="month" x={m.x} y={CHART.monthY}>{m.year ? `${m.label} ${m.year}` : m.label}</text
      >
    {/each}

    {#each records as d (d.key)}
      <circle class="record" cx={d.x} cy={d.y} r="4.5" />
    {/each}

    {#each singles as d (d.key)}
      <circle class="single" cx={d.x} cy={d.y} r="3.5" />
    {/each}

    <!-- The stone rests on the latest point, not in it. -->
    <g
      class="stone"
      transform="translate({latest.x} {latest.y - BOULDER_RADIUS * 0.95}) scale({BOULDER_RADIUS})"
    >
      <path class="boulder" d={STONE_PATH} />
      {#each STONE_INCISIONS as d (d)}<path class="inc" {d} />{/each}
    </g>

    {#if at !== null}
      <line class="cross" x1={setXy[at].x} x2={setXy[at].x} y1={CHART.top - 6} y2={CHART.bottom} />
      {#if !underStone}
        <circle class="ring" cx={setXy[at].x} cy={setXy[at].y} r="5.5" />
      {/if}
    {/if}
  </svg>

  {#if at !== null}
    <div class="tip" style:left="{tipLeftPx}px" bind:clientWidth={tipWidth} aria-hidden="true">
      <strong class="figure-num">{texts[at].value}</strong>
      <span class="meta">{texts[at].kind} · {texts[at].detail}</span>
    </div>
  {/if}
</div>

<ul class="legend" aria-hidden="true">
  <li><i class="key line"></i>best e1RM</li>
  <li><i class="key sets"></i>sets (e1RM)</li>
  <li><i class="key single"></i>single</li>
</ul>

<style>
  .chart {
    position: relative;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    border-radius: var(--radius-sm);
  }

  .grid {
    stroke: var(--chart-grid);
    stroke-width: var(--hairline);
  }

  .tick {
    fill: var(--muted);
    font: var(--fw-num) 12px var(--font-num);
    text-anchor: end;
  }

  .month {
    fill: var(--muted);
    font: var(--fw-strong) 10px var(--font-display);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-anchor: middle;
  }

  .area {
    fill: var(--chart-area);
  }

  .stratum {
    fill: none;
    stroke: var(--chart-strata);
    stroke-width: 1;
  }

  .line {
    fill: none;
    stroke: var(--chart-line);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  /* Every set, as a whisper of a dot: many together show where the work was done. */
  .scatter {
    fill: var(--chart-line);
    opacity: 0.14;
  }

  .record {
    fill: var(--laurel-fill);
    stroke: var(--surface);
    stroke-width: 2;
  }

  /* A single is a weight lifted, so it is solid and dark enough to read over the scatter. */
  .single {
    fill: var(--figure);
    stroke: var(--surface);
    stroke-width: 1.5;
  }

  .boulder {
    fill: var(--figure);
    stroke: var(--figure);
    stroke-width: 0.12;
    stroke-linejoin: round;
  }

  .inc {
    fill: none;
    stroke: var(--surface);
    stroke-width: 0.1;
    stroke-linecap: round;
  }

  .cross {
    stroke: var(--ink-2);
    stroke-width: 1;
  }

  .ring {
    fill: var(--surface);
    stroke: var(--chart-line);
    stroke-width: 2;
  }

  .tip {
    position: absolute;
    top: 4px;
    display: grid;
    gap: 1px;
    padding: 6px 12px 7px;
    border-radius: var(--radius-sm);
    background: var(--raised);
    box-shadow: var(--shadow-2);
    pointer-events: none;
    white-space: nowrap;
  }

  .tip strong {
    font-size: 1.125rem;
  }

  .tip .meta {
    font-size: 0.8125rem;
  }

  .legend {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin: var(--space-1) var(--space-2) 0;
    padding: 0;
    list-style: none;
    font: italic 0.8125rem / 1 var(--font-text);
    color: var(--muted);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .key {
    box-sizing: border-box;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .key.line {
    width: 14px;
    height: 2px;
    border-radius: 1px;
    background: var(--chart-line);
  }

  .key.sets {
    background: var(--chart-line);
    opacity: 0.25;
  }

  .key.single {
    background: var(--figure);
  }
</style>
