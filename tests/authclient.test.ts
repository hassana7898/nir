import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPassword, isLoginFailure, loginErrorMessage } from '../services/authService';

// NOTE: `window` is deliberately NOT defined while this module is imported, so that
// services/dbStore does not install its background interval under node:test.
// It is installed only around the calls under test (verifyPassword uses window.setTimeout).
const installWindow = () => {
  (globalThis as any).window = {
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    addEventListener: () => {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as unknown as Response;

test('login: a 200 response is ALWAYS a success, even when post-login side effects fail', async () => {
  installWindow();
  // No IndexedDB in node -> rememberSuccessfulLogin() throws. That must NOT turn a
  // successful server login into a failure (this was the "wrong password" bug).
  (globalThis as any).fetch = async () => jsonResponse(200, { success: true, token: 'tok', user: { username: 'admin', role: 'ADMIN' } });

  const result = await verifyPassword('correct-password');
  assert.equal(result.ok, true, 'a successful server login must never be downgraded to a failure');
  assert.equal(isLoginFailure(result), false);
});

test('login: 401 maps to INVALID_CREDENTIALS only', async () => {
  installWindow();
  (globalThis as any).fetch = async () => jsonResponse(401, { error: 'bad credentials' });

  const result = await verifyPassword('wrong');
  assert.equal(result.ok, false);
  assert.ok(isLoginFailure(result));
  if (isLoginFailure(result)) {
    assert.equal(result.code, 'INVALID_CREDENTIALS');
    assert.equal(result.status, 401);
  }
});

test('login: 429 maps to RATE_LIMITED (never "wrong password")', async () => {
  installWindow();
  (globalThis as any).fetch = async () => jsonResponse(429, { error: 'too many requests' });

  const result = await verifyPassword('correct-password');
  assert.ok(isLoginFailure(result));
  if (isLoginFailure(result)) {
    assert.equal(result.code, 'RATE_LIMITED');
    assert.notEqual(result.code, 'INVALID_CREDENTIALS');
  }
});

test('login: 5xx maps to SERVER_ERROR', async () => {
  installWindow();
  (globalThis as any).fetch = async () => jsonResponse(503, { error: 'unavailable' });

  const result = await verifyPassword('correct-password');
  assert.ok(isLoginFailure(result));
  if (isLoginFailure(result)) assert.equal(result.code, 'SERVER_ERROR');
});

test('login: network failure maps to NETWORK', async () => {
  installWindow();
  (globalThis as any).fetch = async () => { throw new TypeError('failed to fetch'); };

  const result = await verifyPassword('correct-password');
  assert.ok(isLoginFailure(result));
  if (isLoginFailure(result)) assert.equal(result.code, 'NETWORK');
});

test('login: an aborted (timed out) request maps to TIMEOUT, not to a wrong password', async () => {
  installWindow();
  (globalThis as any).fetch = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };

  const result = await verifyPassword('correct-password');
  assert.ok(isLoginFailure(result));
  if (isLoginFailure(result)) assert.equal(result.code, 'TIMEOUT');
});

test('login: every failure code produces a distinct, non-"wrong password" message', () => {
  const codes = ['INVALID_CREDENTIALS', 'RATE_LIMITED', 'SERVER_ERROR', 'NETWORK', 'TIMEOUT', 'UNKNOWN'] as const;
  const messages = codes.map((code) => loginErrorMessage({ ok: false, code, message: '' }));
  assert.equal(new Set(messages).size, codes.length, 'each failure code must have its own message');
  assert.ok(!messages[1].includes('اشتباه است'), 'rate limit message must not say the password is wrong');
});
