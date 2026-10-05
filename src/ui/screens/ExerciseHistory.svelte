<script lang="ts">
  import type { Exercise } from '../../model';
  import { app } from '../app.svelte';
  import { bodyweightAtFrom } from '../athloi';
  import { dayOfMonth, shortDate } from '../format';
  import { e1rmText, exerciseHistory, plural } from '../history-view';
  import Icon from '../kit/Icon.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import Laurel from '../kit/Laurel.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import { routeHash } from '../route';

  /**
   * One exercise's history (#/exercise/<id>): its best e1RM and records, then
   * every session that did it, newest first, so last time's numbers are a
   * glance away.
   */
  interface Props {
    exercise: Exercise;
  }
  let { exercise }: Props = $props();

  const view = $derived(
    exerciseHistory(exercise, app.current, app.records, bodyweightAtFrom(app.bodyweights)),
  );
  const monthCaps = (date: string) =>
    shortDate(date)
      .replace(/^\d+\s*/, '')
      .toUpperCase();
</script>

<ScreenHeader title={exercise.name} back={{ onclick: () => app.back({ name: 'history' }) }} />

{#if view.sessions === 0}
  <EmptyState title="Not logged yet" line="Its sets appear here once a session holds them." />
{:else}
  <section class="card summary" aria-label="Best">
    <div class="best">
      <span class="caps lab">Best</span>
      {#if view.bestE1rm}
        <span class="figure-num big">{e1rmText(view.bestE1rm.kg)}<span class="unit">kg</span></span>
        <span class="meta">e1RM, set {shortDate(view.bestE1rm.date)}</span>
      {:else if view.longest}
        <span class="figure-num big">{view.longest.text}</span>
        <span class="meta">longest hold, {shortDate(view.longest.date)}</span>
      {:else}
        <span class="meta none">No set to estimate a max from yet</span>
      {/if}
    </div>
    {#if view.records > 0}
      <a
        class="records"
        href={routeHash({ name: 'progress', view: 'labours', exercise: exercise.id })}
      >
        <Laurel size={20} />
        <span>{plural(view.records, 'record', 'records')}</span>
        <Icon name="chev" size="sm" />
      </a>
    {/if}
  </section>

  {#each view.months as month (month.key)}
    <h2 class="sec">
      <span class="caps">{month.label}</span>
      <span class="meta">{plural(month.visits.length, 'session', 'sessions')}</span>
    </h2>
    <ul class="group">
      {#each month.visits as visit (visit.session.id)}
        <li class="row-link">
          <button onclick={() => app.openSession(visit.session)}>
            <span class="day">
              <span class="num">{dayOfMonth(visit.session.date)}</span>
              <span class="wd caps">{monthCaps(visit.session.date)}</span>
            </span>
            <span class="grow">
              <span class="t sets">
                {#each visit.sets as set, i (i)}<span>{set}</span>{/each}
              </span>
              {#if visit.best && visit.sets.length > 1}<span class="s">best {visit.best.text}</span
                >{/if}
            </span>
            {#if visit.best?.e1rm != null}
              <span class="r">
                <span class="meta">e1RM</span>
                <span class="e1rm">{e1rmText(visit.best.e1rm)}</span>
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/each}
{/if}

<style>
  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-3) 12px 0;
    padding: var(--space-4);
  }

  .best {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .lab {
    font-size: var(--fs-label);
    color: var(--ink-2);
  }

  .big {
    font-size: var(--fs-stat);
    line-height: 1;
  }

  .unit {
    margin-left: 0.25em;
    font: italic var(--fs-meta) var(--font-text);
    color: var(--muted);
  }

  .records {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    padding-left: var(--space-3);
    color: var(--accent);
    text-decoration: none;
  }

  .records:hover span {
    text-decoration: underline;
  }

  .day {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    width: 44px;
  }

  .num {
    font: var(--fw-num) 1.5rem / 1 var(--font-num);
  }

  .wd {
    margin-top: 3px;
    font-size: 0.65625rem;
    color: var(--muted);
  }

  /* Each set stays whole when the line wraps. */
  .sets {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    font-weight: var(--fw-num);
    line-height: var(--lh-snug);
  }

  .sets span {
    white-space: nowrap;
  }

  .r {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    color: var(--muted);
  }

  .e1rm {
    font: var(--fw-num) var(--fs-row) / 1 var(--font-num);
    color: var(--ink);
  }
</style>
