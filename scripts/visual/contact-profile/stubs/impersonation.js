import { fixture } from './fixture.js';
export const getEffectiveUser = () => (fixture.readonly ? { uid: 'target', _isImpersonated: true } : { uid: 'u1' });
export const useImpersonation = () => ({ isImpersonating: fixture.readonly });
export const getActiveUserId = () => getEffectiveUser().uid;
export const useActiveUserId = getActiveUserId;
