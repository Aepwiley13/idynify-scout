#!/usr/bin/env node
/**
 * Manual credit recovery — the only thing allowed to grant credits for a purchase this PR's
 * automated webhook path refused to (a pre-epoch/epoch-unset purchase, a rollback-window
 * purchase, or anything else flagged into billingAmbiguousAccounts). This is deliberately a
 * SEPARATE tool from the webhook, never invoked automatically, and requires a human to supply
 * purchase-specific evidence on every run — it will not run without it.
 *
 * TRANSACTIONAL + IDEMPOTENT, not just "checked before running":
 *   - The existence check for billingAllocations/{subscriptionId} and every write happen inside
 *     ONE Firestore transaction. Running this script twice for the same subscriptionId — by
 *     mistake, or because two people ran it concurrently — commits the grant at most once; the
 *     second run's transaction sees the marker the first run just wrote and refuses, atomically.
 *     This is not "check the report, then act" — a report is just visibility, never a guard
 *     (do not treat scripts/reconcileBillingSubscriptions.mjs's output as if running it, or
 *     reading it, prevented anything). The guard is this transaction's own read-then-write.
 *   - If an ambiguousAccountDocId is given, that record is read inside the SAME transaction and
 *     marked 'resolved' in the SAME commit as the grant — so the credit write and the
 *     review-queue update can never land independently of each other.
 *
 * Reuses creditGrantFields() from netlify/functions/utils/creditGrantFields.js — the exact same
 * function the automated webhook path uses — so a manual grant is byte-for-byte what an
 * automated one would have produced, never a hand-rolled approximation.
 *
 * This writes to Firestore. It needs a WRITE-capable service account key, not the read-only one
 * used for verification/reconciliation elsewhere in this project — do not point
 * FIREBASE_SERVICE_ACCOUNT_PATH at the read-only key; every write will fail with
 * PERMISSION_DENIED, which is a safe failure, not a usage error to work around.
 *
 * USAGE
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/write-capable-key.json \
 *     node scripts/manualCreditRecovery.mjs \
 *       --uid <firebase-uid> \
 *       --subscription-id <sub_...> \
 *       --price-id <price_...> \
 *       --evidence-stripe-session-id <cs_...|sub_...> \
 *       --evidence-note "<why this is believed to be a genuine, never-granted purchase>" \
 *       [--ambiguous-account-doc-id <doc id from billingAmbiguousAccounts>] \
 *       [--operator "<name doing the recovery>"] \
 *       [--dry-run]
 *
 * Exit codes: 0 applied (or dry-run would apply); 2 already granted (idempotent no-op, not an
 * error); 1 did not run at all (missing evidence, bad arguments, or a Firestore/auth error).
 */

import process from 'node:process';
import { readFileSync } from 'node:fs';
import { creditGrantFields } from '../netlify/functions/utils/creditGrantFields.js';

export class UsageError extends Error {}
export class AlreadyGrantedError extends Error {}

export const USAGE = `Usage: FIREBASE_SERVICE_ACCOUNT_PATH=<write-capable key> node scripts/manualCreditRecovery.mjs \\
  --uid <firebase-uid> --subscription-id <sub_...> --price-id <price_...> \\
  --evidence-stripe-session-id <cs_...|sub_...> --evidence-note "<why this is genuine>" \\
  [--ambiguous-account-doc-id <id>] [--operator "<name>"] [--dry-run]
`;

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = argv[i + 1];
    i++;
  }
  const required = ['uid', 'subscriptionId', 'priceId', 'evidenceStripeSessionId', 'evidenceNote'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    throw new UsageError(`Missing required evidence/identification arguments: ${missing.join(', ')}\n\n${USAGE}`);
  }
  return args;
}

/**
 * The transactional core. `db` is injected (never imported at module scope) so this is testable
 * against the Firestore emulator without needing real credentials, and so the CLI entrypoint
 * below is the only place that ever touches a real service-account connection.
 */
export async function applyManualRecovery(db, args) {
  const { uid, subscriptionId, priceId, evidenceStripeSessionId, evidenceNote, ambiguousAccountDocId, operator, dryRun } = args;

  return db.runTransaction(async (tx) => {
    // ── READ PHASE ──────────────────────────────────────────────────────────────────────────
    const allocRef = db.collection('billingAllocations').doc(subscriptionId);
    const allocSnap = await tx.get(allocRef);
    if (allocSnap.exists) {
      throw new AlreadyGrantedError(
        `billingAllocations/${subscriptionId} already exists (granted at ${allocSnap.data()?.grantedAt}) — refusing to grant again. This is the idempotency guard, not an error to bypass.`
      );
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new UsageError(`users/${uid} does not exist`);

    let ambiguousRef = null;
    let ambiguousSnap = null;
    if (ambiguousAccountDocId) {
      ambiguousRef = db.collection('billingAmbiguousAccounts').doc(ambiguousAccountDocId);
      ambiguousSnap = await tx.get(ambiguousRef);
      if (!ambiguousSnap.exists) throw new UsageError(`billingAmbiguousAccounts/${ambiguousAccountDocId} does not exist`);
    }

    // ── DECIDE PHASE (pure) ─────────────────────────────────────────────────────────────────
    const { fields } = creditGrantFields(priceId);
    const grantedAt = new Date().toISOString();
    const allocationData = {
      uid, priceId, grantedAt,
      recoveredManually: true,
      evidence: { stripeSessionId: evidenceStripeSessionId, note: evidenceNote, operator: operator ?? null },
    };

    if (dryRun) {
      return { applied: false, dryRun: true, wouldWrite: { user: fields, allocation: allocationData } };
    }

    // ── WRITE PHASE ─────────────────────────────────────────────────────────────────────────
    tx.update(userRef, fields);
    tx.set(allocRef, allocationData);
    if (ambiguousRef) {
      tx.update(ambiguousRef, {
        status: 'resolved', resolvedAt: grantedAt, resolvedBy: operator ?? null, resolutionNote: evidenceNote,
      });
    }

    return { applied: true, dryRun: false, grantedAt };
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) { console.error(err.message); process.exit(1); }
    throw err;
  }

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH is required: a WRITE-capable service-account key.');
    process.exit(1);
  }
  let key;
  try {
    key = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH could not be read as a service-account key.');
    process.exit(1);
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(key) });
  const db = getFirestore();

  try {
    const result = await applyManualRecovery(db, args);
    if (result.dryRun) {
      console.log('DRY RUN — nothing written. Would write:');
      console.log(JSON.stringify(result.wouldWrite, null, 2));
      process.exit(0);
    }
    console.log(`Applied. billingAllocations/${args.subscriptionId} created at ${result.grantedAt}.`);
    process.exit(0);
  } catch (err) {
    if (err instanceof AlreadyGrantedError) {
      console.log(err.message);
      process.exit(2); // idempotent no-op, not a failure
    }
    if (err instanceof UsageError) { console.error(err.message); process.exit(1); }
    console.error('Recovery transaction failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
