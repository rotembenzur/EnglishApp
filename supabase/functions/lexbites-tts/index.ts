/**
 * LexBites text audio starter, a Supabase Edge Function deployed by
 * .github/workflows/push-server.yml. When a phone saves a text it adds a job to lb_tts_jobs and
 * calls this function, which starts the Text audio workflow (.github/workflows/tts.yml) on GitHub
 * right away. Without the GH_DISPATCH_TOKEN secret it starts nothing, and the workflow's
 * five-minute schedule picks the job up instead (SETUP.md, step 7).
 *
 * GET: status. POST {"job": id} with x-lexbites-key: checks the passphrase hash through
 * row-level security (the job must be readable with it), then dispatches the workflow.
 * Secrets: GH_DISPATCH_TOKEN (fine-grained token, Actions read and write on the repository).
 */
import { ANON_KEY, PROJECT_URL } from '../_shared/keys.ts';

const VERSION = 1;
const REST = `${(Deno.env.get('SUPABASE_URL') || PROJECT_URL).replace(/\/+$/, '')}/rest/v1/`;
const TOKEN = (Deno.env.get('GH_DISPATCH_TOKEN') ?? '').trim();
const REPO = Deno.env.get('GH_REPO') || 'rotembenzur/EnglishApp';
const BRANCH = Deno.env.get('GH_BRANCH') || 'claude/trusting-knuth-gbbnzv';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'content-type, x-lexbites-key, apikey, authorization, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** The job exists and the caller's key can read it (RLS), i.e. the caller has the passphrase. */
async function jobVisible(key: string, id: string): Promise<boolean> {
  const res = await fetch(`${REST}lb_tts_jobs?select=id&id=eq.${encodeURIComponent(id)}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'x-lexbites-key': key },
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as unknown[];
  return rows.length === 1;
}

async function dispatch(): Promise<{ dispatched: boolean; status?: number }> {
  if (!TOKEN) return { dispatched: false };
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/tts.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'lexbites-tts',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: BRANCH }),
    },
  );
  await res.body?.cancel();
  return { dispatched: res.status === 204, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return json({ ok: true, version: VERSION, dispatch: !!TOKEN });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const key = req.headers.get('x-lexbites-key') ?? '';
  if (!/^[0-9a-f]{64}$/.test(key)) return json({ error: 'unauthorized' }, 401);
  let body: { job?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!body.job || !(await jobVisible(key, body.job))) return json({ error: 'unknown job' }, 404);
  try {
    return json(await dispatch());
  } catch (e) {
    console.error(`dispatch: ${(e as Error).message}`);
    return json({ dispatched: false, error: 'dispatch failed' }, 502);
  }
});
