/**
 * STAGING ONLY: the staging project's service-account credential, read from
 * the environment, without printing it, logging it or writing it into the
 * env file (docs/contact-hub/STICKERS_STAGING_SETUP.md, "Credential").
 *
 * Exactly one source may be set:
 *   STAGING_SERVICE_ACCOUNT_KEY      the JSON key itself, raw (one line) or
 *                                    base64 of the file. For a cloud session,
 *                                    whose only in-process secret store is an
 *                                    environment variable.
 *   GOOGLE_APPLICATION_CREDENTIALS   a path to the JSON key file, on a local
 *                                    machine.
 * Both set is refused: a machine-wide GOOGLE_APPLICATION_CREDENTIALS may name
 * another project's key, and guessing which one was meant is how a staging
 * tool ends up holding a production credential.
 *
 * Nothing here prints a value. Error messages name a variable or a field,
 * never content; a JSON parse error is not passed on, because the engine's
 * message can quote part of the input.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

export const KEY_VARIABLE = 'STAGING_SERVICE_ACCOUNT_KEY';
export const FILE_VARIABLE = 'GOOGLE_APPLICATION_CREDENTIALS';

export class CredentialRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialRefusal';
  }
}

const PEM = /-----BEGIN (RSA )?PRIVATE KEY-----/;

/**
 * { projectId, clientEmail, privateKey, json } from a key's text: raw JSON,
 * or base64 of it. Throws CredentialRefusal, naming only what is wrong.
 */
export function parseServiceAccountKey(text, label = KEY_VARIABLE) {
  let raw = String(text ?? '').trim();
  if (!raw) throw new CredentialRefusal(`${label} is empty.`);
  if (!raw.startsWith('{')) {
    raw = Buffer.from(raw, 'base64').toString('utf8').trim();
    if (!raw.startsWith('{')) throw new CredentialRefusal(`${label} is neither a JSON key nor base64 of one.`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CredentialRefusal(`${label} is not valid JSON.`);
  }
  if (!json || typeof json !== 'object' || json.type !== 'service_account') {
    throw new CredentialRefusal(`${label} is not a service-account key ("type" must be "service_account").`);
  }
  const missing = ['project_id', 'client_email', 'private_key'].filter((k) => typeof json[k] !== 'string' || json[k].trim() === '');
  if (missing.length) throw new CredentialRefusal(`${label} is missing: ${missing.join(', ')}.`);
  if (!PEM.test(json.private_key)) throw new CredentialRefusal(`${label}: private_key does not look like a private key.`);
  if (!json.client_email.endsWith(`@${json.project_id}.iam.gserviceaccount.com`)) {
    throw new CredentialRefusal(`${label}: client_email is not a service account of the key's own project.`);
  }
  return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key, json };
}

/**
 * The credential from the environment: { source, ...parsed }, or null when
 * neither variable is set. Throws CredentialRefusal when both are set or the
 * one that is set is not a usable key.
 */
export function readStagingCredential(env = {}, { readFile = readFileSync } = {}) {
  const inline = typeof env[KEY_VARIABLE] === 'string' && env[KEY_VARIABLE].trim() !== '';
  const file = typeof env[FILE_VARIABLE] === 'string' && env[FILE_VARIABLE].trim() !== '';
  if (inline && file) throw new CredentialRefusal(`Set ${KEY_VARIABLE} or ${FILE_VARIABLE}, not both.`);
  if (inline) return { source: KEY_VARIABLE, ...parseServiceAccountKey(env[KEY_VARIABLE], KEY_VARIABLE) };
  if (file) {
    let text;
    try {
      text = readFile(env[FILE_VARIABLE], 'utf8');
    } catch (err) {
      throw new CredentialRefusal(`${FILE_VARIABLE} could not be read (${err?.code ?? 'error'}).`);
    }
    return { source: FILE_VARIABLE, ...parseServiceAccountKey(text, FILE_VARIABLE) };
  }
  return null;
}

/**
 * The env file plus the credential's function variables, for the checks and
 * for `netlify dev`. The key stays in memory: nothing is written back.
 */
export function withCredential(env, credential) {
  if (!credential) return { ...env };
  return {
    ...env,
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID || credential.projectId,
    FIREBASE_CLIENT_EMAIL: credential.clientEmail,
    FIREBASE_PRIVATE_KEY: credential.privateKey,
  };
}

/**
 * Extra checks when a credential comes from the environment, as
 * [{ id, ok, message }]. Pure; messages carry no values except the project id.
 */
export function checkCredential(fileEnv, credential) {
  if (!credential) return [];
  const project = fileEnv.VITE_FIREBASE_PROJECT_ID ?? '';
  const results = [];
  const sameProject = credential.projectId === project;
  results.push({
    id: 'credential-project',
    ok: sameProject,
    message: sameProject
      ? `The service-account key (${credential.source}) belongs to ${project}.`
      : `The service-account key (${credential.source}) belongs to a different project than the env file.`,
  });
  const fileAccount = typeof fileEnv.FIREBASE_CLIENT_EMAIL === 'string' ? fileEnv.FIREBASE_CLIENT_EMAIL.trim() : '';
  if (fileAccount) {
    const sameAccount = fileAccount === credential.clientEmail;
    results.push({
      id: 'credential-account',
      ok: sameAccount,
      message: sameAccount
        ? 'The env file and the key name the same service account.'
        : 'The env file\'s FIREBASE_CLIENT_EMAIL is not the key\'s service account. Remove it from the file, or use the matching key.',
    });
  }
  const keyInFile = typeof fileEnv.FIREBASE_PRIVATE_KEY === 'string' && fileEnv.FIREBASE_PRIVATE_KEY.trim() !== '';
  results.push({
    id: 'key-not-in-file',
    ok: !keyInFile,
    message: keyInFile
      ? `The env file also holds FIREBASE_PRIVATE_KEY. With ${credential.source}, remove it from the file: one credential, kept out of files.`
      : 'The env file holds no private key.',
  });
  return results;
}

/**
 * For a tool that needs a key FILE (firebase-tools): the key in a private
 * temporary folder (0700, file 0600) outside any repository. Call remove()
 * as soon as the tool exits.
 */
export function temporaryKeyFile(credential, { dir = tmpdir() } = {}) {
  const folder = mkdtempSync(join(dir, 'staging-credential-'));
  chmodSync(folder, 0o700);
  const path = join(folder, 'key.json');
  writeFileSync(path, JSON.stringify(credential.json), { mode: 0o600 });
  return { path, remove: () => rmSync(folder, { recursive: true, force: true }) };
}

/** Text with any private-key block (raw or with \n escapes) replaced, for error output. */
export function redactKeys(text) {
  return String(text ?? '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----(\\n|\n)?/g, '[private key redacted]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, '[private key redacted]');
}
