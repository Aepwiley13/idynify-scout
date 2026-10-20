#!/usr/bin/env node
/**
 * Writes the requests the real handlers build for the fixtures to a JSON file,
 * with nothing sent anywhere. The model comes from BARRY_MODEL_SONNET, as in
 * production, so src/test/barrySonnetRequests.test.js can check what each call
 * site sends on each model.
 *
 *   node scripts/sonnet-compare/capture-json.mjs out.json
 */
import './register.mjs';
import { writeFile } from 'node:fs/promises';
import { captureRequests } from './capture.mjs';

const out = process.argv[2];
if (!out) {
  console.error('usage: capture-json.mjs <out.json>');
  process.exit(1);
}
await writeFile(out, JSON.stringify(await captureRequests()));
