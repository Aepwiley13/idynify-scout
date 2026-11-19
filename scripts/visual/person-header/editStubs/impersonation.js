const params = new URLSearchParams(window.location.search);
const impersonated = params.get('readonly') === '1';
const user = impersonated ? { uid: 'target', _isImpersonated: true } : { uid: 'u1' };
export const getEffectiveUser = () => user;
export const useImpersonation = () => ({ isImpersonating: impersonated });
export const getActiveUserId = () => user.uid;
