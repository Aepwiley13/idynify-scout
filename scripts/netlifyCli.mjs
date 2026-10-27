/**
 * Runs the Netlify CLI the person is already logged in with, for the #734
 * Phase 0 measurement scripts. Output stays in memory: nothing is written to
 * disk, and the CLI's own output is never echoed (it can hold log text or
 * environment values). Only a short reason is returned when it fails.
 */
import { execFile } from 'node:child_process';
import process from 'node:process';

const MAX_OUTPUT = 256 * 1024 * 1024;

export class NetlifyCliError extends Error {}

/** `netlify <args>` → its stdout. `exec` is injectable for tests. */
export function runNetlify(args, { exec = execFile } = {}) {
  return new Promise((resolvePromise, reject) => {
    exec('netlify', args, { maxBuffer: MAX_OUTPUT, env: { ...process.env, NO_COLOR: '1' } }, (error, stdout) => {
      if (!error) {
        resolvePromise(String(stdout));
        return;
      }
      if (error.code === 'ENOENT') {
        reject(new NetlifyCliError('the Netlify CLI was not found: install it with `npm install -g netlify-cli`, then `netlify login`'));
        return;
      }
      // The exit status and the command name only: stderr can quote what the CLI read.
      reject(new NetlifyCliError(`\`netlify ${args[0]}\` failed (exit ${error.code ?? '?'}). Check \`netlify status\`, and update the CLI if it is old`));
    });
  });
}

/** `netlify api <method> --data <json>` → the parsed JSON response. */
export async function netlifyApi(method, data, options) {
  const stdout = await runNetlify(['api', method, '--data', JSON.stringify(data)], options);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new NetlifyCliError(`\`netlify api ${method}\` did not return JSON`);
  }
}
