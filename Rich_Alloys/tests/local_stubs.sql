-- Stands in for the parts of Supabase that plain Postgres lacks (auth and storage),
-- so supabase/setup.sql can be run and checked locally exactly as it will be pasted.
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text unique);
-- same lookup as Supabase: legacy setting first, then the JWT claims PostgREST sets
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
