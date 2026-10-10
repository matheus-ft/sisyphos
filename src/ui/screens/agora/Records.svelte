<script lang="ts">
  import RecordsTable from '../../agora/RecordsTable.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /**
   * Agora › Records: the best weight at each rep count for the four competition
   * lifts, what the sessions set and what was entered by hand, together.
   */
</script>

<ScreenHeader title="Records" back={{ href: routeHash({ name: 'more', page: null }) }} />

<RecordsTable />
