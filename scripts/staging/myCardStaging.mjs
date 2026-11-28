#!/usr/bin/env node
/**
 * STAGING ONLY: a demonstration My Card account and a live card on the staging project, so the
 * sharing experience can be tried on a phone (docs/releases/MY-CARD-SHARE-001.md).
 *
 * Uses the app's own service (src/services/myCard/myCardCore.js) as a real signed-in demo user, so
 * the staging Firestore rules are what accept or refuse every write. Refuses any project that is
 * not the one the env file names, that is production, or that is not in STICKERS_STAGING_PROJECTS.
 * The demo login is kept in a file readable only by you (default ~/idynify-staging/mycard-demo.env);
 * nothing prints a password. Fictional data only.
 *
 *   node scripts/staging/myCardStaging.mjs --env=$HOME/idynify-staging/.env.staging --base=http://localhost:8890
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import { parseEnvFile } from './stagingPreflight.mjs';
import { createMyCardService, MY_CARD_STATUS as S } from '../../src/services/myCard/myCardCore.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const envFile = arg('env');
const base = (arg('base') || '').replace(/\/$/, '');
const loginFile = arg('login') || join(homedir(), 'idynify-staging', 'mycard-demo.env');
if (!envFile || !base) { console.error('Usage: --env=<staging env file> --base=<app address>'); process.exit(1); }

const env = parseEnvFile(readFileSync(envFile, 'utf8'));
const project = env.VITE_FIREBASE_PROJECT_ID;
const allowed = (process.env.STICKERS_STAGING_PROJECTS || '').split(',').map((p) => p.trim()).filter(Boolean);
if (!project || project === process.env.PRODUCTION_FIREBASE_PROJECT_ID || !/staging/.test(project) || !allowed.includes(project)) {
  console.error(`Refused: ${project} is not an allowed staging project.`); process.exit(1);
}

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: project,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

let login = existsSync(loginFile) ? parseEnvFile(readFileSync(loginFile, 'utf8')) : null;
if (login?.MYCARD_DEMO_PROJECT && login.MYCARD_DEMO_PROJECT !== project) login = null;
if (login) {
  await signInWithEmailAndPassword(auth, login.MYCARD_DEMO_EMAIL, login.MYCARD_DEMO_PASSWORD);
} else {
  const email = `mycard.demo.${randomBytes(3).toString('hex')}@example.test`;
  const password = randomBytes(12).toString('base64url');
  await createUserWithEmailAndPassword(auth, email, password);
  writeFileSync(loginFile, `MYCARD_DEMO_PROJECT=${project}\nMYCARD_DEMO_EMAIL=${email}\nMYCARD_DEMO_PASSWORD=${password}\n`, { mode: 0o600 });
  chmodSync(loginFile, 0o600);
}
const uid = auth.currentUser.uid;
const service = createMyCardService({ db, fs: { doc, getDoc, runTransaction }, getSignedInUid: () => auth.currentUser?.uid ?? null });
let loaded = await service.loadMyCard();
if (!loaded.card?.revision || loaded.status === 'empty' || loaded.status === S.EMPTY) {
  const saved = await service.saveMyCard({
    firstName: 'Demo', lastName: 'Cardholder', title: 'Founder', organization: 'Demo Co',
    email: 'demo@example.test', phone: '+1 555 010 0100', website: 'https://example.test/',
    share: { title: true, organization: true, email: true, phone: true, website: true },
  }, { expectedRevision: null });
  console.log('save:', saved.status);
  loaded = await service.loadMyCard();
}
let sharing = loaded.sharing;
if (!sharing?.live) {
  const published = await service.publishMyCard({ expectedRevision: loaded.card?.revision ?? loaded.revision });
  console.log('publish:', published.status, JSON.stringify(published).slice(0,300));
  sharing = published.sharing;
}
if (!sharing?.live) { console.error('The card is not live:', JSON.stringify(sharing)); process.exit(2); }
const url = `${base}/c/${sharing.publicId}`;
console.log(`Public link: ${url}`);
for (const [label, u, want] of [['page', url, /Demo Cardholder/], ['vcard', `${url}/contact.vcf`, /BEGIN:VCARD/]]) {
  const res = await fetch(u); const text = await res.text();
  console.log(`${label}: HTTP ${res.status} ${want.test(text) ? 'ok' : 'UNEXPECTED CONTENT'}`);
}
console.log(`Demo login is in ${loginFile} (open it yourself; it is not printed).`);
process.exit(0);
