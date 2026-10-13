/**
 * The sync backend both phones use (SETUP.md step 3). The project URL and the anon key are public
 * by design: every table is closed by row-level security unless the request carries the hash of
 * the shared passphrase, which is typed once in Settings on each phone and never stored here.
 * A build can point elsewhere with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 * The values live in supabase/functions/_shared/keys.ts so the push Edge Function uses the same.
 */
import {
  ANON_KEY,
  PROJECT_URL,
  PUSH_FUNCTION,
  VAPID_PUBLIC_KEY as DEFAULT_VAPID_PUBLIC_KEY,
} from '../../supabase/functions/_shared/keys.ts';

export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) || PROJECT_URL;

export const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || ANON_KEY;

/** Web push (SETUP.md step 4). The private half is a GitHub secret, never in the repository. */
export const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || DEFAULT_VAPID_PUBLIC_KEY;

export { PUSH_FUNCTION };
