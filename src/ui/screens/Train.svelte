<script lang="ts">
  import type { IsoDate, Session, Template } from '../../model';
  import { app } from '../app.svelte';
  import { longDate, programLabel } from '../format';
  import Boulder from '../kit/Boulder.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import Sheet from '../kit/Sheet.svelte';
  import { localDate } from '../session';
  import {
    firstSessionOfWeek,
    lastFinished,
    lastSessionLine,
    plansOf,
    sessionName,
    templateLine,
  } from '../train';
  import CalendarSheet from '../train/CalendarSheet.svelte';
  import PlanCard from '../train/PlanCard.svelte';
  import RunningCard from '../train/RunningCard.svelte';
  import TemplateFolders from '../train/TemplateFolders.svelte';

  /**
   * Askēsis, the Train tab: what to do today. The session running, or today's
   * plan with the one primary button; other plans; starting empty, planning
   * ahead or logging a past session; the templates; and the boulder waiting
   * at the foot of the hill.
   */

  const today = localDate(new Date());
  const plans = $derived(plansOf(app.current, today));
  const last = $derived(lastFinished(app.current));
  const running = $derived(app.running);
  const wit = $derived(firstSessionOfWeek(app.current, today));

  /** A plan's second line: its program label, else what it is called. */
  const subline = (s: Session): string => programLabel(s.label) ?? sessionName(s, app.library);

  /**
   * The day being planned, once picked: the plan starts empty or from a
   * template, the lifter's choice. With no template there is nothing to choose.
   */
  let planning = $state<IsoDate | null>(null);
  /** The calendar, while it asks for a day: to plan one, or to log a session that happened. */
  let picking = $state<'plan' | 'log' | null>(null);

  function pickedDay(date: IsoDate): void {
    const why = picking;
    picking = null;
    if (why === 'log') void app.create(null, { date });
    else if (app.templates.length === 0) void app.create(null, { planned: true, date });
    else planning = date;
  }

  function plan(from: Template | null): void {
    const date = planning;
    planning = null;
    if (date) void app.create(from, { planned: true, date });
  }
</script>

{#snippet planRows(sessions: Session[])}
  <ul class="group">
    {#each sessions as session (session.id)}
      <li>
        <button class="grow open" onclick={() => app.openSession(session)}>
          <span class="t">{longDate(session.date)}</span>
          <span class="s">{subline(session)}</span>
        </button>
        {#if !running}
          <Button
            variant="quiet"
            aria-label="Start {longDate(session.date)}"
            onclick={() => app.startPlanned(session)}>Start</Button
          >
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<ScreenHeader title={longDate(today)} meta={last ? lastSessionLine(last, today) : undefined} />

{#if running}
  <p class="sec caps">In progress</p>
  <RunningCard session={running} />
{/if}

{#if plans.today.length}
  <p class="sec caps">Planned</p>
  <div class="cards">
    {#each plans.today as session, i (session.id)}
      <PlanCard {session} primary={i === 0 && !running} />
    {/each}
  </div>
{/if}

{#if plans.overdue.length}
  <p class="sec caps">Overdue <span class="meta">not started</span></p>
  {@render planRows(plans.overdue)}
{/if}

{#if plans.thisWeek.length}
  <p class="sec caps">Later this week</p>
  {@render planRows(plans.thisWeek)}
{/if}

{#if plans.ahead.length}
  <p class="sec caps">Coming up</p>
  {@render planRows(plans.ahead)}
{/if}

<ul class="group starts">
  {#if !running}
    <li class="row-link">
      <button onclick={() => app.create(null)}>
        <span class="grow">
          <span class="t">Start an empty session</span>
          <span class="s">Add exercises as you go</span>
        </span>
        <Icon name="chev" size="sm" />
      </button>
    </li>
  {/if}
  <li class="row-link">
    <button onclick={() => (picking = 'plan')}>
      <span class="grow">
        <span class="t">Plan one ahead</span>
        <span class="s">Fresh or from a template, started on the day</span>
      </span>
      <Icon name="calendar" />
    </button>
  </li>
  <li class="row-link">
    <button onclick={() => (picking = 'log')}>
      <span class="grow">
        <span class="t">Log a past session</span>
        <span class="s">Pick the day it happened</span>
      </span>
      <Icon name="calendar" />
    </button>
  </li>
</ul>

<p class="sec caps">
  Templates
  {#if app.templates.length}<span class="meta">{app.templates.length}</span>{/if}
</p>
<TemplateFolders templates={app.templates} />

<CalendarSheet
  open={picking === 'plan'}
  onclose={() => (picking = null)}
  label="Pick a day to plan"
  sessions={app.current}
  {today}
  min={today}
  onpick={pickedDay}
/>

<CalendarSheet
  open={picking === 'log'}
  onclose={() => (picking = null)}
  label="Pick the day it happened"
  sessions={app.current}
  {today}
  max={today}
  onpick={pickedDay}
/>

<Sheet
  open={planning !== null}
  onclose={() => (planning = null)}
  label="Plan {planning ? longDate(planning) : ''}"
>
  <h2 class="pick-title caps">Plan {planning ? longDate(planning) : ''}</h2>
  <ul class="group pick">
    <li class="row-link">
      <button onclick={() => plan(null)}>
        <span class="grow">
          <span class="t">Start fresh</span>
          <span class="s">An empty plan to fill in</span>
        </span>
        <Icon name="chev" size="sm" />
      </button>
    </li>
    {#each app.templates as template (template.id)}
      <li class="row-link">
        <button onclick={() => plan(template)}>
          <span class="grow">
            <span class="t">{template.name}</span>
            <span class="s">{templateLine(template)}</span>
          </span>
          <Icon name="chev" size="sm" />
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<div class="frieze">
  <Boulder size="frieze" progress={0} label={null} />
  {#if wit && !running}<p class="meta caption">The boulder is at the bottom again.</p>{/if}
</div>

<style>
  .cards {
    display: grid;
    gap: var(--space-3);
  }

  .open {
    min-width: 0;
    min-height: 44px;
    text-align: left;
  }

  /* The count after a section label is a quiet aside, not another inscription. */
  .sec .meta {
    font-family: var(--font-text);
    letter-spacing: 0;
    text-transform: none;
  }

  .starts {
    margin-top: var(--space-5);
  }

  .pick-title {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-label);
    color: var(--ink-2);
  }

  /* Edge to edge inside the sheet, which already keeps the gutter. */
  .pick {
    margin: 0;
  }

  .frieze {
    margin: var(--space-6) var(--gutter) 0;
  }

  .caption {
    margin-top: 6px;
    text-align: center;
    font-size: 0.875rem;
  }
</style>
