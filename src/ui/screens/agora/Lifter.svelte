<script lang="ts">
  import EmptyState from '../../kit/EmptyState.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /** What is true of the lifter rather than of one session: bodyweight, reference maxes, records. */
</script>

<ScreenHeader title="Lifter" back={{ href: routeHash({ name: 'more', page: null }) }} />
<EmptyState
  title="Nothing recorded yet"
  line="Bodyweight, reference maxes and records entered by hand will be kept here."
/>
