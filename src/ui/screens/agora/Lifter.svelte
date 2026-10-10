<script lang="ts">
  import { onMount } from 'svelte';
  import Bodyweight from '../../agora/Bodyweight.svelte';
  import CompetitionBests from '../../agora/CompetitionBests.svelte';
  import HandRecords from '../../agora/HandRecords.svelte';
  import Maxes from '../../agora/Maxes.svelte';
  import { takeAim } from '../../agoraIndex';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';

  /**
   * What is true of the lifter rather than of one session: bodyweight,
   * reference maxes, the bests made at meets and records entered by hand. An index row that named one of
   * them lands here with that section in view.
   */

  onMount(() => {
    const aimed = takeAim();
    if (!aimed) return;
    // After the shell's own scroll to the top on a route change.
    const frame = requestAnimationFrame(() =>
      document.getElementById(aimed)?.scrollIntoView({
        block: 'start',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      }),
    );
    return () => cancelAnimationFrame(frame);
  });
</script>

<ScreenHeader title="Lifter" back={{ href: routeHash({ name: 'more', page: null }) }} />

<Bodyweight />
<Maxes />
<CompetitionBests />
<HandRecords />
