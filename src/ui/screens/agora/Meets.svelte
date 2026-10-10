<script lang="ts">
  import Meets from '../../agora/Meets.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /** Agora › Meets: the competitions, their attempts and totals. */
</script>

<ScreenHeader title="Meets" back={{ href: routeHash({ name: 'more', page: null }) }} />

<Meets />
