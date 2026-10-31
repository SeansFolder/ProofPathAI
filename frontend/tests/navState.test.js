import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeHistoryState,
  isProtectedScreen,
  privacyBackLabel,
  shouldAttemptVerify,
  readHistoryNav,
  saveNavRestore,
  readNavRestore,
  clearNavRestore,
  saveVerifyResult,
  readVerifyResult,
  clearVerifyResult,
} from '../src/navState.js';

function stubStorage() {
  const data = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (data.has(key) ? data.get(key) : null),
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: (key) => data.delete(key),
    },
  };
  return data;
}

test('sanitizeHistoryState keeps only allowlisted navigation fields', () => {
  const clean = sanitizeHistoryState({
    screen: 'detail',
    detailId: 'abc-123',
    privacyReturn: 'myreports',
    deliveryOrigin: 'detail',
    token: 'raw-secret',
    password: 'hunter2',
    file: { name: 'evidence.png' },
  });
  assert.deepEqual(clean, {
    screen: 'detail',
    detailId: 'abc-123',
    privacyReturn: 'myreports',
    deliveryOrigin: 'detail',
  });
});

test('sanitizeHistoryState rejects unknown screens and bad ids', () => {
  assert.equal(sanitizeHistoryState({ screen: 'upload' }), null);
  assert.equal(sanitizeHistoryState(null), null);
  assert.equal(sanitizeHistoryState({ screen: 'detail', detailId: '' }).detailId, undefined);
  assert.equal(sanitizeHistoryState({ screen: 'privacy', privacyReturn: 'privacy' }).privacyReturn, undefined);
});

test('isProtectedScreen gates report and account screens only', () => {
  assert.equal(isProtectedScreen('detail'), true);
  assert.equal(isProtectedScreen('delivery'), true);
  assert.equal(isProtectedScreen('preview'), true);
  assert.equal(isProtectedScreen('wizard'), true);
  assert.equal(isProtectedScreen('verify'), false);
  assert.equal(isProtectedScreen('privacy'), false);
  assert.equal(isProtectedScreen('signin'), false);
});

test('privacyBackLabel matches the actual return destination', () => {
  assert.equal(privacyBackLabel('signin'), 'Back to sign in');
  assert.equal(privacyBackLabel('signup'), 'Back to create account');
  assert.equal(privacyBackLabel('verify'), 'Back to verification');
  assert.equal(privacyBackLabel('homepage'), 'Back to home');
  assert.equal(privacyBackLabel(''), 'Back to home');
  assert.equal(privacyBackLabel('dashboard'), 'Back to home');
});

test('shouldAttemptVerify consumes each token once', () => {
  assert.equal(shouldAttemptVerify('tok-1', ''), true);
  assert.equal(shouldAttemptVerify('tok-1', 'tok-1'), false);
  assert.equal(shouldAttemptVerify('tok-2', 'tok-1'), true);
  assert.equal(shouldAttemptVerify('', ''), false);
  assert.equal(shouldAttemptVerify('   ', ''), false);
});

test('nav restore round-trips sanitized state through storage', () => {
  stubStorage();
  clearNavRestore();
  saveNavRestore({ screen: 'delivery', detailId: 'r-1', token: 'secret' });
  assert.deepEqual(readNavRestore(), { screen: 'delivery', detailId: 'r-1' });
  clearNavRestore();
  assert.equal(readNavRestore(), null);
  delete globalThis.window;
});

test('readHistoryNav returns null without a window and sanitizes with one', () => {
  assert.equal(readHistoryNav(), null);
  stubStorage();
  globalThis.window.history = { state: { screen: 'detail', detailId: 'r-9', token: 'secret' } };
  assert.deepEqual(readHistoryNav(), { screen: 'detail', detailId: 'r-9' });
  globalThis.window.history = { state: { screen: 'nope' } };
  assert.equal(readHistoryNav(), null);
  delete globalThis.window;
});

test('verify result persists the outcome but never the token', () => {
  stubStorage();
  clearVerifyResult();
  saveVerifyResult({ status: 'verified', token: 'raw-token', error: '' });
  assert.deepEqual(readVerifyResult(), { status: 'verified' });
  saveVerifyResult({ status: 'invalid', error: 'That link is not valid.' });
  assert.deepEqual(readVerifyResult(), { status: 'invalid', error: 'That link is not valid.' });
  delete globalThis.window;
});
