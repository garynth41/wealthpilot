-- 0012 (0.19.0): Web Push VAPID keys. Generated once with web-push's generateVAPIDKeys. The PUBLIC key is in app_meta.vapid_public (the browser
-- subscribes with it); the PRIVATE key is the edge-function secret VAPID_PRIVATE_KEY (set in the Supabase dashboard, never in this repo), with
-- VAPID_PUBLIC_KEY and VAPID_SUBJECT (mailto:…) beside it. vapid_keys() is a fallback that reads Vault secrets named wealthpilot_vapid_public /
-- wealthpilot_vapid_private if someone prefers to keep them there (service role only). To rotate: new pair → update the secret(s) and app_meta,
-- then every device re-subscribes from Settings → Notifications.
create or replace function public.vapid_keys() returns table(public_key text, private_key text) language sql security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_vapid_public'), (select decrypted_secret from vault.decrypted_secrets where name = 'wealthpilot_vapid_private')
$$;
revoke all on function public.vapid_keys() from public, anon, authenticated;
grant execute on function public.vapid_keys() to service_role;
insert into public.app_meta(key, value) values ('vapid_public', 'BMjFhcjavazeK8iJldaBfPzluUUBeGk6SbGpsAUiwudW4ztb8vNZPVbkDs36TetivpekLhA_MCmmikT_Xo2RW5I') on conflict (key) do update set value = excluded.value, updated_at = now();
