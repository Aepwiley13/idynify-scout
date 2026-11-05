/**
 * May this person use stickers here? One answer for every sticker surface.
 *
 * The server decides (stickersConfig, the same decision firestore.rules
 * make). Never while an admin is viewing as another user: that view is
 * read-only, and the rules would refuse the admin's writes on that user's
 * data anyway.
 *
 *   'checking'     not known yet: sticker controls stay hidden
 *   'available'    show sticker controls
 *   'unavailable'  keep them hidden
 */
import { useEffect, useState } from 'react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { fetchStickersConfig } from './stickersApi.js';
import { AVAILABILITY, availabilityFromConfig } from './stickersAvailabilityState.js';

function viewingAsSomeoneElse() {
  try {
    return Boolean(getEffectiveUser()?._isImpersonated);
  } catch {
    return true;
  }
}

export function useStickersAvailability() {
  const [impersonating] = useState(viewingAsSomeoneElse);
  const [state, setState] = useState(impersonating ? AVAILABILITY.UNAVAILABLE : AVAILABILITY.CHECKING);

  useEffect(() => {
    if (impersonating) return undefined;
    let live = true;
    Promise.resolve()
      .then(fetchStickersConfig)
      .then((answer) => { if (live) setState(availabilityFromConfig(answer)); })
      .catch(() => { if (live) setState(AVAILABILITY.UNAVAILABLE); });
    return () => { live = false; };
  }, [impersonating]);

  return state;
}

export default useStickersAvailability;
