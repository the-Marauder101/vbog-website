// js/config.js — Supabase connection for the Closer–Match tool.
//
// PUBLISHABLE KEY ONLY. This file ships to the browser.
// Never put the Secret key, the service_role key, or a personal access token
// here. The database is written so that nothing the browser needs requires
// them: the candidate surface goes through SECURITY DEFINER functions, and
// every table is default-deny under RLS (sql/08_rls_retention.sql).
//
// In particular: `item_options` holds the answer key for all 44 items and is
// readable only by an authenticated staff user. If you ever find yourself
// wanting a broader grant to make a page work, the page is wrong.

const SUPABASE_URL = "https://zglavicybcjctogspbap.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eRE4W8O9UDMstYjR8makhA_79T5ehAg";
