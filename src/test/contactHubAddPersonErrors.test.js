/**
 * Contact Hub's Add Person failure messages: which sentence for which error.
 */
import { describe, it, expect } from 'vitest';
import {
  ADD_PERSON_ERROR as K,
  classifyAddPersonError,
  addPersonErrorMessage,
  describeAddPersonError,
} from '../pages/ContactHub/addPersonErrors';

const coded = (code, message = 'x') => Object.assign(new Error(message), { code });

describe('classifyAddPersonError', () => {
  it.each([
    ['the b815 assertion seen on staging', new Error('FIRESTORE (12.6.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)')],
    ['the first internal failure', new Error('INTERNAL UNHANDLED ERROR: something')],
    ['a terminated client', coded('failed-precondition', 'The client has already been terminated.')],
    ['lost browser storage', new Error('IndexedDB transaction failed')],
  ])('%s is an unhealthy client', (_label, error) => {
    expect(classifyAddPersonError(error)).toBe(K.CLIENT_UNHEALTHY);
  });

  it.each([
    ['permission-denied', K.NOT_ALLOWED],
    ['firestore/permission-denied', K.NOT_ALLOWED],
    ['unauthenticated', K.SIGNED_OUT],
    ['unavailable', K.OFFLINE],
    ['deadline-exceeded', K.OFFLINE],
    ['invalid-argument', K.UNKNOWN],
    ['failed-precondition', K.UNKNOWN],
  ])('code %s is %s', (code, kind) => {
    expect(classifyAddPersonError(coded(code))).toBe(kind);
  });

  it('an ambiguous match is recognised by name', () => {
    const error = Object.assign(new Error('Two or more existing contacts share the same email.'), { name: 'IdentityConflictError' });
    expect(classifyAddPersonError(error)).toBe(K.AMBIGUOUS_MATCH);
  });

  it('an unrecognised failure while the browser is offline is a connection problem', () => {
    expect(classifyAddPersonError(new Error('boom'), { online: false })).toBe(K.OFFLINE);
    expect(classifyAddPersonError(new Error('boom'), { online: true })).toBe(K.UNKNOWN);
  });

  it('survives anything thrown', () => {
    for (const thrown of [undefined, null, 'text', 42, {}, { code: 7 }]) {
      expect(classifyAddPersonError(thrown)).toBe(K.UNKNOWN);
    }
  });
});

describe('the sentences', () => {
  it('only the unhealthy client is told to reload', () => {
    for (const kind of Object.values(K)) {
      const says = /reload/i.test(addPersonErrorMessage(kind));
      expect(says).toBe(kind === K.CLIENT_UNHEALTHY);
    }
  });

  it('never repeats the error itself', () => {
    const error = coded('permission-denied', 'denied at users/abc123/contacts for ana@x.test');
    const sentence = describeAddPersonError(error);
    expect(sentence).not.toMatch(/abc123|ana@x\.test|users\//);
  });

  it('an unknown kind falls back to the general sentence', () => {
    expect(addPersonErrorMessage('nope')).toBe(addPersonErrorMessage(K.UNKNOWN));
  });
});
