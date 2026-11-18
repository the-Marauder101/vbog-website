#!/usr/bin/env bash
# Runs the paste-in setup file and the checks on a throwaway local Postgres database (needs psql, Postgres 15+).
set -euo pipefail
cd "$(dirname "$0")/.."
./build_setup.sh
DB=${DB:-ra_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/local_stubs.sql -f supabase/setup.sql \
  -f supabase/test_data/ogo_po082.sql -f supabase/add_user.sql
psql -d "$DB" -f tests/checks.sql
