/**
 * The sync backend both phones use (SETUP.md step 3). The project URL and the anon key are public
 * by design: every table is closed by row-level security unless the request carries the hash of
 * the shared passphrase, which is typed once in Settings on each phone and never stored here.
 * A build can point elsewhere with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 */
export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://ngosxhpmudbgiiktqgoa.supabase.co';

export const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nb3N4aHBtdWRiZ2lpa3RxZ29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NDg0ODgsImV4cCI6MjEwNzQyNDQ4OH0.nVoBZBZgZVuOJ7fRxe7moz35T6h1leyxLUOSpiDfx1Y';
