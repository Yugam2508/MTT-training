alter table public.spc_watch_checks add column if not exists gone_signals jsonb not null default '[]';
comment on column public.spc_watch_checks.gone_signals is 'Signals from the previous check that disappeared.';
