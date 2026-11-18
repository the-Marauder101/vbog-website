#!/usr/bin/env bash
# Rebuilds supabase/setup.sql (the single paste-in file) from the migrations. Run after editing any migration.
set -euo pipefail
cd "$(dirname "$0")/supabase"
{
  echo "-- Rich Alloys purchase portal: complete database setup."
  echo "-- Paste this whole file into the Supabase SQL editor of a NEW, EMPTY project and run it once."
  echo "-- Generated from supabase/migrations by build_setup.sh. Do not edit by hand."
  echo; echo "begin;"
  for f in migrations/*.sql; do echo; echo "-- ######## $f ########"; cat "$f"; done
  echo; echo "commit;"
} > setup.sql
echo "wrote supabase/setup.sql"
