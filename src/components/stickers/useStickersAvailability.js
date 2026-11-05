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
 *
 * recheck() asks the server again. A surface calls it after a write the rules
 * refused as not allowed (DENIAL_REASONS.WRITE_DENIED), so access revoked
 * mid-session hides every sticker control on the next answer.
 */
import { useCallback, useEffect, useState } from 'react';
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

/** { state, recheck }: the answer, and a way to ask again. */
export function useStickersAvailabilityControl() {
  const [impersonating] = useState(viewingAsSomeoneElse);
  const [state, setState] = useState(impersonating ? AVAILABILITY.UNAVAILABLE : AVAILABILITY.CHECKING);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (impersonating) return undefined;
    let live = true;
    Promise.resolve()
      .then(fetchStickersConfig)
      .then((answer) => { if (live) setState(availabilityFromConfig(answer)); })
      .catch(() => { if (live) setState(AVAILABILITY.UNAVAILABLE); });
    return () => { live = false; };
  }, [impersonating, round]);

  const recheck = useCallback(() => {
    if (!impersonating) setRound((n) => n + 1);
  }, [impersonating]);

  return { state, recheck };
}

export function useStickersAvailability() {
  return useStickersAvailabilityControl().state;
}

export default useStickersAvailability;
