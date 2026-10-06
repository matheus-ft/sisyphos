<script lang="ts">
  import { routeHash, type Tab } from '../route';

  /**
   * The four tabs, fixed to the foot of the screen: the Greek word large, the
   * English small beneath. Each is a link to its hash route. While a session
   * runs, the shell points Train back at it.
   */
  interface Props {
    current: Tab;
    /** Where Train leads: the running session's route while there is one. */
    trainHref?: string;
    /** Conflicts waiting, marked on Agora. */
    conflicts?: number;
  }
  let { current, trainHref = routeHash({ name: 'train' }), conflicts = 0 }: Props = $props();

  const tabs = $derived<{ tab: Tab; greek: string; english: string; href: string }[]>([
    { tab: 'train', greek: 'Askēsis', english: 'Train', href: trainHref },
    { tab: 'history', greek: 'Historia', english: 'History', href: routeHash({ name: 'history' }) },
    {
      tab: 'progress',
      greek: 'Athloi',
      english: 'Progress',
      href: routeHash({ name: 'progress', view: 'body' }),
    },
    { tab: 'more', greek: 'Agora', english: 'More', href: routeHash({ name: 'more', page: null }) },
  ]);
</script>

<nav class="tabbar" aria-label="Sections">
  {#each tabs as t (t.tab)}
    <a class="tab" href={t.href} aria-current={current === t.tab ? 'page' : undefined}>
      <span class="gr" lang="grc-Latn">{t.greek}</span>
      <span class="en">{t.english}</span>
      {#if t.tab === 'more' && conflicts > 0}
        <span
          class="badge"
          role="img"
          aria-label="{conflicts} {conflicts === 1 ? 'conflict' : 'conflicts'}"
        ></span>
      {/if}
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--z-tabbar);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    height: var(--tabbar-total);
    padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
    background: var(--surface);
    border-top: var(--hairline) solid var(--line);
  }

  .tab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: var(--tap);
    text-decoration: none;
  }

  /* Mixed case, so Cinzel's small capitals keep "Historia" inside a quarter of 375. */
  .gr {
    font: var(--fw-display) var(--fs-tab) / 1.05 var(--font-display);
    letter-spacing: 0.04em;
    color: var(--ink-2);
  }

  .en {
    font: italic var(--fs-tab-en) / 1 var(--font-text);
    color: var(--muted);
  }

  .tab[aria-current='page'] .gr {
    color: var(--ink);
  }

  .tab[aria-current='page'] .en {
    color: var(--ink-2);
  }

  .tab[aria-current='page']::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 50%;
    width: 32px;
    height: 3px;
    margin-left: -16px;
    border-radius: 0 0 2px 2px;
    background: var(--accent);
  }

  .badge {
    position: absolute;
    top: 9px;
    left: calc(50% + 26px);
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--warning);
    box-shadow: 0 0 0 2px var(--surface);
  }
</style>
