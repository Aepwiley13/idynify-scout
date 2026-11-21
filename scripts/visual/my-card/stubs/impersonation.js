/** A stand-in for the impersonation context: on when the address says ?state=impersonating. */
export const useImpersonation = () => ({ isImpersonating: new URLSearchParams(window.location.search).get('state') === 'impersonating' });

/** The stickers question asks whose view this is: never somebody else's, in the fixture (it only looks at the card). */
export const getEffectiveUser = () => null;
