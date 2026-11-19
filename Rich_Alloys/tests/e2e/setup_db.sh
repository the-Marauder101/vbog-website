#!/usr/bin/env bash
# Loads setup.sql + Ogo data + five test staff into a local database for the browser test. Run as a Postgres superuser.
set -e
cd "$(dirname "$0")/../.."
psql -q -d postgres -c "drop database if exists ra_e2e with (force)" -c "create database ra_e2e"
psql -q -d postgres -c "do \$\$ begin if not exists (select from pg_roles where rolname='authenticator') then create role authenticator login password 'x' noinherit; end if; end \$\$"
psql -q -v ON_ERROR_STOP=1 -d ra_e2e -f tests/local_stubs.sql -f supabase/setup.sql -f supabase/test_data/ogo_po082.sql 2>&1 | grep -v NOTICE || true
psql -q -d ra_e2e -c "grant anon, authenticated to authenticator" -c "
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','owner@t'),('00000000-0000-0000-0000-0000000000a2','tinu@t'),
 ('00000000-0000-0000-0000-0000000000a3','niti@t'),('00000000-0000-0000-0000-0000000000a4','gate@t'),('00000000-0000-0000-0000-0000000000a5','sanjay@t');
insert into profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000a1','Himanshu Jain','owner'),
 ('00000000-0000-0000-0000-0000000000a2','Tinu Anand','factory_accounts'),('00000000-0000-0000-0000-0000000000a3','Niti Chopra','ho_accounts'),
 ('00000000-0000-0000-0000-0000000000a4','Watchman','gate'),('00000000-0000-0000-0000-0000000000a5','Sanjay','factory');"
