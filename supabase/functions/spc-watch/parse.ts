/** Page parsing for the SPC registration watcher: HTML to text, registration phrases, sign-up links. */

/** Phrases that suggest registration is open, about to open, or closed. */
export const SIGNALS: RegExp[] = [
  /registrations?\s+(?:is\s+|are\s+)?(?:now\s+)?open\b/gi,
  /registrations?\s+(?:opens?|opening|starts?)\b/gi,
  /pre-?\s?regist(?:er|ration)/gi,
  /register\s+(?:now|here|today|your|for)\b/gi,
  /book\s+(?:now|your|a)\b/gi,
  /reserve\s+(?:now|your|a)\b/gi,
  /sign\s*-?\s*up\s+(?:now|here|today|for)\b/gi,
  /early\s*-?\s*bird/gi,
  /sold\s+out|fully\s+booked|wait\s*-?\s*list/gi,
  // The site's placeholders while registration is closed ("Bookings available soon", "Schedule (coming soon)").
  // A new wording appearing, or these disappearing, is the clearest sign that bookings opened.
  /bookings?\s+(?:are\s+)?(?:now\s+)?(?:open|available)(?:\s+(?:soon|now))?/gi,
  /coming\s+soon/gi,
];
/** Mentions of the December 2026 event (SPC XXIII), used to tell its news from old events. */
export const EVENT_RE = /\bXXIII\b|\bSPC\s*23\b|\bdec(?:ember)?\b|\b18\s*(?:-|–|to)\s*20\b/i;
/** Links that look like registration, booking or sign-up forms. */
export const LINK_RE = /regist|booking|\bbook\b|reserve|sign-?up|forms\.gle|docs\.google\.com\/forms|typeform|eventbrite|ticket/i;

export interface Page { url: string; status: number; hash: string; chars: number; text: string }
export interface Signal { url: string; phrase: string; snippet: string; event: boolean }
export interface Link { href: string; text: string; from: string; /** looks like registration or booking */ reg: boolean }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr|\/section)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

export function linksOf(html: string, base: string): Link[] {
  const out: Link[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href: string;
    try { href = new URL(decodeEntities(m[1]), base).toString(); } catch { continue; }
    if (!/^https?:/.test(href)) continue;
    const text = htmlToText(m[2]).replace(/\s+/g, ' ').slice(0, 120);
    out.push({ href, text, from: base, reg: LINK_RE.test(href) || LINK_RE.test(text) });
  }
  return out;
}

export function signalsOf(text: string, url: string): Signal[] {
  const flat = text.replace(/\s+/g, ' ');
  const out: Signal[] = [];
  for (const re of SIGNALS) {
    for (const m of flat.matchAll(re)) {
      const at = m.index ?? 0;
      const snippet = flat.slice(Math.max(0, at - 140), at + m[0].length + 140).trim();
      out.push({ url, phrase: m[0], snippet, event: EVENT_RE.test(snippet) });
    }
  }
  return out;
}

export type WatchStatus = 'waiting' | 'changed' | 'open';

/** Wording that means players can sign up now (checked on phrases that do not say "soon"). */
const OPEN_RE = /registrations?\s+(?:is\s+|are\s+)?(?:now\s+)?open\b|register\s+(?:now|here|today)|pre-?\s?regist|book\s+now|bookings?\s+(?:are\s+)?(?:now\s+)?(?:open|available)|sign\s*-?\s*up\s+(?:now|here|today)/i;
const PLACEHOLDER_RE = /coming\s+soon|available\s+soon/i;
/** The Community Card sign-up is not tournament registration. */
const NOT_REGISTRATION = /spc-members\.onrender\.com/i;

/**
 * open: registration wording or a registration link is on the site now.
 * changed: a "coming soon" placeholder disappeared or the schedule page changed: worth a look.
 * waiting: nothing new.
 */
export function watchStatus(signals: Signal[], gone: Signal[], links: Link[], changedPages: string[]): WatchStatus {
  const openWording = signals.some((s) => OPEN_RE.test(s.phrase) && !/soon/i.test(s.phrase));
  const regLink = links.some((l) => l.reg && !NOT_REGISTRATION.test(l.href));
  if (openWording || regLink) return 'open';
  if (gone.some((s) => PLACEHOLDER_RE.test(s.phrase)) || changedPages.some((u) => /\/schedule\b/.test(u))) return 'changed';
  return 'waiting';
}
