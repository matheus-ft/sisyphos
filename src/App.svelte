<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './ui/app.svelte';
  import Banner from './ui/kit/Banner.svelte';
  import Boulder from './ui/kit/Boulder.svelte';
  import DialogHost from './ui/kit/DialogHost.svelte';
  import TabBar from './ui/kit/TabBar.svelte';
  import ToastHost from './ui/kit/ToastHost.svelte';
  import { showToast } from './ui/overlays.svelte';
  import { routeHash, tabOf } from './ui/route';
  import Agora from './ui/screens/Agora.svelte';
  import Setup from './ui/screens/agora/Setup.svelte';
  import ExerciseHistory from './ui/screens/ExerciseHistory.svelte';
  import History from './ui/screens/History.svelte';
  import NewExercise from './ui/screens/NewExercise.svelte';
  import Progress from './ui/screens/Progress.svelte';
  import Template from './ui/screens/Template.svelte';
  import Train from './ui/screens/Train.svelte';
  import FinishScreen from './ui/session/FinishScreen.svelte';
  import SessionView from './ui/session/SessionView.svelte';
  import ConflictNotice from './ui/ConflictNotice.svelte';
  import { noticeShown } from './ui/conflicts';
  import { bannerOf } from './ui/status';
  import { update } from './ui/update.svelte';
  import { showUpdateNotice } from './ui/update';

  /**
   * The shell: the screen the route names, the tab bar under it, and what
   * shows over every screen (the banner, the conflict notice, toasts and
   * dialogs). State and actions live in ui/app.svelte.ts.
   */

  onMount(() => {
    update.start();
    return app.boot();
  });

  const route = $derived(app.route);
  /** A session is a focused mode, with its own back: the tab bar steps aside. */
  const focused = $derived(route.name === 'session' || route.name === 'finish');
  const takeover = $derived(app.showSetup || app.creating !== null);
  const docked = $derived(!focused && !takeover && app.storage !== null);
  const banner = $derived(app.status ? bannerOf(app.status, app.inSession) : null);
  const conflicts = $derived((app.status?.conflicts ?? 0) + (app.status?.libraryConflicts ?? 0));
  const trainHref = $derived(
    app.running ? routeHash({ name: 'session', id: app.running.id }) : routeHash({ name: 'train' }),
  );
  const exercise = $derived(
    route.name === 'exercise' ? app.library.find((e) => e.id === route.id) : undefined,
  );

  // Each screen opens at its top, as a new page would.
  $effect(() => {
    void route;
    window.scrollTo(0, 0);
  });
</script>

<div
  class="shell"
  class:docked
  style:--dock={docked ? 'var(--tabbar-total)' : 'var(--safe-bottom)'}
>
  {#if banner && !takeover}
    <Banner
      kind={banner.kind}
      text={banner.text}
      action={banner.action
        ? {
            label: banner.action.label,
            href: routeHash({ name: 'more', page: banner.action.to }),
          }
        : undefined}
    />
  {/if}
  {#if showUpdateNotice({ waiting: update.waiting, inSession: app.inSession, takeover })}
    <Banner
      kind="info"
      text="A new version is ready"
      action={{ label: 'Reload', onclick: update.reload }}
    />
  {/if}
  {#if app.failure}<p class="failure" role="alert">{app.failure}</p>{/if}

  <main>
    {#if !app.storage}
      <div class="boot">
        {#if !app.failure}<Boulder size="frieze" progress={0} label="Opening" />{/if}
      </div>
    {:else if app.showSetup}
      <Setup greeting onclose={() => (app.showSetup = false)} />
    {:else if app.creating !== null}
      <NewExercise
        name={app.creating}
        library={app.library}
        onsave={app.createExercise}
        onclose={() => (app.creating = null)}
      />
    {:else if route.name === 'session' && app.session}
      <SessionView session={app.session} />
    {:else if route.name === 'finish' && app.session}
      <FinishScreen
        session={app.session}
        library={app.library}
        sessions={app.current}
        ondone={app.closeFinish}
        onsavetemplate={app.saveAsTemplate}
        onshare={() => showToast({ message: 'Sharing is not built yet' })}
      />
    {:else if route.name === 'template' && app.template}
      <Template template={app.template} />
    {:else if route.name === 'exercise' && exercise}
      <ExerciseHistory {exercise} />
    {:else if route.name === 'history'}
      <History />
    {:else if route.name === 'progress'}
      <Progress view={route.view} />
    {:else if route.name === 'more'}
      <Agora page={route.page} />
    {:else if route.name === 'train'}
      <Train />
    {/if}
  </main>

  {#if docked}
    <TabBar current={tabOf(route)} {trainHref} {conflicts} />
  {/if}

  {#if app.storage && noticeShown( { requested: app.conflictNotice, count: conflicts, inSession: app.inSession, finishing: route.name === 'finish', takeover } )}
    <ConflictNotice
      count={conflicts}
      onreview={() => {
        app.conflictNotice = false;
        app.go({ name: 'more', page: 'conflicts' });
      }}
      onlater={() => (app.conflictNotice = false)}
    />
  {/if}

  <ToastHost />
  <DialogHost />
</div>

<style>
  .shell {
    max-width: 40rem;
    margin: 0 auto;
  }

  main {
    padding-bottom: var(--space-8);
  }

  /* Clear of the tab bar; body already pads the home indicator. */
  .docked main {
    padding-bottom: calc(var(--tabbar-h) + var(--space-6));
  }

  .failure {
    margin: var(--space-2) var(--gutter);
    color: var(--danger);
  }

  .boot {
    padding: 30dvh var(--gutter) 0;
  }
</style>
