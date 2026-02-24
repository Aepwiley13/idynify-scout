/**
 * outreachService.js — Phase 3 Service Layer
 *
 * Handles outreach message generation via Barry and clipboard utilities.
 * Results are cached per company ID for the session lifetime.
 */

import { auth } from '../firebase/config';

// Session cache: companyId → generated message string
const messageCache = {};

/**
 * Generate a personalized cold outreach message for a company.
 * Calls the barryOutreachMessage Netlify function (Claude API).
 * Caches result by companyId — Barry doesn't regenerate on re-open.
 */
export async function generateOpeningMessage(companyData, icpData, signals = []) {
  const cacheKey = companyData.id;
  if (messageCache[cacheKey]) {
    return { message: messageCache[cacheKey] };
  }

  try {
    const user = auth.currentUser;
    if (!user) return { error: 'Not authenticated' };

    const authToken = await user.getIdToken();

    const resp = await fetch('/.netlify/functions/barryOutreachMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authToken,
        userId: user.uid,
        company: companyData,
        icpProfile: icpData,
        signals,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { error: err.error || `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    if (data.message) {
      messageCache[cacheKey] = data.message;
      return { message: data.message };
    }
    return { error: data.error || 'Generation failed' };
  } catch (err) {
    console.error('[outreachService] generateOpeningMessage error:', err);
    return { error: err.message || 'Network error' };
  }
}

/**
 * Copy text to clipboard.
 * Falls back to document.execCommand for older browser contexts.
 */
export function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    return { success: true };
  } catch (err) {
    console.error('[outreachService] copyToClipboard error:', err);
    return { success: false };
  }
}
