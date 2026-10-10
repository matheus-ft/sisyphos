<script lang="ts">
  import { app } from '../app.svelte';
  import { dateInYear, formatKg, meetBest, labourTabs, recordRows, resolveTab } from '../athloi';
  import EmptyState from '../kit/EmptyState.svelte';
  import Laurel from '../kit/Laurel.svelte';
  import LiftTabs from '../kit/LiftTabs.svelte';
  import { routeHash } from '../route';

  /**
   * A record-keeping lift's best weight at each rep count from 1 to 10, from
   * sessions and by hand together; above them, its best at a meet, which is
   * none of them. A hand-entered record and the meet link to the pages that
   * edit them.
   */
  interface Props {
    today: string;
    picked: string | null;
    onpick: (id: string) => void;
  }
  let { today, picked, onpick }: Props = $props();

  const tabs = $derived(labourTabs(app.records, app.library, app.meets));
  const chosen = $derived(resolveTab(tabs, picked));
  const rows = $derived(
    chosen
      ? recordRows(app.records, chosen.exercise.id, today, {
          added: chosen.exercise.load_type === 'bw_plus',
        })
      : [],
  );
  const meet = $derived(chosen ? meetBest(app.meets, chosen.exercise.id) : null);

  const meetsHref = routeHash({ name: 'more', page: 'meets' });
  const recordsHref = routeHash({ name: 'more', page: 'records' });

  /** A session record opens its session. */
  function open(sessionId: string | null): void {
    const session = app.current.find((s) => s.id === sessionId);
    if (session) app.openSession(session);
  }
</script>

{#if !chosen}
  <EmptyState
    title="No records yet"
    line="Records appear as you log the competition lifts, in sets of 1 to 10 reps."
  />
{:else}
  <LiftTabs
    tabs={tabs.map((t) => ({ id: t.exercise.id, label: t.label, name: t.exercise.name }))}
    value={chosen.exercise.id}
    onchange={onpick}
    label="Lift"
  >
    {#if chosen.last === null}
      <EmptyState
        title="No records yet"
        line="Records appear as you log the competition lifts, in sets of 1 to 10 reps."
      />
    {:else}
      <p class="controls meta">best weight for each rep count</p>

      {#if meet}
        <a
          class="card meet"
          href={meetsHref}
          aria-label="At a meet, {formatKg(meet.kg)} kilograms, {dateInYear(
            meet.date,
            today,
          )}{meet.meet ? `, ${meet.meet}` : ''}. Open Meets"
        >
          <span class="caps">At a meet</span>
          <span class="weight">
            <span class="figure-num w">{formatKg(meet.kg)}</span>
            <span class="unit">kg</span>
          </span>
          <span class="when meta">
            <span>{dateInYear(meet.date, today)}</span>
            {#if meet.meet}<span>{meet.meet}</span>{/if}
          </span>
        </a>
      {/if}

      <ul class="card rows">
        {#each rows as row (row.reps)}
          <li class:recent={row.recent} class:none={row.weight === null}>
            {#snippet inner()}
              <span class="reps">
                <span class="n figure-num">{row.reps}</span>
                <span class="caps">{row.reps === 1 ? 'rep' : 'reps'}</span>
              </span>
              {#if row.weight !== null}
                <span class="weight">
                  {#if row.recent}<Laurel size={16} />{/if}
                  <span class="figure-num w">{row.weight}</span>
                  <span class="unit">kg</span>
                </span>
                <span class="when meta">
                  <span>{row.date}</span>
                  <span>{row.source}</span>
                </span>
              {:else}
                <span class="empty meta">no record yet</span>
              {/if}
            {/snippet}
            {#if row.manual}
              <a href={recordsHref} aria-label="{row.spoken}. Edit under Records">
                {@render inner()}
              </a>
            {:else if row.sessionId !== null}
              <button
                aria-label="{row.spoken}. Open the session"
                onclick={() => open(row.sessionId)}
              >
                {@render inner()}
              </button>
            {:else}
              <div class="plain" role="group" aria-label={row.spoken}>{@render inner()}</div>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="foot">
        {#if rows.some((r) => r.manual)}Records marked “by hand” were entered under Records in More.{/if}
      </p>
    {/if}
  </LiftTabs>
{/if}

<style>
  .controls {
    margin: var(--space-3) var(--gutter) var(--space-3);
  }

  /* Apart from the table: a meet's single is not the one-rep record beneath it. */
  .meet {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-3);
    width: calc(100% - 24px);
    min-height: 52px;
    margin: 0 12px var(--space-3);
    padding: 4px var(--space-4) 4px var(--space-3);
    border-color: var(--line-strong);
    text-align: left;
    color: inherit;
    text-decoration: none;
  }

  .meet .caps {
    color: var(--muted);
  }

  .meet:active {
    background: var(--sunken);
  }

  .rows {
    margin: 0 12px;
    padding: 0;
    overflow: hidden;
    list-style: none;
  }

  li + li {
    border-top: var(--hairline) solid var(--line);
  }

  li.recent {
    background: var(--laurel-wash);
  }

  button,
  a:not(.meet),
  .plain {
    display: grid;
    text-decoration: none;
    grid-template-columns: 44px 1fr auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 4px var(--space-4) 4px var(--space-3);
    text-align: left;
    color: inherit;
  }

  button:active,
  a:active {
    background: var(--sunken);
  }

  .reps {
    display: grid;
    justify-items: center;
    gap: 2px;
  }

  .n {
    font-size: 1.0625rem;
    line-height: 1;
  }

  .reps .caps {
    font-size: 0.5625rem;
    color: var(--muted);
  }

  .weight {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }

  .weight :global(.laurel) {
    align-self: center;
  }

  .w {
    font-size: 1.375rem;
    line-height: 1;
  }

  .unit {
    font-style: italic;
    color: var(--muted);
    font-size: var(--fs-meta);
  }

  .when {
    display: grid;
    justify-items: end;
    font-size: 0.8125rem;
    line-height: 1.25;
  }

  li.none .empty {
    grid-column: 2 / 4;
    color: var(--muted);
  }

  .foot {
    margin: var(--space-2) var(--gutter) 0;
    font: italic 0.875rem / 1.35 var(--font-text);
    color: var(--muted);
  }
</style>
