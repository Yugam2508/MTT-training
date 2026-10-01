-- Storage for the mtt-api Edge Function: user records (users/<name>.json), synced progress
-- (data/<uid>.bin) and the token signing key (config/auth-secret).
create table public.app_storage (
  key text primary key,
  body text not null,            -- base64-encoded bytes (gzip or JSON)
  content_type text not null,
  etag text not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_storage is 'MTT Coach API storage. Accessed only by the mtt-api Edge Function with the secret key; no client access.';

-- RLS on with no policies: the anon and authenticated roles can't read or write anything.
alter table public.app_storage enable row level security;
revoke all on table public.app_storage from anon, authenticated;
