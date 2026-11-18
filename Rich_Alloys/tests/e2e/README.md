# Browser test

Runs the real app against a local stand-in for Supabase (PostgREST for data, a small auth and storage stub)
and drives it as Tinu, Niti, Himanshu, the watchman and Sanjay.

1. `tests/e2e/setup_db.sh` (as a Postgres superuser) — fresh database with setup.sql, Ogo data and five test users (password `pw`).
2. Start PostgREST 12: `postgrest tests/e2e/pgrst.conf`
3. Build the app (`cd web && npm run build`), then `node tests/e2e/server.mjs web/dist` (serves on http://localhost:54321).
4. `python3 tests/e2e/run.py` (needs Python Playwright). It prints each step, the DN totals, ledger, cash and stock, and saves screenshots.

Expected on fresh data: DN totals 7,080.00 / 1,180.00 / 14,160.00; ledger balance 10,92,579.40; cash all open 10.93 L.
