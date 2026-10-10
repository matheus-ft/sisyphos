<script lang="ts">
  import Bodyweight from '../../agora/Bodyweight.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /** Agora › Bodyweight: the weigh-ins that bodyweight-plus loads read. */
</script>

<ScreenHeader title="Bodyweight" back={{ href: routeHash({ name: 'more', page: null }) }} />

<Bodyweight />
