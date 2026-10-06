-- Watcher status (waiting / changed / open), phone notifications through ntfy.sh, and all page links.
alter table public.spc_watch_checks
  add column if not exists status text not null default 'waiting' check (status in ('waiting', 'changed', 'open')),
  add column if not exists pushed boolean not null default false;
comment on column public.spc_watch_checks.pushed is 'A phone notification went out for this check.';
alter table public.spc_watch_state add column if not exists ntfy_topic text;
comment on column public.spc_watch_state.ntfy_topic is 'ntfy.sh topic for phone notifications (null = off).';
