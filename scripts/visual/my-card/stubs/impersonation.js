/** A stand-in for the impersonation context: on when the address says ?state=impersonating. */
export const useImpersonation = () => ({ isImpersonating: new URLSearchParams(window.location.search).get('state') === 'impersonating' });
