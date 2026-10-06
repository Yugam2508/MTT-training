-- Run the SPC registration check every two hours (at :17, to stay off the top of the hour).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'spc-watch',
  '17 */2 * * *',
  $$
  select net.http_post(
    url := 'https://tyjicebieaojrtedjpnx.supabase.co/functions/v1/spc-watch',
    headers := '{"content-type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
