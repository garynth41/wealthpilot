-- Staging only (0.25.0) — never applied to production. Two test users for the database tests and a clean-up function they call.
-- Apply after the schema, with __OWNER_HASH__ / __VIEWER_HASH__ replaced by bcrypt hashes of the password kept in the GitHub
-- secret STAGING_E2E_PASSWORD (the plain password never goes into SQL or the repo).
do $$
declare u record;
begin
  for u in select * from (values ('e2e-owner@wealthpilot.test', '__OWNER_HASH__'), ('e2e-viewer@wealthpilot.test', '__VIEWER_HASH__')) as t(email, hash) loop
    if not exists (select 1 from auth.users where email = u.email) then
      with nu as (
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
        values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', u.email, u.hash, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
        returning id, email)
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        select gen_random_uuid(), nu.id, nu.id::text, jsonb_build_object('sub', nu.id::text, 'email', nu.email, 'email_verified', true), 'email', now(), now(), now() from nu;
    else
      update auth.users set encrypted_password = u.hash, email_confirmed_at = coalesce(email_confirmed_at, now()) where email = u.email;
    end if;
  end loop;
end $$;

-- removes every household an e2e user created (each run starts clean); only the test users can run it
create or replace function public.e2e_cleanup() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if coalesce((select email from auth.users where id = auth.uid()), '') not like 'e2e-%@wealthpilot.test' then raise exception 'test users only'; end if;
  delete from public.households h where h.created_by in (select id from auth.users where email like 'e2e-%@wealthpilot.test');
  get diagnostics n = row_count;
  delete from public.household_invites where email like 'e2e-%@wealthpilot.test';
  delete from auth.users where email like 'e2e-tmp-%@wealthpilot.test';   -- a throwaway user a failed run left behind (0.25.1)
  return n;
end $$;
revoke all on function public.e2e_cleanup() from public, anon;
grant execute on function public.e2e_cleanup() to authenticated;

-- 0.25.1: a throwaway third user for the account-deletion test — confirmed, with the caller's password, only at e2e-tmp-… addresses.
-- The test deletes it through the delete-account function; e2e_cleanup removes one a failed run left behind.
create or replace function public.e2e_make_user(p_email text) returns uuid language plpgsql security definer set search_path = '' as $$
declare me record; uid uuid;
begin
  select id, email, encrypted_password into me from auth.users where id = auth.uid();
  if coalesce(me.email, '') not like 'e2e-%@wealthpilot.test' then raise exception 'test users only'; end if;
  if coalesce(p_email, '') not like 'e2e-tmp-%@wealthpilot.test' then raise exception 'throwaway test addresses only'; end if;
  select id into uid from auth.users where email = p_email; if uid is not null then return uid; end if;
  uid := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email, me.encrypted_password, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
  return uid;
end $$;
revoke all on function public.e2e_make_user(text) from public, anon;
grant execute on function public.e2e_make_user(text) to authenticated;
