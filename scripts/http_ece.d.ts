// Minimal types for http_ece (RFC 8188/8291 reference implementation), used only in tests.
declare module 'http_ece' {
  import type { Buffer } from 'node:buffer';
  import type { ECDH } from 'node:crypto';
  const ece: {
    decrypt(
      buffer: Buffer,
      params: { version: 'aes128gcm'; privateKey: ECDH; authSecret: string },
    ): Buffer;
  };
  export default ece;
}
