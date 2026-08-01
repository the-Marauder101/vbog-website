-- ═══════════════════════════════════════════════════════════════════════════
-- A. Rename and delete, everywhere a record can be created
-- B. Supplement suggestion from templates — NOT generation
--
-- THE ONE THING DELETION MUST NEVER DESTROY
-- §12 calls placement_outcomes the asset, and §18 names it the most likely
-- single point of failure. Outcome data cannot be recreated: a candidate can
-- retake a test, a client can refill an intake, but nobody can go back and
-- re-observe whether a hire lasted three months. So every delete below REFUSES
-- when it would cascade into a placement, and says what to do instead.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Shared guard ───────────────────────────────────────────────────────────
create or replace function assert_no_placements(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_n int;
begin
  select count(*) into v_n from placements p
  where (p_kind = 'candidate'   and p.candidate_id = p_id)
     or (p_kind = 'requirement' and p.requirement_id = p_id)
     or (p_kind = 'client'      and p.requirement_id in
           (select id from requirements where client_id = p_id));

  if v_n > 0 then
    raise exception
      'Cannot delete: % placement(s) reference this, and their outcome data cannot be recreated. Archive it instead, or delete the placement first if it was recorded in error.', v_n;
  end if;
end $$;

-- ── CANDIDATES ─────────────────────────────────────────────────────────────
-- Deletion is also a compliance obligation (C3: withdrawal and deletion on
-- request), so it must exist regardless of convenience.

create or replace function rename_candidate(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_staff() then raise exception 'rename_candidate: staff only'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'A name is required.'; end if;
  update candidates set full_name = btrim(p_name) where id = p_id;
end $$;

create or replace function delete_candidate(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_name text; v_sessions int; v_matches int;
begin
  if not is_staff() then raise exception 'delete_candidate: staff only'; end if;
  select full_name into v_name from candidates where id = p_id;
  if v_name is null then raise exception 'No such candidate.'; end if;

  perform assert_no_placements('candidate', p_id);

  select count(*) into v_sessions from assessment_sessions where candidate_id = p_id;
  select count(*) into v_matches  from matches where candidate_id = p_id;

  -- Cascades by construction: every child table declares ON DELETE CASCADE, so
  -- this satisfies C3's "cascade delete by candidate_id" completely.
  delete from candidates where id = p_id;

  return jsonb_build_object('deleted', v_name, 'sessions', v_sessions, 'matches', v_matches);
end $$;

-- ── CLIENTS ────────────────────────────────────────────────────────────────
create or replace function rename_client(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_staff() then raise exception 'rename_client: staff only'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'A business name is required.'; end if;
  update clients set business_name = btrim(p_name) where id = p_id;
end $$;

create or replace function delete_client(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_name text; v_reqs int;
begin
  if not is_staff() then raise exception 'delete_client: staff only'; end if;
  select business_name into v_name from clients where id = p_id;
  if v_name is null then raise exception 'No such client.'; end if;

  perform assert_no_placements('client', p_id);
  select count(*) into v_reqs from requirements where client_id = p_id;

  delete from clients where id = p_id;
  return jsonb_build_object('deleted', v_name, 'requirements', v_reqs);
end $$;

-- ── REQUIREMENTS ───────────────────────────────────────────────────────────
-- Closing is the normal end of life; deletion is for one created in error.

create or replace function rename_requirement(p_id uuid, p_title text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_staff() then raise exception 'rename_requirement: staff only'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'A title is required.'; end if;
  update requirements set title = btrim(p_title) where id = p_id;
end $$;

create or replace function set_requirement_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_staff() then raise exception 'set_requirement_status: staff only'; end if;
  if p_status not in ('open', 'filled', 'closed') then
    raise exception 'Status must be open, filled or closed.';
  end if;
  update requirements set status = p_status where id = p_id;
end $$;

create or replace function delete_requirement(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_title text; v_matches int; v_ivs int;
begin
  if not is_staff() then raise exception 'delete_requirement: staff only'; end if;
  select title into v_title from requirements where id = p_id;
  if v_title is null then raise exception 'No such requirement.'; end if;

  perform assert_no_placements('requirement', p_id);
  select count(*) into v_matches from matches where requirement_id = p_id;
  select count(*) into v_ivs from interviews where requirement_id = p_id;

  -- Interview ratings are judgement that took an hour of a call to produce, so
  -- losing them silently would be worse than refusing.
  if v_ivs > 0 then
    raise exception
      'This requirement has % completed verification call(s). Close it instead — deleting would destroy the interview ratings.', v_ivs;
  end if;

  delete from requirements where id = p_id;
  return jsonb_build_object('deleted', v_title, 'matches', v_matches);
end $$;

-- ── KEYING ROUNDS ──────────────────────────────────────────────────────────
create or replace function rename_keying_round(p_id uuid, p_label text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_staff() then raise exception 'rename_keying_round: staff only'; end if;
  if btrim(coalesce(p_label, '')) = '' then raise exception 'A label is required.'; end if;
  update keying_rounds set label = btrim(p_label) where id = p_id;
end $$;

create or replace function set_keying_round_open(p_id uuid, p_open boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_staff() then raise exception 'set_keying_round_open: staff only'; end if;
  update keying_rounds set open = p_open where id = p_id;
end $$;

create or replace function delete_keying_round(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_label text; v_subs int; v_experts int;
begin
  if staff_role() <> 'admin' then raise exception 'delete_keying_round: admin only'; end if;
  select label into v_label from keying_rounds where id = p_id;
  if v_label is null then raise exception 'No such round.'; end if;

  select count(*), count(distinct expert_id) into v_subs, v_experts
  from keying_submissions where round_id = p_id;

  delete from keying_rounds where id = p_id;
  return jsonb_build_object('deleted', v_label, 'submissions', v_subs, 'experts', v_experts);
end $$;

-- Let an expert clear their own answer for one item without wiping the round.
create or replace function clear_keying(p_round uuid, p_item text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_staff uuid;
begin
  select id into v_staff from staff where auth_uid = auth.uid() and active;
  if v_staff is null then raise exception 'clear_keying: staff only'; end if;
  delete from keying_submissions
  where round_id = p_round and expert_id = v_staff and item_id = p_item;
end $$;

-- ── SUPPLEMENTS ────────────────────────────────────────────────────────────
create or replace function delete_supplement(p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_resp int;
begin
  if not is_staff() then raise exception 'delete_supplement: staff only'; end if;
  select count(*) into v_resp from supplement_responses r
  join supplements s on s.id = r.supplement_id where s.client_id = p_client_id;

  if v_resp > 0 then
    raise exception
      'This supplement has % candidate answer(s). Edit the questions instead — deleting would destroy their responses.', v_resp;
  end if;

  delete from supplements where client_id = p_client_id;
  return jsonb_build_object('deleted', true);
end $$;

grant execute on function rename_candidate(uuid, text)          to authenticated;
grant execute on function delete_candidate(uuid)                to authenticated;
grant execute on function rename_client(uuid, text)             to authenticated;
grant execute on function delete_client(uuid)                   to authenticated;
grant execute on function rename_requirement(uuid, text)        to authenticated;
grant execute on function set_requirement_status(uuid, text)    to authenticated;
grant execute on function delete_requirement(uuid)              to authenticated;
grant execute on function rename_keying_round(uuid, text)       to authenticated;
grant execute on function set_keying_round_open(uuid, boolean)  to authenticated;
grant execute on function delete_keying_round(uuid)             to authenticated;
grant execute on function clear_keying(uuid, text)              to authenticated;
grant execute on function delete_supplement(uuid)               to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- B. SUPPLEMENT SUGGESTION — templates, not generation
--
-- §10 says the supplement is written by the psych function at onboarding, and
-- that is still true: what follows produces a DRAFT for a human to edit, not a
-- finished artefact. The mechanism is the same one §9.5 uses for the match
-- rationale — "templates, not generated text: identical phrasing every time,
-- auditable, no model dependency, no drift."
--
-- Each template carries a CONDITION evaluated against the client's own intake.
-- A client selling ₹3L to business owners with no CRM gets a different draft
-- from one selling ₹18k inbound, because those are different jobs.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists supplement_templates (
  id        text primary key,
  kind      text not null check (kind in ('behavioural','technical')),
  condition text not null,          -- see resolve list in suggest_supplement()
  prompt    text not null,
  why       text not null,          -- shown to the recruiter, never to the candidate
  sort_order int not null default 100
);

alter table supplement_templates enable row level security;
alter table supplement_templates force row level security;
drop policy if exists supplement_templates_staff on supplement_templates;
create policy supplement_templates_staff on supplement_templates
  for select to authenticated using (is_staff());

delete from supplement_templates;
insert into supplement_templates (id, kind, condition, prompt, why, sort_order) values
-- Always relevant: the client's own offer and buyer.
('always_offer','behavioural','always',
 'In your own words, what would you say this company sells, and to whom?',
 'Whether they read the brief at all, and whether they can describe the offer without jargon.', 10),
('always_why','behavioural','always',
 'Why this company rather than any other sales role you are looking at?',
 'Motivation specific to this client, not a general desire for a job.', 20),
('always_objection','behavioural','always',
 'What is the objection you expect to hear most in this role, and what would you say to it?',
 'Compare against the objections the client actually reported. A mismatch is worth probing on the call.', 30),

-- High ticket / considered purchase.
('high_ticket_status','behavioural','ticket_high',
 'This buyer is often wealthier and running a bigger business than you. Describe a time you sold to someone like that and how you held your ground.',
 'Status-gap composure. §17 records this as partly lost when 12 dimensions became 8, so the supplement carries it.', 40),
('high_ticket_multi','technical','ticket_high',
 'The decision usually involves a second person who is never on the call. How do you get to them?',
 'Multi-stakeholder handling — the enterprise/procurement gap §17 leaves open.', 50),

-- Fast inbound.
('fast_volume','behavioural','ticket_low',
 'You have sixteen calls booked today and the eleventh is running long. What do you do?',
 'Whether they protect the day or sink into one call. Volume discipline, not closing skill.', 60),
('fast_sameday','technical','cycle_short',
 'A lead says "let me think about it" eight minutes into a ten-minute call. Give me your exact next sentence.',
 'A rehearsed deferral answer at speed. Most candidates have one for price and none for deferral.', 70),

-- No CRM.
('no_crm','technical','no_crm',
 'There is no CRM here and leads arrive on WhatsApp. What exactly would you have built by the end of week two?',
 'Corroborates process discipline in a second register. Contradiction with a high DSC score is worth logging.', 80),

-- Cold outbound heavy.
('cold_open','technical','cold_heavy',
 'Write the first two lines of a cold message you would send to this company''s buyer.',
 'Cold-open craft, which the 44-item test does not reach at all.', 90),

-- Refund policy / integrity exposure.
('refund','behavioural','refund_policy',
 'A prospect asks whether they can get their money back if it does not work. What do you tell them?',
 'Compare to what the client''s policy actually says and how it is honoured in practice.', 100),

-- Senior / owner buyer.
('senior_buyer','behavioural','senior_buyer',
 'The buyer says "send me a proposal and I will look at it." What do you do before the call ends?',
 'Whether a deferral gets named or accepted. Deferral is how most Indian high-ticket deals die.', 110),

-- Vertical, filled in by the recruiter.
('vertical_explain','technical','vertical',
 'Explain what this company does to someone who has never heard of the industry, in plain language.',
 'Whether they can hold a conversation with this buyer. Written per §3.6 — replace with something sharper for your vertical.', 120),
('vertical_trust','technical','vertical',
 'What is the one thing a buyer in this industry is most sceptical about, and how would you handle it?',
 'Domain-specific trust. Edit this to name the actual scepticism you hear.', 130);

-- Returns a DRAFT. The recruiter edits and saves it; nothing is auto-applied.
create or replace function suggest_supplement(p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_p jsonb; v_conds text[] := array['always'];
begin
  if not is_staff() then raise exception 'suggest_supplement: staff only'; end if;

  select payload into v_p from client_intake
  where client_id = p_client_id and is_complete
  order by submitted_at desc limit 1;

  if v_p is null then
    return jsonb_build_object('ok', false,
      'reason', 'This client has not submitted an intake yet, so there is nothing to base a draft on.');
  end if;

  -- Conditions read straight off the intake. Same inputs, same draft, every time.
  if (v_p->>'ticket_size')::numeric >= 150000 then v_conds := v_conds || 'ticket_high'; end if;
  if (v_p->>'ticket_size')::numeric <  50000  then v_conds := v_conds || 'ticket_low';  end if;
  if coalesce((v_p->>'cycle_days')::numeric, 30) <= 7 then v_conds := v_conds || 'cycle_short'; end if;
  if coalesce((v_p->>'has_crm')::boolean, true) = false then v_conds := v_conds || 'no_crm'; end if;
  if coalesce((v_p->>'cold_outbound_pct')::numeric, 0) > 50 then v_conds := v_conds || 'cold_heavy'; end if;
  if coalesce((v_p->>'refund_policy_exists')::boolean, false) then v_conds := v_conds || 'refund_policy'; end if;
  if coalesce((v_p->>'buyer_is_senior')::boolean, false) then v_conds := v_conds || 'senior_buyer'; end if;
  v_conds := v_conds || 'vertical';

  return jsonb_build_object(
    'ok', true,
    'because', jsonb_build_object(
      'ticket_size', v_p->>'ticket_size',
      'cycle_days', v_p->>'cycle_days',
      'has_crm', v_p->>'has_crm',
      'cold_outbound_pct', v_p->>'cold_outbound_pct',
      'refund_policy_exists', v_p->>'refund_policy_exists',
      'buyer_is_senior', v_p->>'buyer_is_senior'),
    'conditions', to_jsonb(v_conds),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', t.kind, 'prompt', t.prompt, 'why', t.why) order by t.sort_order), '[]'::jsonb)
      from supplement_templates t where t.condition = any(v_conds))
  );
end $$;

grant execute on function suggest_supplement(uuid) to authenticated;
grant select on supplement_templates to authenticated;

do $$
declare v_n int;
begin
  select count(*) into v_n from supplement_templates;
  -- §10 caps a supplement at 5-8 behavioural plus 3-5 technical. The library may
  -- exceed that; any single draft must not, which is checked in the console.
  raise notice 'Supplement template library: % items.', v_n;
end $$;
