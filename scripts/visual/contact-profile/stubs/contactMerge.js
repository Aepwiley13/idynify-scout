import { seedFixtureDoc } from './firestore';
import { getEffectiveUser } from './impersonation';

export const mergeReviewEnabled = () => new URLSearchParams(window.location.search).get('merge_demo') === '1';

const storage = 'fixture-contact-merge-dismissals';
const read = () => JSON.parse(sessionStorage.getItem(storage) ?? '[]');
let receipt = null;
let last = null;

export async function mergeRequest(uid, action, input, active) {
  if (uid !== getEffectiveUser().uid || getEffectiveUser()._isImpersonated || !active()) throw new Error('read_only');
  if (action === 'dismissals') return { pairs: read(), latest: receipt };
  if (action === 'dismiss' || action === 'restore') {
    const pair = [input.sourceId, input.survivorId].sort();
    const retained = read().filter((value) => JSON.stringify(value) !== JSON.stringify(pair));
    sessionStorage.setItem(storage, JSON.stringify(action === 'dismiss' ? [...retained, pair] : retained));
    return { pair };
  }
  if (action === 'preview') {
    const supported = [input.sourceId, input.survivorId].sort().join() === 'jordan,jordan-import';
    const selected = input.choices.title;
    last = { ...input, token: 'fixture-verified-preview' };
    return {
      conflicts: supported ? [{ key: 'title', options: ['Community Partner', 'Volunteer Coordinator'] }] : [],
      blockers: supported ? [] : ['identity_not_verified'],
      combined: { name: 'Jordan Lee', emails: ['jordan@communityslc.org', 'jordan.personal@example.org'], phones: ['801-555-0101'], notes: 2 },
      activityCount: 2, token: supported && Number.isInteger(selected) ? last.token : null,
    };
  }
  if (action === 'commit') {
    if (receipt) return { receipt };
    if (!last || input.token !== last.token) throw new Error('preview_changed');
    receipt = { status: 'merged', operationId: input.operationId, survivorId: input.survivorId,
      sourceId: input.sourceId, rollbackUntil: Date.now() + 7 * 86400000 };
    seedFixtureDoc(`users/${uid}/contacts/${input.sourceId}`, { name: 'Jordan Lee', is_archived: true,
      contact_hub_lifecycle: { status: 'retired' } });
    return { receipt };
  }
  if (action === 'status') return { receipt };
  if (action === 'redirect') return { survivorId: receipt?.status === 'merged' && receipt.sourceId === input.sourceId ? receipt.survivorId : null };
  if (action === 'preview_rollback' && receipt?.status === 'merged') return { token: 'fixture-rollback', receipt };
  if (action === 'rollback' && input.token === 'fixture-rollback') {
    seedFixtureDoc(`users/${uid}/contacts/${receipt.sourceId}`, { id: receipt.sourceId, name: 'Jordan Lee', email: 'jordan@communityslc.org' });
    receipt = { ...receipt, status: 'rolled_back' };
    return { receipt };
  }
  throw new Error('unavailable');
}
