/**
 * CI check before deploying the push server: the VAPID_PRIVATE_KEY secret must belong to the
 * public key in the repository. Prints only the verdict, never the key.
 * Run with Deno (push-server.yml) or `pnpm exec tsx scripts/check-vapid.ts`.
 */
import process from 'node:process';
import { VAPID_PUBLIC_KEY } from '../supabase/functions/_shared/keys.ts';
import { vapidKeysMatch } from '../supabase/functions/_shared/webpush.ts';

const key = (process.env.VAPID_PRIVATE_KEY ?? '').replace(/[\s"']/g, '');
if (!key) {
  console.error('VAPID_PRIVATE_KEY is empty');
  process.exit(1);
}
if (!(await vapidKeysMatch(VAPID_PUBLIC_KEY, key))) {
  console.error(
    'VAPID_PRIVATE_KEY does not match the public key in supabase/functions/_shared/keys.ts. ' +
      'Copy the private key from SETUP.md step 4 again (43 characters, no spaces).',
  );
  process.exit(1);
}
console.info('VAPID key pair matches');
