#!/usr/bin/env node
/**
 * Build gate: refuse to ship a bundle whose API key and project id disagree.
 *
 * Runs before `vite build` (see netlify.toml). The reasoning, and why only a
 * definitive answer is fatal, is in ./firebaseKeyProject.mjs.
 *
 * Escape hatch: FIREBASE_KEY_CHECK_DISABLED=1 skips it entirely. It exists so
 * that a wrong guard can never be the reason a fix cannot be deployed during
 * an incident. Using it is a decision someone makes out loud, not a default.
 */

import { checkKeyMatchesProject, describeVerdict } from './firebaseKeyProject.mjs';

if (process.env.FIREBASE_KEY_CHECK_DISABLED === '1') {
  console.log('· Firebase key/project check disabled via FIREBASE_KEY_CHECK_DISABLED=1');
  process.exit(0);
}

const verdict = await checkKeyMatchesProject({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  senderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
});

// No `|| fallback` here: describeVerdict supplies its own placeholder, and a
// project id with a literal default is the exact shape checkNoHardcodedProjectId
// exists to reject — including when it is only ever printed.
const { fatal, text } = describeVerdict(verdict, process.env.VITE_FIREBASE_PROJECT_ID);

(fatal ? console.error : console.log)(text);
process.exit(fatal ? 1 : 0);
