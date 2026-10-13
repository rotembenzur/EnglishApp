/**
 * Push server crypto (supabase/functions/_shared/webpush.ts) checked against independent
 * implementations: http_ece for RFC 8291 decryption, node:crypto for the ES256 VAPID token.
 * Scheduling rules are tested in src/sync/push-server.test.ts.
 */
import { Buffer } from 'node:buffer';
import { createECDH, createPublicKey, verify, webcrypto } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  sendPush,
  vapidAuthorization,
  vapidKeysMatch,
} from '../supabase/functions/_shared/webpush.ts';
import { VAPID_PUBLIC_KEY } from '../supabase/functions/_shared/keys.ts';

async function vapidPair() {
  const k = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', k.publicKey));
  const jwk = await webcrypto.subtle.exportKey('jwk', k.privateKey);
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d!, subject: 'https://example.com/' };
}

function browserSubscription() {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  return {
    ua,
    auth,
    sub: {
      endpoint: 'https://web.push.apple.com/QGx1a2VzdA',
      keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) },
    },
  };
}

describe('web push crypto', () => {
  it('encrypts a payload the RFC 8291 reference library can decrypt', async () => {
    const { ua, auth, sub } = browserSubscription();
    const text = JSON.stringify({ title: 'נועה', body: 'נועה שלחה לך 🔥' });
    const body = await encryptPayload(sub, new TextEncoder().encode(text));
    const plain = ece.decrypt(Buffer.from(body), {
      version: 'aes128gcm',
      privateKey: ua,
      authSecret: b64urlEncode(auth),
    });
    expect(plain.toString('utf8')).toBe(text);
  });

  it('signs a VAPID token push services accept', async () => {
    const keys = await vapidPair();
    const now = Date.UTC(2026, 9, 13, 12);
    const header = await vapidAuthorization('https://web.push.apple.com/abc?x=1', keys, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
    expect(claims.aud).toBe('https://web.push.apple.com');
    expect(claims.sub).toBe(keys.subject);
    expect(claims.exp * 1000 - now).toBeGreaterThan(3600_000);
    expect(claims.exp * 1000 - now).toBeLessThanOrEqual(24 * 3600_000);
    const pub = b64urlDecode(keys.publicKey);
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: b64urlEncode(pub.subarray(1, 33)),
        y: b64urlEncode(pub.subarray(33)),
      },
      format: 'jwk',
    });
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${c}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sig!, 'base64url'),
    );
    expect(ok).toBe(true);
  });

  it('tells a matching private key from a wrong one', async () => {
    const a = await vapidPair();
    const b = await vapidPair();
    expect(await vapidKeysMatch(a.publicKey, a.privateKey)).toBe(true);
    expect(await vapidKeysMatch(a.publicKey, b.privateKey)).toBe(false);
    expect(await vapidKeysMatch(a.publicKey, 'not-a-key')).toBe(false);
  });

  it('ships a valid uncompressed P-256 public key', () => {
    const raw = b64urlDecode(VAPID_PUBLIC_KEY);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(4);
  });

  it('posts with the headers push services require and flags dead subscriptions', async () => {
    const keys = await vapidPair();
    const { sub } = browserSubscription();
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('', { status });
    }) as unknown as typeof fetch;
    const ok = await sendPush(sub, { title: 'x' }, keys, { fetch: fake, ttl: 60, topic: 'daily' });
    expect(ok).toMatchObject({ ok: true, gone: false, status: 201 });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(sub.endpoint);
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.TTL).toBe('60');
    expect(h.Topic).toBe('daily');
    expect(h.Authorization).toMatch(/^vapid t=.+, k=/);
    status = 410;
    expect(await sendPush(sub, { title: 'x' }, keys, { fetch: fake })).toMatchObject({
      ok: false,
      gone: true,
    });
  });
});
