<script lang="ts">
  import type { IsoDate } from '../../model';
  import type { E1rmPoint } from '../../metrics/e1rm';
  import type { HoverText } from '../athloi';
  import {
    areaPath,
    CHART,
    dateScale,
    monotonePath,
    monthMarks,
    nearestIndex,
    strataPaths,
    toChartX,
    tooltipLeft,
    valueScale,
  } from '../chart';
  import { BOULDER_RADIUS, STONE_INCISIONS, STONE_PATH } from '../hill';

  /**
   * One lift's best e1RM per day as the hill the boulder climbs: the line, the
   * ground beneath it incised with strata, gilded dots on record days and the
   * stone resting on the latest. A finger or pointer draws a crosshair that
   * snaps to a day. The geometry is `ui/chart.ts`; this only paints it.
   */
  interface Props {
    points: E1rmPoint[];
    /** What the tooltip says of each point, in step with `points`. */
    texts: HoverText[];
    /** The chart in a sentence, for a screen reader. */
    label: string;
    /** Where the plot ends on the right: today, so a gap since the last session shows. */
    to: IsoDate;
  }
  let { points, texts, label, to }: Props = $props();

  // With one day there is nothing to run between: it stands in the middle.
  const span = $derived<{ from: IsoDate; to: IsoDate }>(
    points.length < 2
      ? { from: points[0].date, to: points[0].date }
      : { from: points[0].date, to: to > points.at(-1)!.date ? to : points.at(-1)!.date },
  );
  const scale = $derived(valueScale(points.map((p) => p.e1rm)));
  const xOf = $derived(dateScale(span.from, span.to));
  const xy = $derived(points.map((p) => ({ x: xOf(p.date), y: scale.y(p.e1rm) })));
  const line = $derived(monotonePath(xy));
  const area = $derived(areaPath(xy));
  const strata = $derived(strataPaths(xy));
  const months = $derived(points.length < 2 ? [] : monthMarks(span.from, span.to));
  const latest = $derived(xy.at(-1)!);
  // Dots for every day, until there are so many they would be a rash: then only the records.
  const crowded = $derived(points.length > 45);

  let hover = $state<number | null>(null);
  let box = $state<HTMLDivElement | null>(null);
  let boxWidth = $state(0);
  let tipWidth = $state(150);

  const at = $derived(hover === null || hover >= points.length ? null : hover);
  const tipLeftPx = $derived(
    at === null ? 0 : tooltipLeft((xy[at].x / CHART.width) * boxWidth, tipWidth, boxWidth),
  );

  function aim(event: PointerEvent): void {
    if (!box) return;
    const x = toChartX(event.clientX, box.getBoundingClientRect().left, box.clientWidth);
    hover = nearestIndex(
      xy.map((p) => p.x),
      x,
    );
  }

  function key(event: KeyboardEvent): void {
    const last = points.length - 1;
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
     role is what the arrow keys do: step from day to day, with the day read out. -->
<div
  class="chart"
  bind:this={box}
  bind:clientWidth={boxWidth}
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-orientation="horizontal"
  aria-valuemin={1}
  aria-valuemax={points.length}
  aria-valuenow={(at ?? points.length - 1) + 1}
  aria-valuetext="{texts[at ?? points.length - 1].value}, {texts[at ?? points.length - 1].detail}"
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
      <path class="line" d={line} />
    {/if}

    {#each months as m (m.x)}
      <text class="month" x={m.x} y={CHART.monthY}>{m.year ? `${m.label} ${m.year}` : m.label}</text
      >
    {/each}

    {#each points as p, i (p.date)}
      {#if i < points.length - 1 && (p.record || !crowded)}
        <circle
          class="dot"
          class:record={p.record}
          cx={xy[i].x}
          cy={xy[i].y}
          r={p.record ? 4.5 : 3}
        />
      {/if}
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
      <line class="cross" x1={xy[at].x} x2={xy[at].x} y1={CHART.top - 6} y2={CHART.bottom} />
      {#if at < points.length - 1}
        <circle class="ring" cx={xy[at].x} cy={xy[at].y} r="5" />
      {/if}
    {/if}
  </svg>

  {#if at !== null}
    <div class="tip" style:left="{tipLeftPx}px" bind:clientWidth={tipWidth} aria-hidden="true">
      <strong class="figure-num">{texts[at].value}</strong>
      <span class="meta">{texts[at].detail}</span>
    </div>
  {/if}
</div>

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

  .dot {
    fill: var(--chart-line);
    stroke: var(--surface);
    stroke-width: 2;
  }

  .dot.record {
    fill: var(--laurel-fill);
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
</style>
