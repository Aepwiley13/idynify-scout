/**
 * STAGING ONLY: make sure the ports the billing launcher uses are its own before it starts.
 *
 * netlify dev proxies :8888 to whatever answers on the framework port when it starts, on whichever
 * address family answered first (IPv6 ::1 on macOS), and never looks again. If another server is
 * already there (a leftover Vite from an earlier run, or another checkout's `npm run dev`), the
 * launcher's own Vite moves to the next port, the readiness check passes against the other server,
 * and once that server stops every page answers 500 "Could not proxy request.".
 *
 * So before starting: each port must be free on 127.0.0.1 and ::1. A listener that is this
 * checkout's own leftover (a vite, netlify or stagingDev process whose working directory is this
 * checkout) is stopped; anything else is named and the launcher refuses. Nothing outside this
 * checkout is ever stopped.
 */
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readlinkSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import process from 'node:process';

/** Vite's port in billing runs: not 5173, which every other `npm run dev` on the machine uses. */
export const BILLING_VITE_PORT = 5199;

const OWN_PROCESS = /(^|[\s/])(vite|netlify|stagingDev\.mjs)(\s|$)/;

/** True when something accepts a connection on port at host. ::1 missing counts as free. */
export function answersOn(port, host, { timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function portInUse(port, { answers = answersOn } = {}) {
  return (await answers(port, '127.0.0.1')) || (await answers(port, '::1'));
}

const run = (exec, file, args) => {
  try {
    return { out: exec(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch (err) {
    return { missing: err.code === 'ENOENT', out: err.stdout ?? '' };
  }
};

/**
 * The processes listening on port: [{ pid, command, cwd }], or null when lsof is not available
 * (they can then not be named, so the launcher only refuses).
 */
export function portHolders(port, { exec = execFileSync, readlink = readlinkSync } = {}) {
  const listed = run(exec, 'lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
  if (listed.missing) return null;
  const pids = [...new Set(listed.out.split('\n').filter((l) => /^p\d+$/.test(l)).map((l) => Number(l.slice(1))))];
  return pids.map((pid) => {
    const command = run(exec, 'ps', ['-o', 'command=', '-p', String(pid)]).out.trim();
    let cwd = run(exec, 'lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).out.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
    if (!cwd) {
      try { cwd = readlink(`/proc/${pid}/cwd`); } catch { cwd = null; }
    }
    return { pid, command, cwd };
  });
}

const real = (path) => {
  try { return realpathSync(path); } catch { return path; }
};

/** Pure: which holders are this checkout's own leftovers (to stop) and which are not (refuse). */
export function sortHolders(holders, root) {
  const base = real(root);
  const own = (h) => Boolean(h.cwd) && OWN_PROCESS.test(h.command) && (real(h.cwd) === base || real(h.cwd).startsWith(base + sep));
  return { stop: holders.filter(own), foreign: holders.filter((h) => !own(h)) };
}

const short = (command) => (command.length > 90 ? `${command.slice(0, 87)}...` : command);

/**
 * Frees the ports or explains why not. Returns { ok, stopped: [lines], problems: [lines] }.
 * Two passes, because stopping a leftover netlify can leave its Vite behind on the next port.
 */
export async function claimPorts(ports, root, {
  inUse = portInUse, holders = portHolders, kill = (pid, signal) => process.kill(pid, signal),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const stopped = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const busy = [];
    for (const port of ports) if (await inUse(port)) busy.push(port);
    if (!busy.length) return { ok: true, stopped, problems: [] };
    const problems = [];
    for (const port of busy) {
      const found = holders(port);
      if (found === null) { problems.push(`port ${port} is in use by another program (install lsof to have it named).`); continue; }
      const { stop, foreign } = sortHolders(found, root);
      for (const h of foreign) problems.push(`port ${port} is in use by ${short(h.command || 'a process')} (pid ${h.pid}${h.cwd ? `, in ${h.cwd}` : ''}), which this launcher did not start and will not stop.`);
      if (!found.length) problems.push(`port ${port} is in use by a process lsof cannot see (another user's?).`);
      for (const h of stop) {
        try { kill(h.pid, 'SIGTERM'); } catch { /* already gone */ }
        stopped.push(`stopped a leftover ${short(h.command)} (pid ${h.pid}) from an earlier run of this checkout, which held port ${port}.`);
      }
    }
    if (problems.length) return { ok: false, stopped, problems };
    for (let waited = 0; waited < 5000; waited += 250) {
      let still = false;
      for (const port of busy) if (await inUse(port)) still = true;
      if (!still) break;
      await sleep(250);
    }
  }
  const left = [];
  for (const port of ports) if (await inUse(port)) left.push(port);
  return left.length
    ? { ok: false, stopped, problems: left.map((p) => `port ${p} is still in use after stopping this checkout's leftovers.`) }
    : { ok: true, stopped, problems: [] };
}
