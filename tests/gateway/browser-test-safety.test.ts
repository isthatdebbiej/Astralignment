import test from 'node:test';
import assert from 'node:assert/strict';
import { requireLocalTestOrigin, requireOverlayMutationOptIn } from '../browser/test-origin-safety';

test('reload test permits loopback only, regardless of remote mutation opt-in', () => {
  for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173']) assert.equal(requireLocalTestOrigin(origin), origin);
  for (const origin of ['https://example.com', 'https://localhost.example.com', 'http://127.0.0.1@example.com', 'file:///tmp/test', 'http://localhost:5173/path']) assert.throws(() => requireLocalTestOrigin(origin));
});

test('remote mutating overlay fails closed unless exact origin is acknowledged', () => {
  const origin = 'https://test-deployment.example.com';
  for (const acknowledgement of [undefined, '', 'true', '1', 'https://different.example.com', `${origin}/`]) assert.throws(() => requireOverlayMutationOptIn(origin, acknowledgement));
  assert.equal(requireOverlayMutationOptIn(origin, origin), origin);
  assert.equal(requireOverlayMutationOptIn('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.throws(() => requireOverlayMutationOptIn('https://user:secret@example.com', 'https://example.com'));
});
