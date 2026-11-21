import { fixture } from './fixture.js';
export async function fetchStickersConfig() {
  if (fixture.stickers === 'off') return { status: 200, body: { enabled: false, mode: 'off', readOnly: false } };
  // An admin viewing as the user gets the user's answer, read-only (as stickersConfig does).
  if (fixture.stickers === 'readonly' || fixture.readonly) return { status: 200, body: { enabled: true, mode: 'beta', readOnly: true } };
  return { status: 200, body: { enabled: true, mode: 'beta', readOnly: false } };
}
