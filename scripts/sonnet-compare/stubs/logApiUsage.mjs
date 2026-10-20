/* Usage rows are a production write; capture keeps them in memory only, so tests can read what a handler logged. */
import { captureState } from './state.mjs';

export async function logApiUsage(userId, operation, status, options = {}) {
  captureState().usage.push(structuredClone({ operation, status, errorCode: options.errorCode ?? null, metadata: options.metadata ?? null }));
}
export default logApiUsage;
