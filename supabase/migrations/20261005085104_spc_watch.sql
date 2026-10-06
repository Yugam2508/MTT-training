-- SPC registration watcher: the spc-watch Edge Function stores one row per check of
-- sgpokerchamps.com; the reminder routine reads them and records what it has sent.
create table public.spc_watch_checks (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  error text,
  pages jsonb not null default '[]',        -- [{url, status, hash, chars, text}]
  signals jsonb not null default '[]',      -- registration phrases: [{url, phrase, snippet, event}]
  new_signals jsonb not null default '[]',  -- signals that were not in the previous check
  links jsonb not null default '[]',        -- registration/booking-looking links: [{href, text, from}]
  changed_pages text[] not null default '{}'
);

create table public.spc_watch_state (
  id int primary key default 1 check (id = 1),
  announced_at timestamptz,  -- emailed that an opening date was announced
  notified_at timestamptz,   -- emailed that registration is open
  reminded_at timestamptz,   -- sent the follow-up reminder
  note text
);
insert into public.spc_watch_state default values;

comment on table public.spc_watch_checks is 'SPC registration watcher results, written by the spc-watch Edge Function.';
comment on table public.spc_watch_state is 'What the SPC reminder routine has already sent.';

-- Server-side only, like app_storage.
alter table public.spc_watch_checks enable row level security;
alter table public.spc_watch_state enable row level security;
revoke all on table public.spc_watch_checks, public.spc_watch_state from anon, authenticated;
