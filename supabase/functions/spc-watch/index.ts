/**
 * Supabase Edge Function: checks the Singapore Poker Championships website for registration news.
 * pg_cron calls it every two hours. Each check is stored in public.spc_watch_checks: the page text,
 * registration-sounding phrases, which appeared or disappeared since the last check, and the links
 * (registration or booking ones are followed once). The MTT Coach banner and the optional email
 * routine (docs/spc-reminder.md) read the results.
 *
 * When the status moves to "changed" or "open" it sends a phone notification through ntfy.sh to the
 * topic in spc_watch_state.ntfy_topic (if set). GET ?a=status returns the latest status for the
 * MTT Coach banner.
 *
 * JWT verification is off so pg_cron and the website can call it without a key. It only reads a
 * public website and runs at most once every ten minutes, so calling it directly does no harm.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { htmlToText, linksOf, signalsOf, watchStatus, type Link, type Page, type Signal, type WatchStatus } from './parse.ts';

const SITE = 'https://www.sgpokerchamps.com';
const PAGES = ['/', '/schedule', '/event-structures'];
const MAX_TEXT = 20_000;
const MAX_FOLLOW = 4;
const MAX_LINKS = 80;
const MIN_INTERVAL_MS = 10 * 60_000;
const KEEP_CHECKS = 60;
const USER_AGENT = 'Mozilla/5.0 (compatible; MTT-Coach-SPC-watch/1.0; personal registration reminder)';

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchPage(url: string): Promise<{ page: Page; html: string }> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  const html = await res.text();
  const text = htmlToText(html);
  return { page: { url, status: res.status, hash: await sha256(text), chars: text.length, text: text.slice(0, MAX_TEXT) }, html };
}

function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof keys.default === 'string') return keys.default;
  } catch { /* fall back to the legacy key */ }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No Supabase secret key available');
  return legacy;
}

const PUSH_TEXT: Record<Exclude<WatchStatus, 'waiting'>, { title: string; body: string }> = {
  open: { title: 'SPC XXIII registration looks open', body: 'The SPC website now shows registration or booking wording. Register at sgpokerchamps.com.' },
  changed: { title: 'SPC website changed', body: 'A "coming soon" notice changed on sgpokerchamps.com. Check whether SPC XXIII registration has opened.' },
};

async function push(topic: string, status: Exclude<WatchStatus, 'waiting'>): Promise<void> {
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    body: PUSH_TEXT[status].body,
    headers: { Title: PUSH_TEXT[status].title, Priority: status === 'open' ? 'high' : 'default', Tags: 'spades', Click: SITE },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), { auth: { persistSession: false, autoRefreshToken: false } });

async function check(): Promise<Record<string, unknown>> {
  const { data: prev, error: prevErr } = await db.from('spc_watch_checks')
    .select('id, checked_at, pages, signals, status').eq('ok', true).order('id', { ascending: false }).limit(1).maybeSingle();
  if (prevErr) throw prevErr;
  const { data: last } = await db.from('spc_watch_checks').select('checked_at').order('id', { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.checked_at).getTime() < MIN_INTERVAL_MS) return { skipped: true, lastCheck: last.checked_at };

  const pages: Page[] = [];
  const links: Link[] = [];
  const errors: string[] = [];
  for (const path of PAGES) {
    try {
      const { page, html } = await fetchPage(SITE + path);
      pages.push(page);
      links.push(...linksOf(html, page.url));
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Follow registration-looking links once: a form page shows whether it is accepting responses.
  const seen = new Set(pages.map((p) => p.url));
  const uniqueLinks = [...new Map(links.map((l) => [l.href, l])).values()].slice(0, MAX_LINKS);
  const follow = uniqueLinks.filter((l) => l.reg && !seen.has(l.href)).slice(0, MAX_FOLLOW);
  for (const l of follow) {
    try { pages.push((await fetchPage(l.href)).page); } catch (e) { errors.push(`${l.href}: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const ok = pages.some((p) => p.url.startsWith(SITE) && p.status < 400 && p.chars > 200);
  const signals = pages.flatMap((p) => signalsOf(p.text, p.url));
  const prevSnippets = new Set(((prev?.signals ?? []) as Signal[]).map((s) => s.snippet));
  const newSignals = prev ? signals.filter((s) => !prevSnippets.has(s.snippet)) : [];
  const nowSnippets = new Set(signals.map((s) => s.snippet));
  const goneSignals = prev ? ((prev.signals ?? []) as Signal[]).filter((s) => !nowSnippets.has(s.snippet)) : [];
  const prevHash = new Map(((prev?.pages ?? []) as Page[]).map((p) => [p.url, p.hash]));
  const changed = prev ? pages.filter((p) => prevHash.get(p.url) !== p.hash).map((p) => p.url) : [];
  const status: WatchStatus = ok ? watchStatus(signals, goneSignals, uniqueLinks, changed) : 'waiting';

  // Notify once per move up to "changed" or "open"; a "changed" with nothing new settles back to waiting.
  let pushed = false;
  if (status !== 'waiting' && status !== prev?.status) {
    const { data: state } = await db.from('spc_watch_state').select('ntfy_topic').eq('id', 1).maybeSingle();
    if (state?.ntfy_topic) {
      try { await push(state.ntfy_topic, status); pushed = true; } catch (e) { errors.push(`push: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  const row = { ok, status, pushed, error: errors.length ? errors.join('; ') : null, pages, signals, new_signals: newSignals, gone_signals: goneSignals, links: uniqueLinks, changed_pages: changed };
  const { data: inserted, error } = await db.from('spc_watch_checks').insert(row).select('id').single();
  if (error) throw error;
  await db.from('spc_watch_checks').delete().lt('id', inserted.id - KEEP_CHECKS + 1);
  return {
    id: inserted.id, ok, status, pushed, errors,
    pages: pages.map((p) => ({ url: p.url, status: p.status, chars: p.chars })),
    signals: signals.length, newSignals: newSignals.length, goneSignals: goneSignals.length,
    links: uniqueLinks.length, regLinks: uniqueLinks.filter((l) => l.reg).length, changed,
  };
}

/** Latest status for the MTT Coach banner, plus the most recent "changed" or "open" check (a change lasts one check). */
async function latestStatus(): Promise<Record<string, unknown>> {
  const { data, error } = await db.from('spc_watch_checks').select('checked_at, status').eq('ok', true).order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return { status: 'unknown' };
  const { data: alert } = await db.from('spc_watch_checks').select('checked_at, status').eq('ok', true).neq('status', 'waiting')
    .order('id', { ascending: false }).limit(1).maybeSingle();
  return { status: data.status, checkedAt: data.checked_at, lastAlert: alert ? { status: alert.status, at: alert.checked_at } : null, site: SITE };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const statusOnly = new URL(req.url).searchParams.get('a') === 'status';
    return Response.json(statusOnly ? await latestStatus() : await check(), { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('spc-watch failed', e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
});
