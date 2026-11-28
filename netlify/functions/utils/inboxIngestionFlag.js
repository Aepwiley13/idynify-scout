/**
 * The switch for automated Gmail inbox ingestion. OFF unless set.
 *
 * Inbox ingestion is the scheduled reading of connected mailboxes
 * (gmail-sync-worker) and the Barry analysis of what it stored
 * (process-barry-inbox-queue). Both stay off until the feature is released
 * on purpose. Only the exact string 'true' turns them on: unset, empty,
 * misspelled or any other value is off, so a typo fails safe.
 *
 * This is separate from GMAIL_IDENTITY_MODE, which only gates the canonical
 * relationship writer and does NOT stop the worker from fetching and storing
 * messages (ADR-006, "What dry_run actually guarantees"). It is also separate
 * from GMAIL_REPLY_SYNC_ENABLED, which gates reply detection on threads
 * IDYNIFY sent (metadata only) and is not inbox ingestion.
 *
 * Sending, connecting, disconnecting, the Sync Replies button and the reply
 * sync worker do not read this switch.
 */
export const INBOX_INGESTION_ENV = 'GMAIL_INBOX_INGESTION_ENABLED';

export function isInboxIngestionEnabled(env = process.env) {
  return env?.[INBOX_INGESTION_ENV] === 'true';
}
