/** TRUSTED_PROXIES and the identity of a client (S-01, R-1). No database: pure rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { canonicalIp, limitBucket, trustedProxies, trustedProxiesFromEnv } from './client-ip.ts';
import { checkEnvironment } from './config.ts';
import { clientIp } from './server.ts';

const request = (peer: string, forwarded?: string | string[]) =>
  ({
    socket: { remoteAddress: peer },
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  }) as unknown as IncomingMessage;

test('one address, one text: IPv6 spellings and every form of IPv4-mapped', () => {
  for (const same of ['2001:db8::1', '2001:DB8::1', '2001:0db8:0:0:0:0:0:1', '2001:db8:0:0::1'])
    assert.equal(canonicalIp(same), '2001:db8::1');
  for (const same of ['203.0.113.7', '::ffff:203.0.113.7', '::ffff:cb00:7107', '::FFFF:CB00:7107'])
    assert.equal(canonicalIp(same), '203.0.113.7');
  assert.equal(canonicalIp('fe80::1%en0'), 'fe80::1');
  assert.equal(canonicalIp(' no es ip '), 'no es ip');
});

test('R-1: the limit bucket is the /64 of an IPv6 address and the address of an IPv4 one', () => {
  assert.equal(limitBucket('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(limitBucket('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(limitBucket('2001:0DB8:1:2:0:0:0:ff'), '2001:db8:1:2::/64');
  assert.notEqual(limitBucket('2001:db8:1:3::1'), limitBucket('2001:db8:1:2::1'));
  assert.equal(limitBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(limitBucket('::1'), '0:0:0:0::/64');
  assert.equal(limitBucket('::ffff:203.0.113.7'), '203.0.113.7');
  assert.notEqual(limitBucket('203.0.113.7'), limitBucket('203.0.113.8'));
});

test('TRUSTED_PROXIES: addresses and CIDR ranges of both families; mapped peers match', () => {
  const t = trustedProxies(['10.0.0.1', '192.168.0.0/16', 'fd00::/8', '2001:db8::5']);
  for (const ip of ['10.0.0.1', '::ffff:10.0.0.1', '192.168.9.9', 'fd12::1', '2001:DB8::5'])
    assert.equal(t.has(ip), true, ip);
  for (const ip of ['10.0.0.2', '192.169.0.1', 'fe00::1', '2001:db8::6', 'x', ''])
    assert.equal(t.has(ip), false, ip);
});

test('TRUSTED_PROXIES: names, bad prefixes and ranges that trust the Internet are refused', () => {
  for (const bad of [
    'proxy.example.com',
    '10.0.0.0/99',
    '10.0.0.0/x',
    '10.0.0.0/8/8',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/7',
    'none',
  ])
    assert.throws(() => trustedProxies([bad]), /TRUSTED_PROXIES/, bad);
  assert.deepEqual(trustedProxiesFromEnv(''), []);
  assert.deepEqual(trustedProxiesFromEnv(undefined), []);
  assert.deepEqual(trustedProxiesFromEnv('NONE'), []);
  assert.deepEqual(trustedProxiesFromEnv('10.0.0.1,10.0.0.2'), ['10.0.0.1', '10.0.0.2']);
});

test('clientIp: a client that is not a proxy cannot choose its address; hops are read from the right', () => {
  const t = trustedProxies(['127.0.0.1', '10.0.0.0/8']);
  assert.equal(clientIp(request('203.0.113.1', '9.9.9.9'), t), '203.0.113.1');
  assert.equal(clientIp(request('::ffff:127.0.0.1', '203.0.113.5'), t), '203.0.113.5');
  assert.equal(clientIp(request('127.0.0.1', '9.9.9.9, 203.0.113.5, 10.1.2.3'), t), '203.0.113.5');
  assert.equal(clientIp(request('127.0.0.1', '2001:DB8::1'), t), '2001:db8::1');
  assert.equal(clientIp(request('127.0.0.1', '::ffff:cb00:7107'), t), '203.0.113.7');
  assert.equal(clientIp(request('127.0.0.1', 'garbage, 10.1.2.3'), t), '127.0.0.1');
  assert.equal(clientIp(request('127.0.0.1'), t), '127.0.0.1');
  assert.equal(clientIp(request('10.1.2.3', '10.2.2.2, 10.3.3.3'), t), '10.1.2.3');
});

const production = {
  NODE_ENV: 'production',
  TRUSTED_PROXIES: '10.0.0.1',
  APP_URL: 'https://escuela.example',
  MAIL_PROVIDER: 'none',
};

test('production configuration: what is wrong stops the start, and says why', () => {
  assert.deepEqual(checkEnvironment(production).errors, []);
  const errors = (over: Record<string, string | undefined>) =>
    checkEnvironment({ ...production, ...over }).errors.join(' ');
  assert.match(errors({ TRUSTED_PROXIES: '' }), /TRUSTED_PROXIES es obligatorio/);
  assert.match(errors({ TRUSTED_PROXIES: undefined }), /TRUSTED_PROXIES es obligatorio/);
  assert.match(errors({ TRUSTED_PROXIES: 'proxy.local' }), /no es una dirección IP/);
  assert.match(errors({ APP_URL: 'http://escuela.example' }), /APP_URL/);
  assert.match(errors({ APP_URL: undefined }), /APP_URL/);
  assert.match(errors({ COOKIE_SECURE: 'false' }), /COOKIE_SECURE/);
  assert.match(errors({ MAIL_CONSOLE: 'true' }), /MAIL_CONSOLE/);
  assert.match(errors({ MAIL_PROVIDER: undefined }), /MAIL_PROVIDER es obligatorio/);
  assert.match(errors({ MAIL_PROVIDER: 'resend' }), /RESEND_API_KEY/);
  assert.match(errors({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }), /MAIL_FROM/);
  assert.deepEqual(
    checkEnvironment({
      ...production,
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'k',
      MAIL_FROM: 'a',
    }).errors,
    [],
  );
  assert.match(
    checkEnvironment({ ...production, TRUSTED_PROXIES: 'none' }).warnings.join(' '),
    /TRUSTED_PROXIES=none/,
  );
});

test('production without HTTPS: only when COOKIE_SECURE=false and APP_URL http:// agree, with a warning', () => {
  const http = { ...production, APP_URL: 'http://45.80.152.66', COOKIE_SECURE: 'false' };
  assert.deepEqual(checkEnvironment(http).errors, []);
  assert.match(checkEnvironment(http).warnings.join(' '), /Sin HTTPS/);
  assert.match(checkEnvironment({ ...http, COOKIE_SECURE: undefined }).errors.join(' '), /APP_URL/);
  assert.match(checkEnvironment({ ...http, APP_URL: 'ftp://x' }).errors.join(' '), /COOKIE_SECURE/);
});

test('development configuration: warns about the cookie, refuses only a broken proxy list', () => {
  const dev = checkEnvironment({});
  assert.deepEqual(dev.errors, []);
  assert.match(dev.warnings.join(' '), /Secure/);
  assert.deepEqual(checkEnvironment({ COOKIE_SECURE: 'true' }).warnings, []);
  assert.match(checkEnvironment({ TRUSTED_PROXIES: 'x' }).errors.join(' '), /TRUSTED_PROXIES/);
});
