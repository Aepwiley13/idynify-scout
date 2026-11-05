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
import { getEffectiveUser, useImpersonation } from '../../context/ImpersonationContext';
import { fetchStickersConfig } from './stickersApi.js';
import { AVAILABILITY, availabilityFromConfig } from './stickersAvailabilityState.js';

function viewingAsSomeoneElse() {
  try {
    return Boolean(getEffectiveUser()?._isImpersonated);
  } catch {
    return true;
  }
}

/**
 * { state, recheck }: the answer, and a way to ask again.
 *
 * "Viewing as someone else" is read from the impersonation context, which
 * re-renders when a session starts or ends. It is not only the module cache,
 * which ImpersonationProvider fills in an effect AFTER its children first
 * render, and which the app fills only when the session request returns
 * (after a reload, pages mount first). While viewing as, the server is never
 * asked and the answer is 'unavailable', at once and every render.
 */
export function useStickersAvailabilityControl() {
  const context = useImpersonation();
  const [cachedAtMount] = useState(viewingAsSomeoneElse);
  const impersonating = Boolean(context?.isImpersonating) || cachedAtMount;
  const [answer, setAnswer] = useState(AVAILABILITY.CHECKING);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (impersonating) return undefined;
    let live = true;
    Promise.resolve()
      .then(fetchStickersConfig)
      .then((config) => { if (live) setAnswer(availabilityFromConfig(config)); })
      .catch(() => { if (live) setAnswer(AVAILABILITY.UNAVAILABLE); });
    return () => { live = false; };
  }, [impersonating, round]);

  const recheck = useCallback(() => {
    if (!impersonating) setRound((n) => n + 1);
  }, [impersonating]);

  return { state: impersonating ? AVAILABILITY.UNAVAILABLE : answer, recheck };
}

export function useStickersAvailability() {
  return useStickersAvailabilityControl().state;
}

export default useStickersAvailability;
