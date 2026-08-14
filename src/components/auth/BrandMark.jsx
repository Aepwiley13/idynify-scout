/**
 * BrandMark — the IDYNIFY lockup for the pre-auth surface.
 *
 * Two variants, per Aaron's Phase 2 response §6:
 *   full     wordmark  — signup, sign in, forgot password
 *   compact  ID badge  — where the wordmark does not fit
 *
 * Falls back to text rather than rendering nothing, the same way
 * Sidebar.jsx:80-104 does. That pattern exists because a brand asset that
 * 404s used to leave the top of the page blank in any environment where the
 * file was not deployed — and this surface is the one place a missing logo
 * costs the most, since the visitor has no other evidence of whose account
 * they are creating.
 *
 * The asset paths live in AUTH_ASSETS. When an official vector arrives it is
 * swapped there and nothing in this file changes.
 */

import { useState } from 'react';
import { AUTH_ASSETS } from '../../theme/tokens';

export default function BrandMark({ variant = 'full', className = '' }) {
  const [failed, setFailed] = useState(false);
  const compact = variant === 'compact';

  if (failed) {
    return (
      <span className={`auth-brand-fallback ${compact ? 'compact' : ''} ${className}`}>
        {compact ? 'ID' : 'IDYNIFY'}
      </span>
    );
  }

  return (
    <img
      className={`auth-brand-img ${compact ? 'compact' : ''} ${className}`}
      src={compact ? AUTH_ASSETS.icon : AUTH_ASSETS.wordmark}
      alt="IDYNIFY"
      onError={() => setFailed(true)}
    />
  );
}
