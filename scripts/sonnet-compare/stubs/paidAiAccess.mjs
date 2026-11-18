/*
 * Stand-in for netlify/functions/utils/paidAiAccess.js. The capture step records the prompt each
 * handler builds; who may reach Claude is a separate question, tested in src/test/paidAiAccess.test.js.
 */
export const withPaidAiAccess = (handler) => handler;
