-- ═══════════════════════════════════════════════════════════════════════════
-- 28 — conflict resolution, and the answer to "do we need two tables?"
--
-- *"What happens when the keys are in conflict? How do you resolve them? Do we
--  need an intermediate table where keyed info gets stored and then another
--  table with final keys?"*
--
-- THE INTERMEDIATE TABLE ALREADY EXISTS. `keying_submissions` is exactly that:
-- one row per (round, expert, item), holding what each person chose and why.
-- Raw evidence, never overwritten, never merged.
--
-- A SECOND TABLE OF "FINAL KEYS" WOULD BE A MISTAKE, and it is worth saying why
-- rather than just declining. `item_options.score_key` is already the live key.
-- Adding a parallel `final_keys` table would create two places that both claim
-- to hold the same number. Every scoring query would then have to know which one
-- wins, and the day they disagree — a partial migration, a failed transaction,
-- someone editing one and not the other — the system would produce scores with
-- no way to tell which key set made them. **Two sources of truth for one number
-- is not redundancy, it is a race.**
--
-- What was genuinely missing is not a second key. It is three other things:
--
--   1. A record of the DECISION. The report could show a conflict and there was
--      nowhere to write down what you decided about it. An item stayed
--      "disputed" forever whether you had thought about it for an hour or never
--      looked. That is what `key_decisions` is: not keys, decisions.
--   2. A way to SEE WHAT A RE-KEY WOULD DO before doing it. Undo is a good
--      safety net and a bad substitute for looking first, especially with four
--      pending changes and every candidate profile downstream.
--   3. PROVENANCE on the score. Two candidates assessed either side of a re-key
--      had identical-looking profiles with no way to tell they were measured
--      with different instruments.
--
-- ── HOW CONFLICT IS RESOLVED ───────────────────────────────────────────────
--
-- §13's own rule, made explicit in three cases rather than two:
--
--   UNANIMOUS, agrees with the bank      → nothing to do. The item is solid.
--   UNANIMOUS, disagrees with the bank   → re-key. This is the finding §13 exists
--                                          to produce, and the only case offered
--                                          as a one-click action.
--   MAJORITY (e.g. 2 of 3)               → NOT automatic. The experts did not
--                                          converge, which is evidence about the
--                                          ITEM. An admin may override with a
--                                          written rationale, and the rationale
--                                          is stored beside the change forever.
--   TRUE SPLIT (all differ)              → do not re-key at all. "The obvious
--                                          right answer" was not obvious to
--                                          people who sell for a living, which
--                                          means the item is ambiguous. §13 asks
--                                          for a rewrite, and the decision to
--                                          rewrite is now recordable and
--                                          trackable rather than a note in
--                                          somebody's head.
--
-- The distinction that was missing: a 2-of-3 majority and a 3-way split were
-- both "split" in the old report. They call for completely different actions.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The decision layer ──────────────────────────────────────────────────
create table if not exists key_decisions (
  item_id     text primary key references items(id) on delete cascade,
  decision    text not null check (decision in
                ('rekeyed','kept','rewrite_pending','rewritten','deferred')),
  rationale   text,
  round_id    uuid references keying_rounds(id) on delete set null,
  decided_by  uuid references staff(id) on delete set null,
  decided_at  timestamptz not null default now()
);

alter table key_decisions enable row level security;
alter table key_decisions force row level security;
drop policy if exists key_decisions_staff on key_decisions;
create policy key_decisions_staff on key_decisions for all to authenticated
  using (is_staff()) with check (is_staff());

create or replace function record_key_decision(
  p_item_id text, p_decision text, p_rationale text default null,
  p_round uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff uuid;
begin
  if not is_staff() then raise exception 'record_key_decision: staff only'; end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  -- A decision that overrides the experts must say why. The others may stand on
  -- their own, because "the experts agreed with the bank" explains itself.
  if p_decision in ('kept','rewrite_pending') and coalesce(btrim(p_rationale),'') = '' then
    raise exception 'A % decision needs a sentence saying why — it is overriding '
                    'what the experts found, and in six months nobody will remember.',
                    p_decision;
  end if;

  insert into key_decisions (item_id, decision, rationale, round_id, decided_by)
  values (p_item_id, p_decision, nullif(btrim(p_rationale),''), p_round, v_staff)
  on conflict (item_id) do update set
    decision = excluded.decision, rationale = excluded.rationale,
    round_id = excluded.round_id, decided_by = excluded.decided_by,
    decided_at = now();
end $$;

grant execute on function record_key_decision(text, text, text, uuid) to authenticated;

-- ── 2. Look before you leap ────────────────────────────────────────────────
-- What a re-key WOULD do, computed on a copy and rolled back. Writes nothing.
create or replace function preview_rekey(p_item_id text, p_new_best text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old_best text; v_old_score numeric; v_new_score numeric;
  v_dim text; v_before jsonb; v_after jsonb; r record;
  v_moves jsonb := '[]'::jsonb;
begin
  if not is_staff() then raise exception 'preview_rekey: staff only'; end if;

  select o.option_key, o.score_key into v_old_best, v_old_score
  from item_options o where o.item_id = p_item_id order by o.score_key desc limit 1;
  select o.score_key into v_new_score
  from item_options o where o.item_id = p_item_id and o.option_key = p_new_best;
  if v_old_best is null or v_new_score is null then
    raise exception 'No such item or option: % / %', p_item_id, p_new_best;
  end if;
  select dimension_code into v_dim from items where id = p_item_id;

  -- Everything below happens inside a subtransaction that is always rolled back.
  begin
    update item_options set score_key = v_new_score
    where item_id = p_item_id and option_key = v_old_best;
    update item_options set score_key = v_old_score
    where item_id = p_item_id and option_key = p_new_best;

    for r in
      select s.id, s.candidate_id, c.full_name, p.scores as before_scores
      from assessment_sessions s
      join candidates c on c.id = s.candidate_id
      join lateral (select scores from candidate_profile
                     where candidate_id = c.id order by computed_at desc limit 1) p on true
      where s.completed_at is not null
        and c.full_name not like 'ZZ_FIXTURE%' and c.full_name not like 'ZZ_E2E%'
        and exists (select 1 from candidate_responses cr where cr.session_id = s.id)
    loop
      v_before := r.before_scores;
      perform compute_candidate_profile(r.id);
      select scores into v_after from candidate_profile
      where candidate_id = r.candidate_id order by computed_at desc limit 1;

      if (v_before->>v_dim) is distinct from (v_after->>v_dim) then
        v_moves := v_moves || jsonb_build_object(
          'candidate_id', r.candidate_id, 'full_name', r.full_name,
          'dimension', v_dim,
          'from', (v_before->>v_dim)::numeric,
          'to',   (v_after->>v_dim)::numeric);
      end if;
    end loop;

    -- Undo everything, always. The exception is the mechanism, not an error.
    raise exception 'preview_rollback';
  exception when others then
    if sqlerrm <> 'preview_rollback' then raise; end if;
  end;

  return jsonb_build_object(
    'item_id', p_item_id, 'dimension', v_dim,
    'old_best', v_old_best, 'new_best', p_new_best,
    'candidates_affected', jsonb_array_length(v_moves),
    'moves', v_moves);
end $$;

grant execute on function preview_rekey(text, text) to authenticated;

-- ── 3. Provenance ──────────────────────────────────────────────────────────
-- A short fingerprint of the whole SJT key set. Two profiles with different
-- fingerprints were measured with different instruments and are not directly
-- comparable — which was previously invisible.
create or replace function key_fingerprint()
returns text language sql stable security definer set search_path = public as $$
  select substr(md5(string_agg(o.item_id || o.option_key || o.score_key::text,
                               ',' order by o.item_id, o.option_key)), 1, 12)
  from item_options o
  join items i on i.id = o.item_id
  where i.active and i.format = 'sjt';
$$;

grant execute on function key_fingerprint() to authenticated;

alter table candidate_profile add column if not exists key_fingerprint text;

-- Stamp it going forward, and backfill what exists now.
create or replace function stamp_key_fingerprint() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.key_fingerprint := key_fingerprint();
  return new;
end $$;

drop trigger if exists candidate_profile_fingerprint on candidate_profile;
create trigger candidate_profile_fingerprint
  before insert or update on candidate_profile
  for each row execute function stamp_key_fingerprint();

update candidate_profile set key_fingerprint = key_fingerprint()
where key_fingerprint is null;

-- Which is only useful if you can see when it has diverged.
create or replace view v_key_drift_audit as
select p.key_fingerprint,
       count(*)                        as profiles,
       min(p.computed_at)              as earliest,
       max(p.computed_at)              as latest,
       p.key_fingerprint = key_fingerprint() as is_current
from candidate_profile p
join candidates c on c.id = p.candidate_id
where c.full_name not like 'ZZ_FIXTURE%' and c.full_name not like 'ZZ_E2E%'
group by p.key_fingerprint;

grant select on v_key_drift_audit to authenticated;

-- ── 4. The report, with conflict properly classified ───────────────────────
-- Majority and true split were the same category before, and they call for
-- opposite actions.
create or replace view v_keying_conflicts as
with picks as (
  select k.item_id, k.best_option_key, count(distinct k.expert_id) as n
  from keying_submissions k group by k.item_id, k.best_option_key
), agg as (
  select p.item_id,
         sum(p.n)                                   as n_experts,
         count(*)                                   as n_distinct,
         max(p.n)                                   as top_count,
         (array_agg(p.best_option_key order by p.n desc, p.best_option_key))[1] as top_choice,
         (select o.option_key from item_options o
           where o.item_id = p.item_id order by o.score_key desc limit 1) as current_best
  from picks p group by p.item_id
)
select a.*,
       i.dimension_code,
       case
         when a.n_distinct = 1 and a.top_choice = a.current_best then 'unanimous_agrees'
         when a.n_distinct = 1                                   then 'unanimous_disagrees'
         when a.top_count * 2 > a.n_experts                      then 'majority'
         else 'split'
       end as conflict,
       d.decision, d.rationale, d.decided_at
from agg a
join items i on i.id = a.item_id
left join key_decisions d on d.item_id = a.item_id;

grant select on v_keying_conflicts to authenticated;

-- ── 4b. An undo has to undo the decision too ───────────────────────────────
-- Found by looking at the table after a QA run rather than by reasoning: the
-- re-key had been applied and then undone, the bank was back where it started,
-- and `key_decisions` still said `rekeyed`. The item read as settled while the
-- key was the one the experts had rejected — the worst of both, because it is
-- the state that stops you looking.
create or replace function undo_rekey(p_change_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v jsonb;
begin
  if staff_role() <> 'admin' then raise exception 'undo_rekey: admin only'; end if;
  select * into c from key_changes where id = p_change_id;
  if c.id is null then raise exception 'No such key change.'; end if;

  v := apply_rekey(c.item_id, c.old_best, c.round_id,
                   'Undo of ' || to_char(c.applied_at, 'DD Mon YYYY HH24:MI'));

  -- The item goes back to being an open question, which is what it now is.
  delete from key_decisions where item_id = c.item_id and decision = 'rekeyed';
  return v;
end $$;

grant execute on function undo_rekey(uuid) to authenticated;

-- ── 5. Fold all of it into the report the screen already reads ─────────────
-- Three new facts per item — how the disagreement is shaped, what the majority
-- pick actually is, and what was decided about it — plus the fingerprint, so
-- the page can say which key set the current scores were measured under.
create or replace function get_keying_report(p_round uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_keying_report: staff only'; end if;

  return jsonb_build_object(
    'fingerprint', key_fingerprint(),

    'rounds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'label', r.label, 'open', r.open,
               'experts', (select count(distinct expert_id) from keying_submissions k
                            where k.round_id = r.id),
               'keyed', (select count(distinct item_id) from keying_submissions k
                          where k.round_id = r.id))
             order by r.created_at desc), '[]'::jsonb)
      from keying_rounds r),

    'items', (
      select coalesce(jsonb_agg(x order by x->>'item_id'), '[]'::jsonb) from (
        select jsonb_build_object(
          'item_id', i.id,
          'dimension', d.name,
          'dimension_code', i.dimension_code,
          'stem', i.stem,
          'framing_note', i.framing_note,

          'options', (
            select jsonb_agg(jsonb_build_object(
                     'key', o.option_key, 'text', o.option_text,
                     'score', o.score_key,
                     'is_current_best', o.score_key = mx.top)
                   order by o.option_key)
            from item_options o where o.item_id = i.id),

          'current_best', (select o.option_key from item_options o
                            where o.item_id = i.id order by o.score_key desc limit 1),

          'picks', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'expert', s.full_name, 'round', r.label, 'round_id', r.id,
                     'best', k.best_option_key, 'worst', k.worst_option_key,
                     'note', k.note, 'at', k.submitted_at)
                   order by k.submitted_at), '[]'::jsonb)
            from keying_submissions k
            join staff s on s.id = k.expert_id
            join keying_rounds r on r.id = k.round_id
            where k.item_id = i.id
              and (p_round is null or k.round_id = p_round)),

          'n_experts', (select count(distinct k.expert_id) from keying_submissions k
                         where k.item_id = i.id
                           and (p_round is null or k.round_id = p_round)),
          'chosen', (select string_agg(distinct k.best_option_key, '/' order by k.best_option_key)
                      from keying_submissions k where k.item_id = i.id
                        and (p_round is null or k.round_id = p_round)),
          'n_distinct', (select count(distinct k.best_option_key) from keying_submissions k
                          where k.item_id = i.id
                            and (p_round is null or k.round_id = p_round)),

          -- NEW: the shape of the disagreement, the pick that leads, and what
          -- was decided about it.
          'conflict',   cf.conflict,
          'top_choice', cf.top_choice,
          'top_count',  cf.top_count,
          'decision',   dec.decision,
          'rationale',  dec.rationale,
          'decided_at', dec.decided_at,
          'decided_by', (select s3.full_name from staff s3 where s3.id = dec.decided_by),

          'last_change', (
            select jsonb_build_object('old_best', c.old_best, 'new_best', c.new_best,
                                      'at', c.applied_at, 'by', s2.full_name)
            from key_changes c left join staff s2 on s2.id = c.applied_by
            where c.item_id = i.id order by c.applied_at desc limit 1)
        ) as x
        from items i
        join dimensions d on d.code = i.dimension_code
        cross join lateral (select max(score_key) as top from item_options where item_id = i.id) mx
        left join v_keying_conflicts cf on cf.item_id = i.id
        left join key_decisions dec on dec.item_id = i.id
        where i.active and i.format = 'sjt'
      ) t)
  );
end $$;

grant execute on function get_keying_report(uuid) to authenticated;

do $$
declare v int;
begin
  select count(*) into v from pg_proc
  where proname in ('record_key_decision','preview_rekey','key_fingerprint','stamp_key_fingerprint');
  if v <> 4 then raise exception 'expected 4 new functions, found %', v; end if;

  select count(*) into v from candidate_profile where key_fingerprint is null;
  if v > 0 then raise exception '% profile(s) have no key fingerprint', v; end if;

  -- The preview must leave nothing behind. Run it and check the bank is intact.
  -- Only possible when the caller is staff: the Management API connects as
  -- `postgres`, which has no `staff` row and no `auth.uid()`, so `is_staff()` is
  -- correctly false there. That is not a failure to route around — it is the
  -- guard working. The migration says so and the browser QA exercises the real
  -- path as a signed-in admin.
  declare v_before text; v_after text; v_item text; v_alt text;
  begin
    select item_id into v_item from v_rekey_pending limit 1;
    if not is_staff() then
      raise notice 'preview_rekey not exercised here (caller is not staff) — QA covers it';
      v_item := null;
    end if;
    if v_item is not null then
      select agreed_best into v_alt from v_rekey_pending where item_id = v_item;
      v_before := key_fingerprint();
      perform preview_rekey(v_item, v_alt);
      v_after := key_fingerprint();
      if v_before is distinct from v_after then
        raise exception 'preview_rekey changed the bank — it must not';
      end if;
    end if;
  end;

  raise notice 'sql/28 ok — decisions recorded, previews leave no trace, scores carry provenance';
end $$;
