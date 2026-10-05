<script lang="ts">
  import type { Session } from '../../model';
  import { app } from '../app.svelte';
  import {
    dayAndMonth,
    dayOfMonth,
    formatMinutes,
    programLabel,
    sessionMinutes,
    weekOf,
    weekdayShort,
    workingSets,
  } from '../format';
  import EmptyState from '../kit/EmptyState.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';

  /** Historia, the History tab: every session by week, newest first. */

  const names = $derived(new Map(app.library.map((e) => [e.id, e.name])));
  const weeks = $derived.by(() => {
    const started = app.current
      .filter((s) => s.started_at !== null)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || (b.started_at ?? '').localeCompare(a.started_at ?? ''),
      );
    const groups: { week: string; sessions: Session[] }[] = [];
    for (const session of started) {
      const week = weekOf(session.date);
      const group = groups.at(-1);
      if (group?.week === week) group.sessions.push(session);
      else groups.push({ week, sessions: [session] });
    }
    return groups;
  });

  function summary(session: Session): string {
    const list = session.exercises.map((e) => names.get(e.exercise_id) ?? e.exercise_id);
    return list.length ? list.join(', ') : 'No exercises';
  }

  function weekLine(sessions: Session[]): string {
    const sets = sessions.reduce((n, s) => n + workingSets(s), 0);
    const count = sessions.length;
    return `${count} ${count === 1 ? 'session' : 'sessions'} · ${sets} ${sets === 1 ? 'set' : 'sets'}`;
  }

  const pending = (s: Session) =>
    s.exercises.reduce((n, e) => n + e.performed.filter((p) => p.state === 'pending').length, 0);
</script>

<ScreenHeader title="History" />

{#if weeks.length === 0}
  <EmptyState
    title="No sessions yet"
    line="Sessions you log appear here, by week."
    action={{ label: 'Start a session', onclick: () => void app.create(null) }}
  />
{/if}

{#each weeks as group (group.week)}
  <p class="sec">
    <span class="caps">Week of {dayAndMonth(group.week)}</span>
    <span class="meta">{weekLine(group.sessions)}</span>
  </p>
  <ul class="group">
    {#each group.sessions as session (session.id)}
      {@const minutes = sessionMinutes(session)}
      {@const open = pending(session)}
      <li class="row-link">
        <button onclick={() => app.openSession(session)}>
          <span class="day">
            <span class="num">{dayOfMonth(session.date)}</span>
            <span class="wd caps">{weekdayShort(session.date)}</span>
          </span>
          <span class="grow">
            {#if programLabel(session.label)}<span class="s">{programLabel(session.label)}</span
              >{/if}
            <span class="t what">{summary(session)}</span>
          </span>
          <span class="r">
            {#if session.ended_at === null}
              <span class="live">in progress</span>
            {:else if minutes !== null}
              <span>{formatMinutes(minutes)}</span>
            {/if}
            {#if open > 0}<span class="pending"><i></i>{open} pending</span>{/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/each}

<style>
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 44px;
    flex: none;
  }

  .num {
    font: var(--fw-num) 1.5rem / 1 var(--font-num);
  }

  .wd {
    margin-top: 3px;
    font-size: 0.65625rem;
    color: var(--muted);
  }

  .what {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .r {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    font-size: var(--fs-meta);
    color: var(--muted);
    white-space: nowrap;
  }

  .live {
    color: var(--accent);
    font-style: italic;
  }

  .pending {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-style: italic;
    color: var(--ink-2);
  }

  .pending i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
</style>
