<script lang="ts">
  import { app } from '../../app.svelte';
  import Icon from '../../kit/Icon.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /** This device's settings. */

  let persisted = $state<boolean | null>(null);
  $effect(() => {
    void app.storage?.persisted.then((granted) => (persisted = granted));
  });
</script>

<ScreenHeader title="Settings" back={{ href: routeHash({ name: 'more', page: null }) }} />

<p class="sec caps">This device</p>
<ul class="group">
  <li>
    <span class="grow">
      <span class="t">Persistent storage</span>
      <span class="s">the browser will not clear the log</span>
    </span>
    {#if persisted}
      <span class="granted"><Icon name="check" size="sm" stroke={2.4} /> Granted</span>
    {:else if persisted === false}
      <span class="v">Not yet</span>
    {/if}
  </li>
  <li class="row-link">
    <a href={routeHash({ name: 'more', page: 'sync' })}>
      <span class="grow t">Sync</span>
      <Icon name="chev" size="sm" />
    </a>
  </li>
</ul>
<p class="group-foot">
  The browser keeps the log in its storage, which it may clear under pressure unless it agreed not
  to. Installing the app to the home screen makes that likelier.
</p>

<style>
  .granted {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--success);
  }
</style>
