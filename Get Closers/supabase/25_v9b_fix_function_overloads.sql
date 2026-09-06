-- Migration 25: V9b — Fix pravah_client_update_lead overload ambiguity
--
-- HOTFIX for a defect introduced by migration 23.
--
-- Migration 23 added p_tags to pravah_client_update_lead using
-- `create or replace function`. Because that changes the signature, Postgres
-- created a SECOND function rather than replacing the first. Both overloads
-- accept {p_lead_id, p_stage} with everything else defaulted, so PostgREST
-- cannot choose between them and returns PGRST203 on any call that does not
-- mention p_tags.
--
-- Confirmed live against production:
--   PGRST203 "Could not choose the best candidate function between:
--     public.pravah_client_update_lead(p_lead_id, p_stage, p_notes, p_email, p_phone),
--     public.pravah_client_update_lead(p_lead_id, p_stage, p_notes, p_email, p_phone, p_tags)"
--
-- Client portal impact:
--   - inline lead stage dropdown  -> BROKEN (sends p_lead_id + p_stage)
--   - bulk stage update           -> BROKEN (same)
--   - edit lead modal             -> unaffected (sends p_tags, resolves uniquely)
--
-- Fix: drop the pre-tags 5-argument version. The 6-argument version is a
-- strict superset — p_tags defaults to null and coalesces to the existing
-- value — so every existing caller keeps working unchanged.

drop function if exists pravah_client_update_lead(uuid, text, text, text, text);

-- Note on pravah_list_invitations: it also has two signatures (zero-arg and
-- p_client_id uuid). That pair is NOT ambiguous and is deliberately left
-- alone. The one-argument form has no default, so an empty request body can
-- only match the zero-argument form, and a body carrying p_client_id can only
-- match the one-argument form. Dropping either would break a live caller —
-- pravah/js/app.js calls it with no arguments.

-- Verification — expect exactly one row, the 6-argument signature:
--   select pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'pravah_client_update_lead';
