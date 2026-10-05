<script lang="ts">
  import type { Session } from '../../model';
  import { app } from '../app.svelte';
  import {
    formatMinutes,
    longDate,
    programLabel,
    sessionMinutes,
    weekOf,
    weekday,
    workingSets,
  } from '../format';
  import Boulder from '../kit/Boulder.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import { localDate } from '../session';

  /**
   * Askēsis, the Train tab: what to do today. The session running, or today's
   * plan with the one primary button; other plans; starting empty, planning
   * ahead or logging a past session; the templates; and the boulder waiting
   * at the foot of the hill.
   */

  const today = localDate(new Date());
  const names = $derived(new Map(app.library.map((e) => [e.id, e.name])));
  const planned = $derived(
    app.current
      .filter((s) => s.started_at === null && s.ended_at === null)
      .sort((a, b) => a.date.localeCompare(b.date)),
  );
  const todays = $derived(planned.find((s) => s.date === today) ?? null);
  const later = $derived(planned.filter((s) => s !== todays));
  const last = $derived(
    app.current
      .filter((s) => s.ended_at !== null)
      .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
      .at(-1) ?? null,
  );
  /** The myth's one line here, on the first session of a week only. */
  const firstOfWeek = $derived(
    !app.current.some((s) => s.started_at !== null && weekOf(s.date) === weekOf(today)),
  );

  function summary(session: Session): string {
    const list = session.exercises.map((e) => names.get(e.exercise_id) ?? e.exercise_id);
    return list.length ? list.join(' · ') : 'No exercises yet';
  }

  function lastLine(session: Session): string {
    const minutes = sessionMinutes(session);
    const sets = workingSets(session);
    return [
      `Last session ${weekday(session.date)}`,
      minutes !== null ? formatMinutes(minutes) : null,
      `${sets} ${sets === 1 ? 'set' : 'sets'}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function past(value: string): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) void app.create(null, { date: value });
  }
</script>

<ScreenHeader title={longDate(today)} meta={last ? lastLine(last) : undefined} />

{#if app.running}
  {@const running = app.running}
  <p class="sec caps">In progress</p>
  <article class="card card-current plan">
    {#if programLabel(running.label)}<p class="label caps">{programLabel(running.label)}</p>{/if}
    <h2 class="name">{longDate(running.date)}</h2>
    <p class="meta">{summary(running)}</p>
    <Button variant="primary" bench full onclick={() => app.openSession(running)}
      >Back to the session</Button
    >
  </article>
{/if}

{#if todays}
  <p class="sec caps">Planned</p>
  <article class="card plan">
    {#if programLabel(todays.label)}<p class="label caps">{programLabel(todays.label)}</p>{/if}
    <button class="name" onclick={() => app.openSession(todays)}>
      <h2>{todays.label.name ?? 'Today'}</h2>
    </button>
    <p class="meta">{summary(todays)}</p>
    <Button
      variant={app.running ? 'quiet' : 'primary'}
      bench
      full
      disabled={app.running !== null}
      onclick={() => app.startPlanned(todays)}>Start</Button
    >
  </article>
{/if}

{#if later.length}
  <p class="sec caps">{todays ? 'Later' : 'Planned'}</p>
  <ul class="group">
    {#each later as session (session.id)}
      <li>
        <button class="grow open" onclick={() => app.openSession(session)}>
          <span class="t">{longDate(session.date)}</span>
          <span class="s">{programLabel(session.label) ?? summary(session)}</span>
        </button>
        <Button
          variant="quiet"
          disabled={app.running !== null}
          onclick={() => app.startPlanned(session)}>Start</Button
        >
      </li>
    {/each}
  </ul>
{/if}

<div class="starts">
  <Button
    variant={app.running || todays ? 'quiet' : 'primary'}
    bench
    full
    disabled={app.running !== null}
    onclick={() => app.create(null)}>Start an empty session</Button
  >
  <div class="others">
    <Button variant="link" onclick={() => app.create(null, { planned: true })}
      >Plan one ahead</Button
    >
    <label class="past">
      <span>Log a past session on</span>
      <input
        type="date"
        aria-label="Past session date"
        max={today}
        onchange={(e) => past(e.currentTarget.value)}
      />
    </label>
  </div>
</div>

<p class="sec caps">
  Templates
  {#if app.templates.length}<span class="meta">{app.templates.length}</span>{/if}
</p>
<ul class="group">
  {#each app.templates as template (template.id)}
    <li class="row-link">
      <button onclick={() => app.openTemplate(template)}>
        <span class="grow"><span class="t">{template.name}</span></span>
        <Icon name="chev" size="sm" />
      </button>
    </li>
  {/each}
  <li class="row-link">
    <button class="new" onclick={app.createTemplate}>
      <span class="grow t">+ New template</span>
    </button>
  </li>
</ul>

<div class="frieze">
  <Boulder size="frieze" progress={0} label={null} />
  {#if firstOfWeek}<p class="meta caption">The boulder is at the bottom again.</p>{/if}
</div>

<style>
  .plan {
    margin: 0 12px;
    display: grid;
    gap: var(--space-1);
  }

  .label {
    color: var(--accent);
  }

  .name {
    min-height: 0;
    text-align: left;
  }

  .name h2,
  h2.name {
    font: var(--fw-strong) var(--fs-lead) / var(--lh-snug) var(--font-text);
    letter-spacing: 0;
  }

  .plan :global(.button) {
    margin-top: var(--space-3);
  }

  .open {
    min-width: 0;
    text-align: left;
  }

  .starts {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-5) 12px 0;
  }

  .others {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0 var(--space-3);
  }

  .past {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-meta);
    color: var(--ink-2);
  }

  .past input {
    width: 9.5rem;
  }

  .new {
    color: var(--accent);
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
