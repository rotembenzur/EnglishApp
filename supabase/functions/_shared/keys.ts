/**
 * Public values only, shared by the app (src/sync/config.ts) and the Edge Function. The anon key
 * and the VAPID public key are public by design: tables stay closed without the passphrase hash,
 * and pushes need the VAPID private key, which lives only in GitHub and Supabase secrets.
 */
export const PROJECT_URL = 'https://ngosxhpmudbgiiktqgoa.supabase.co';

export const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nb3N4aHBtdWRiZ2lpa3RxZ29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDg0ODgsImV4cCI6MjEwNzQyNDQ4OH0.nVoBZBZgZVuOJ7fRxe7moz35T6h1leyxLUOSpiDfx1Y';

/** VAPID public key (uncompressed P-256, base64url). Its private half is the VAPID_PRIVATE_KEY secret. */
export const VAPID_PUBLIC_KEY =
  'BBe86-qaxkeQ9F83Fg2MFznZpSBXuxNGnmhO2Z_WwKTUk-oki7RDFCBbCVeyPhuVy93u4kSoykQSy4_MDBnpBmk';

/** Contact the push services see in the VAPID token. */
export const VAPID_SUBJECT = 'https://rotembenzur.github.io/EnglishApp/';

/** Name of the Edge Function that sends pushes. */
export const PUSH_FUNCTION = 'lexbites-push';
