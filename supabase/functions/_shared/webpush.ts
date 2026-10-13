/**
 * Web Push with WebCrypto only, so the same code runs in the Supabase Edge Function (Deno),
 * in Node (tests, CI checks) and in browsers:
 *  - VAPID authentication (RFC 8292): an ES256 JWT signed with the VAPID private key,
 *  - payload encryption with aes128gcm (RFC 8291, RFC 8188).
 * No imports, so it bundles as is.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes). */
  publicKey: string;
  /** P-256 private scalar, base64url (32 bytes). */
  privateKey: string;
  /** `mailto:` or `https:` contact for the push service. */
  subject: string;
}

export interface PushResult {
  status: number;
  ok: boolean;
  /** The subscription no longer exists (404 or 410): delete it. */
  gone: boolean;
  body: string;
}

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

function bytes(n: number): Bytes {
  return new Uint8Array(new ArrayBuffer(n));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = bytes(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = bytes(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function b64urlEncode(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key is not a P-256 key');
  if (b64urlDecode(keys.privateKey).length !== 32) {
    throw new Error('VAPID private key is not a P-256 key');
  }
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** The `Authorization` header value for a push to `endpoint`. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): Promise<string> {
  const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        // Push services accept at most 24 hours ahead; 12 is safe everywhere.
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: keys.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await vapidSigningKey(keys),
    encoder.encode(unsigned),
  );
  return `vapid t=${unsigned}.${b64urlEncode(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

/** True when the private key belongs to the public key (sign, then verify). */
export async function vapidKeysMatch(publicKey: string, privateKey: string): Promise<boolean> {
  try {
    const keys = { publicKey, privateKey, subject: 'https://example.com' };
    const msg = encoder.encode('lexbites');
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await vapidSigningKey(keys),
      msg,
    );
    const verifier = await crypto.subtle.importKey(
      'raw',
      b64urlDecode(publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, sig, msg);
  } catch {
    return false;
  }
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** RFC 8291 aes128gcm body: header (salt, record size, sender key) plus one encrypted record. */
export async function encryptPayload(
  sub: PushSubscriptionKeys,
  payload: Uint8Array,
): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256),
  );
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(bytes(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then the 0x02 delimiter that marks the last record.
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      aes,
      concat(payload, Uint8Array.of(2)),
    ),
  );
  const recordSize = 4096;
  if (payload.length + 17 > recordSize) throw new Error('push payload too large');
  const header = bytes(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

export interface SendOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Replaces an undelivered message with the same topic (max 32 URL-safe chars). */
  topic?: string;
  fetch?: typeof fetch;
  now?: number;
}

export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  keys: VapidKeys,
  opts: SendOptions = {},
): Promise<PushResult> {
  const body = await encryptPayload(sub, encoder.encode(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, keys, opts.now),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 4 * 3600),
    Urgency: opts.urgency ?? 'normal',
  };
  if (opts.topic) headers.Topic = opts.topic;
  const res = await (opts.fetch ?? fetch)(sub.endpoint, { method: 'POST', headers, body });
  const text = await res.text().catch(() => '');
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    gone: res.status === 404 || res.status === 410,
    body: text.slice(0, 300),
  };
}
