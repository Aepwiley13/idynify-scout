/**
 * May this person use Scan Business Card here? One answer for the Scout card.
 *
 * The server decides: captureConfig answers for the signed-in user from
 * the capture mode setting (internal = admins and super admins only) and the existing
 * admin checks, which this does not repeat or change. Every capture endpoint
 * checks the mode again on its own, so this only decides what the card shows.
 *
 * Never while an admin is viewing as another user: that view is read-only, and
 * a scan runs as the signed-in admin, so it would read the card as one person
 * and show it in another's workspace.
 *
 *   'checking'     not known yet: the card stays "Coming soon"
 *   'available'    the card opens the capture flow
 *   'unavailable'  the card stays "Coming soon"
 */
import { useEffect, useState } from 'react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { fetchCaptureConfig } from './captureLabApi.js';

function viewingAsSomeoneElse() {
  try {
    return Boolean(getEffectiveUser()?._isImpersonated);
  } catch {
    return true;
  }
}

export function useCaptureAvailability() {
  const [impersonating] = useState(viewingAsSomeoneElse);
  const [state, setState] = useState(impersonating ? 'unavailable' : 'checking');

  useEffect(() => {
    if (impersonating) return undefined;
    let live = true;
    Promise.resolve()
      .then(fetchCaptureConfig)
      .then(({ status, body }) => {
        if (live) setState(status === 200 && body?.enabled === true ? 'available' : 'unavailable');
      })
      .catch(() => { if (live) setState('unavailable'); });
    return () => { live = false; };
  }, [impersonating]);

  return state;
}

export default useCaptureAvailability;
