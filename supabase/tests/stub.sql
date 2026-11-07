-- A small stand-in for what Supabase provides (0.25.1), so every migration can run on a plain local Postgres in the database tests
-- (scripts/db-test.mjs): the API roles, auth.users / auth.uid(), storage buckets and objects, the vault and pg_cron's tables. It is not
-- Supabase: there postgres is not a superuser, and the sign-in and storage services add their own checks — staging stays the real test.
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_storage_admin nologin;
exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to current_user;
create schema auth; create schema storage; create schema vault; create schema cron; create schema extensions;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), confirmation_token text,
  email_change text, email_change_token_new text, recovery_token text, last_sign_in_at timestamptz, is_anonymous boolean default false, phone text);
create table auth.identities (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, email text);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, created_at timestamptz default now(),
  updated_at timestamptz default now(), user_agent text, ip inet, aal text, not_after timestamptz, refreshed_at timestamp);
-- who is asking: the tests set request.jwt.claims the way PostgREST does
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, owner_id text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz, metadata jsonb, version text);
alter table storage.objects enable row level security; alter table storage.buckets enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$ declare p text[]; begin p := string_to_array(name, '/'); return p[1:array_length(p, 1) - 1]; end $$;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text, created_at timestamptz default now(), updated_at timestamptz default now());
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$ insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
create table cron.job (jobid bigserial primary key, schedule text, command text, nodename text, nodeport int, database text, username text, active boolean default true, jobname text);
create table cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid int, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create publication supabase_realtime;
-- Supabase's default privileges: the API roles may use what is created in public (row-level security decides the rest)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
