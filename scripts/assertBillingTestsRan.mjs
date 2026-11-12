#!/usr/bin/env node
// Guards against a silent pass: these billing-emulator test files use
// `describe.skipIf(!FIRESTORE_EMULATOR_AVAILABLE)` so that plain `npm test` can skip them
// cleanly without a live emulator. That's correct for local dev, but it means a vitest JSON
// report with every one of these tests SKIPPED (not run) still has `success: true` and
// `numFailedTests: 0` — if the emulator wrapper ever started the inner vitest command without
// FIRESTORE_EMULATOR_HOST actually set (a regression in the wrapping command, not in the tests
// themselves), CI would report green having executed zero of the concurrency/fencing/ownership
// assertions this suite exists for. This script reads the JSON reporter's own summary and fails
// loudly if anything was pending/skipped, or if nothing ran at all.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('assertBillingTestsRan: usage: node assertBillingTestsRan.mjs <vitest-json-report-path>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`assertBillingTestsRan: could not read/parse ${path}: ${err.message}`);
  process.exit(1);
}

const { numTotalTests = 0, numPassedTests = 0, numFailedTests = 0, numPendingTests = 0, success } = report;

const problems = [];
if (numTotalTests === 0) problems.push('numTotalTests is 0 — no test files matched at all');
if (numPendingTests > 0) problems.push(`${numPendingTests} test(s) were pending/skipped instead of executed — the emulator was likely not actually running`);
if (numFailedTests > 0) problems.push(`${numFailedTests} test(s) failed`);
if (success !== true) problems.push('vitest reported success: false');
if (numPassedTests === 0) problems.push('numPassedTests is 0 — nothing actually ran');

if (problems.length > 0) {
  console.error('assertBillingTestsRan: the billing emulator suite did not genuinely execute:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`  (numTotalTests=${numTotalTests} numPassedTests=${numPassedTests} numFailedTests=${numFailedTests} numPendingTests=${numPendingTests})`);
  process.exit(1);
}

console.log(`assertBillingTestsRan: confirmed ${numPassedTests}/${numTotalTests} billing-emulator tests actually executed and passed.`);
