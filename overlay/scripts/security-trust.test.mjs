import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { toIPv4 as routeClientIp } from '../backend/lib/ip.js';
import { createFingerprint, createToken, toIPv4, verifyToken } from '../backend/middleware/security.js';
import { getClientIP } from '../backend/utils/client-ip.js';

function request(peer, forwarded, ua = 'Test browser') {
  return {
    socket: { remoteAddress: peer },
    headers: { 'x-forwarded-for': forwarded, 'user-agent': ua },
  };
}

function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('security and route-level checks share the same IP resolver', () => {
  assert.equal(toIPv4, routeClientIp);
});

test('Render uses the closest forwarded client hop even with an IPv6 proxy peer', () => {
  withEnvironment({ RENDER: 'true' }, () => {
    const req = request('fd00:abcd::7', '198.51.100.99, 203.0.113.42');
    assert.equal(toIPv4(null, req), '203.0.113.42');
    assert.equal(getClientIP(req), '203.0.113.42');
  });
});

test('direct clients outside Render cannot spoof forwarding headers', () => {
  withEnvironment({ RENDER: undefined }, () => {
    const req = request('198.51.100.10', '203.0.113.42');
    req.headers['cf-connecting-ip'] = '203.0.113.43';
    req.headers['x-real-ip'] = '203.0.113.44';
    assert.equal(toIPv4(null, req), '198.51.100.10');
    assert.equal(getClientIP(req), '198.51.100.10');
  });
});

test('local proxy forwarding and IPv4-mapped socket addresses remain supported', () => {
  withEnvironment({ RENDER: undefined }, () => {
    assert.equal(toIPv4(null, request('::ffff:127.0.0.1', '203.0.113.42')), '203.0.113.42');
    assert.equal(toIPv4(null, request('::ffff:198.51.100.10')), '198.51.100.10');
  });
});

test('Render preserves distinct IPv6 visitor addresses from its closest hop', () => {
  withEnvironment({ RENDER: 'true' }, () => {
    const first = request('fd00:abcd::7', '198.51.100.99, 2001:db8::42');
    const second = request('fd00:abcd::7', '198.51.100.99, 2001:db8::43');
    assert.equal(toIPv4(null, first), '2001:db8::42');
    assert.equal(toIPv4(null, second), '2001:db8::43');
    assert.equal(getClientIP(first), '2001:db8::42');
    assert.notEqual(createFingerprint(first), createFingerprint(second));
  });
});

test('untrusted IPv6 peers retain their own address regardless of forged headers', () => {
  withEnvironment({ RENDER: undefined }, () => {
    assert.equal(toIPv4(null, request('2001:db8::10', '203.0.113.42')), '2001:db8::10');
    assert.equal(toIPv4(null, request('2001:db8::11', '2001:db8::10')), '2001:db8::11');
  });
});

test('invalid addresses cannot become trusted client identities', () => {
  withEnvironment({ RENDER: 'true' }, () => {
    assert.equal(toIPv4(null, request('fd00:abcd::7', '999.10.20.30')), '127.0.0.1');
    assert.equal(toIPv4(null, request('fd00:abcd::7', 'not-an-ip')), '127.0.0.1');
  });
});

test('spoofed earlier Render hops cannot change security fingerprints', () => {
  withEnvironment({ RENDER: 'true' }, () => {
    const first = request('fd00:abcd::7', '198.51.100.99, 203.0.113.42');
    const spoofed = request('fd00:abcd::8', '198.51.100.100, 203.0.113.42');
    assert.equal(createFingerprint(first), createFingerprint(spoofed));
    assert.notEqual(createFingerprint(first), createFingerprint(request('fd00:abcd::7', '203.0.113.43')));
  });
});

test('verification tokens stay bound to the actual Render client IP and user-agent', () => {
  const secret = 'test-only-secret-with-at-least-24-characters';
  withEnvironment({ RENDER: 'true', TOKEN_SECRET: secret }, () => {
    const client = request('fd00:abcd::7', '198.51.100.99, 203.0.113.42');
    const fp = createHmac('sha256', secret).update('203.0.113.42Test browser').digest('hex').slice(0, 16);
    const token = createToken({ http: true, ws: true, fp });
    assert.ok(verifyToken(token, client));
    assert.ok(verifyToken(token, request('fd00:abcd::8', '198.51.100.100, 203.0.113.42')));
    assert.equal(verifyToken(token, request('fd00:abcd::7', '203.0.113.43')), null);
    assert.equal(verifyToken(token, request('fd00:abcd::7', '203.0.113.42', 'Another browser')), null);
  });
});
