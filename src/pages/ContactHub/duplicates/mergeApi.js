import { auth } from '../../../firebase/config';
import { getEffectiveUser } from '../../../context/ImpersonationContext';

export const mergeReviewEnabled = () => import.meta.env.VITE_CONTACT_HUB_MERGE === 'on';

export async function mergeRequest(uid, action, fields = {}, active = () => true) {
  const user = auth.currentUser;
  const current = () => {
    const effective = getEffectiveUser();
    return active() && user?.uid === uid && auth.currentUser === user
      && effective?.uid === uid && !effective._isImpersonated;
  };
  if (!current()) throw new Error('read_only');
  const bearer = await user.getIdToken();
  if (!current()) throw new Error('read_only');
  const response = await fetch('/.netlify/functions/contact-hub-merge', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, action, ...fields }),
  });
  const result = await response.json();
  if (!current()) throw new Error('read_only');
  if (!response.ok) throw new Error(result.error || 'unavailable');
  return result;
}
