#!/usr/bin/env bash
# All-users business-card audit (approved run plan). Read-only.
#
#   PROJECT_ID=<firebase project id> \
#   REPO=<path to your idynify-scout checkout> bash run-all-users-audit.sh
#
# Identical to run-one-user-audit.sh except for scope: no --user-id, so every
# workspace is audited. Stops before the audit if any pre-check fails. Uses the
# audit service account only if it is new, or already exists with exactly
# roles/datastore.viewer and no user-managed keys. Creates one temporary key
# and, on every exit, deletes only that key. Never deletes a key it did not
# create. Never uses --details, never grants another role.
set -euo pipefail
umask 077

: "${PROJECT_ID:?set PROJECT_ID}"
: "${REPO:?set REPO to your idynify-scout checkout}"

SA_NAME=bc-audit-readonly
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DIR="$HOME/.bc-audit"
KEY="$DIR/key.json"
KEY_ID=""
mkdir -p "$DIR/reports"
stop() { echo "STOP: $*" >&2; exit 1; }
one_line() { printf '%s' "$1" | tr '\n\t' ', '; }

current_roles() {
  gcloud projects get-iam-policy "$PROJECT_ID" --flatten "bindings[].members" \
    --filter "bindings.members:serviceAccount:$SA_EMAIL" --format "value(bindings.role)" | sort -u
}
# One line per user-managed key: "<key id><TAB><valid after>".
user_keys() {
  gcloud iam service-accounts keys list --iam-account "$SA_EMAIL" --project "$PROJECT_ID" \
    --managed-by user --format "value(name.basename(),validAfterTime)"
}

# ── Check 5: the checkout is current main ──────────────────────────────────
cd "$REPO"
git diff --quiet HEAD || stop "the checkout has uncommitted changes to tracked files"
git fetch -q origin main
git checkout -q main
git pull -q --ff-only origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || stop "checkout is not current origin/main"
git merge-base --is-ancestor d0b51d50ac2f7cb8ac758ac03369a771276b81fc HEAD || stop "main does not contain the audit merge d0b51d5"
echo "check 5 ok: main at $(git rev-parse --short HEAD)"

# ── Check 4: Node v20.x ────────────────────────────────────────────────────
NODE_V=$(node --version)
[[ "$NODE_V" == v20.* ]] || stop "Node is $NODE_V; v20.x is required"
npm ci --silent
echo "check 4 ok: node $NODE_V"

# ── The audit service account: new, or existing and exactly as expected ───
if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "$SA_EMAIL already exists: verifying it, without changing it"
  ROLES=$(current_roles)
  [ "$ROLES" = "roles/datastore.viewer" ] \
    || stop "existing $SA_EMAIL has roles [$(one_line "${ROLES:-none}")]; expected exactly roles/datastore.viewer"
  EXISTING_KEYS=$(user_keys)
  if [ -n "$EXISTING_KEYS" ]; then
    echo "Pre-existing user-managed keys on $SA_EMAIL (left untouched):" >&2
    printf '%s\n' "$EXISTING_KEYS" >&2
    stop "the audit account already has user-managed keys; review them before this run"
  fi
  echo "existing account ok: exactly roles/datastore.viewer, 0 user-managed keys"
else
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT_ID" \
    --display-name "Business-card audit (read-only, temporary)"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$SA_EMAIL" --role roles/datastore.viewer --condition=None >/dev/null
  echo "created $SA_EMAIL with roles/datastore.viewer"
fi

# ── Check 1: exactly roles/datastore.viewer ────────────────────────────────
ROLES=$(current_roles)
[ "$ROLES" = "roles/datastore.viewer" ] || stop "service account roles are [$(one_line "${ROLES:-none}")]"
echo "check 1 ok: roles = $ROLES"

# ── Check 2: the role has no create/update/delete permission ───────────────
PERMS=$(gcloud iam roles describe roles/datastore.viewer --format "value(includedPermissions)" | tr ';' '\n')
PERM_COUNT=$(printf '%s\n' "$PERMS" | grep -c . || true)
[ "$PERM_COUNT" -gt 0 ] || stop "could not read the role's permissions"
if printf '%s\n' "$PERMS" | grep -E '\.(create|update|delete)$'; then stop "roles/datastore.viewer lists the write permissions above"; fi
echo "check 2 ok: $PERM_COUNT permissions, none create/update/delete"

# ── Zero user-managed keys immediately before this run creates its own ─────
BEFORE=$(user_keys)
[ -z "$BEFORE" ] || { printf '%s\n' "$BEFORE" >&2; stop "user-managed keys exist before this run (listed above, left untouched)"; }
[ ! -e "$KEY" ] || stop "$KEY already exists locally; review and remove it before running"
echo "key check ok: 0 user-managed keys before this run"

# ── Cleanup: delete only the key this run created; runs on every exit ──────
CLEANUP_DONE=""
cleanup() {
  [ -z "$CLEANUP_DONE" ] || return 0
  CLEANUP_DONE=1
  if [ -n "$KEY_ID" ]; then
    if gcloud iam service-accounts keys delete "$KEY_ID" --iam-account "$SA_EMAIL" --project "$PROJECT_ID" --quiet; then
      echo "deleted the temporary key this run created: $KEY_ID"
    else
      echo "WARNING: could not delete this run's key $KEY_ID; delete it manually" >&2
    fi
  fi
  shred -u "$KEY" 2>/dev/null || rm -f "$KEY" || true
  local remaining
  remaining=$(user_keys) || { echo "WARNING: could not list keys to verify cleanup" >&2; return 1; }
  if [ -z "$remaining" ]; then
    echo "user-managed keys remaining on $SA_EMAIL: 0; local key file present: $([ -e "$KEY" ] && echo yes || echo no)"
  else
    echo "WARNING: user-managed keys remain on $SA_EMAIL (not deleted by this run):" >&2
    printf '%s\n' "$remaining" >&2
    return 1
  fi
}
trap cleanup EXIT

gcloud iam service-accounts keys create "$KEY" --iam-account "$SA_EMAIL" --project "$PROJECT_ID"
[ -f "$KEY" ] || stop "the key file was not created at $KEY"
KEY_ID=$(node -e 'const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(k.private_key_id || ""))' "$KEY") \
  || stop "could not read the new key's id"
[ -n "$KEY_ID" ] || stop "the new key file has no private_key_id"
AFTER=$(user_keys | cut -f1)
[ "$AFTER" = "$KEY_ID" ] || stop "expected only this run's key ($KEY_ID); found [$(one_line "$AFTER")]"
echo "created this run's temporary key: $KEY_ID"

# ── Check 3: the key file is owner-only ────────────────────────────────────
KEY_MODE=$(stat -c '%a' "$KEY" 2>/dev/null || stat -f '%Lp' "$KEY" 2>/dev/null) || stop "cannot read the key file's permissions"
[ "$KEY_MODE" = "600" ] || stop "key file mode is $KEY_MODE, expected 600"
echo "check 3 ok: key file mode $KEY_MODE"

echo "all pre-checks passed; waiting 120s for the new grant and key to take effect"
sleep 120

# ── The audit: all workspaces, --json, no --details ────────────────────────
OUT="$DIR/reports/audit-all-$(date -u +%Y%m%dT%H%M%SZ).json"
ERR="$OUT.stderr"
START_MS=$(node -e 'process.stdout.write(String(Date.now()))')
set +e
FIREBASE_SERVICE_ACCOUNT_PATH="$KEY" node scripts/auditBusinessCardRecords.mjs --json > "$OUT" 2> "$ERR"
CODE=$?
set -e
END_MS=$(node -e 'process.stdout.write(String(Date.now()))')

# Delete this run's key immediately, before anything else.
trap - EXIT
cleanup || stop "the audit account is not back to zero user-managed keys; see above"

echo "exit code: $CODE"
echo "runtime ms: $((END_MS - START_MS))"
echo "json: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes, mode $(stat -c '%a' "$OUT" 2>/dev/null || stat -f '%Lp' "$OUT"))"
if [ -s "$ERR" ]; then
  echo "STDERR (preserved at $ERR):"
  cat "$ERR"
  grep -q 'PERMISSION_DENIED' "$ERR" && echo "STOP: PERMISSION_DENIED. Fix the viewer-role grant; do not broaden permissions."
  grep -qiE 'FAILED_PRECONDITION|index' "$ERR" && echo "STOP: index request. Do not create an index."
  stop "unexpected stderr output; preserved $OUT and $ERR for review"
fi
echo "stderr: (empty)"
[ "$CODE" = 0 ] || [ "$CODE" = 2 ] || stop "the audit did not complete (exit $CODE)"

# ── Report (summary rendered from the saved JSON; no further reads) ────────
node --input-type=module -e "
import { formatText } from './scripts/auditBusinessCardRecords.mjs';
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[1], 'utf8'));
process.stdout.write(formatText(r));
console.log('──────── review items ────────');
console.log('scope:', r.scope, '| workspaces scanned:', r.totals.workspacesScanned, '| with scanner records:', r.totals.workspacesWithRecords);
console.log('cleanup:', r.cleanup.level, JSON.stringify(r.cleanup.matched));
console.log('reads.documents:', r.reads.documents);
console.log('reads.queries:', r.reads.queries);
console.log('reads.emptyQueries:', r.reads.emptyQueries);
console.log('approx billed reads (documents + emptyQueries):', r.reads.documents + r.reads.emptyQueries);
console.log('contact flags:', JSON.stringify(r.contactFlags));
console.log('company flags:', JSON.stringify(r.companyFlags));
console.log('usage:', JSON.stringify({ total: r.usage.total, success: r.usage.success, error: r.usage.error, workspaces: r.usage.workspaces, byMonth: r.usage.byMonth, errorCodes: r.usage.errorCodes }));
if (r.scope !== 'all') console.log('WARNING: the report scope is not all workspaces.');
if (!r.totals.contacts && !r.totals.companies) console.log('WARNING: no scanner records in any workspace, although the one-user run found some.');
" "$OUT"
