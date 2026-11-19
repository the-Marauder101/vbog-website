#!/usr/bin/env bash
# Runs the paste-in setup file and the checks on a throwaway local Postgres database (needs psql, Postgres 15+).
# Also proves the v1 -> v2 upgrade path (reset_all.sql) when tests/v1_setup.sql is present.
set -euo pipefail
cd "$(dirname "$0")/.."
./build_setup.sh
DB=${DB:-ra_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/local_stubs.sql
if [ -f tests/v1_setup.sql ]; then
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/v1_setup.sql -f supabase/reset_all.sql
fi
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/setup.sql -f supabase/test_data/ogo_po082.sql 2>&1 | grep -v NOTICE || true
# prove reset_all.sql clears a loaded v2 project so setup.sql can run again
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/reset_all.sql -f supabase/setup.sql -f supabase/test_data/ogo_po082.sql 2>&1 | grep -v NOTICE || true
psql -d "$DB" -f tests/checks.sql
# PRD 7a: stock from the 1 Nov opening (Tinu's 31 Oct closing)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/test_data/opening_2026_11.sql
psql -d "$DB" -f tests/checks_7a.sql
psql -d "$DB" -f tests/checks_7b.sql
psql -d "$DB" -f tests/checks_booking.sql
psql -d "$DB" -f tests/checks_prices.sql
