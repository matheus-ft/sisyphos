<script lang="ts">
  import Maxes from '../../agora/Maxes.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /** Agora › Reference maxes: the one in force for each competition lift, set by hand. */
</script>

<ScreenHeader title="Reference maxes" back={{ href: routeHash({ name: 'more', page: null }) }} />

<Maxes />
