-- ═══════════════════════════════════════════════════════════════════════════
-- 24 — the keyed answers, and the thing they were supposed to do
--
-- *"I cannot see the keyed scores. And what do the keyed scores do? I don't see
--  them going anywhere."*
--
-- Correct on both counts, and the second one is the real defect.
--
-- WHAT WAS THERE. `keying_submissions` recorded every expert's pick.
-- `v_keying_agreement` counted how many items were split or unanimous. And then
-- nothing. **No code path anywhere writes `item_options.score_key` after the
-- bank is seeded.** Three experts could spend half a day each agreeing that an
-- item is keyed wrong, and the bank would keep the wrong key forever. §13 exists
-- to turn one person's opinion into a finding; a finding that cannot be applied
-- is a survey.
--
-- On the live project right now: two experts have keyed all 28 items and on
-- CCH-01 both chose `b` while the bank keys `a`. That is exactly the case §13
-- was written to catch, sitting in the database doing nothing.
--
-- WHAT THIS ADDS.
--
--   1. `get_keying_report()` — the whole picture per item: the stem, all four
--      options with their current scores, what each expert chose, their note,
--      and the verdict. Previously you could see a count and not the answers.
--   2. `apply_rekey()` — moves the +2 to the option the experts chose, by
--      SWAPPING score_key values with the old top option. That preserves the
--      −1/0/+1/+2 distribution the whole scoring model assumes; setting a new
--      value would quietly change the item's range.
--   3. `key_changes` — every re-key recorded: what moved, who applied it, on
--      which round's evidence, and how many profiles were recomputed.
--   4. The recompute. **This is the part that makes it honest.** A score
--      computed under the old key does not mean the same thing under the new
--      one. So applying a re-key recomputes every completed candidate profile
--      and re-runs every open requirement's matches, in the same transaction.
--      A re-key that leaves stale profiles behind is worse than no re-key: it
--      makes two candidates assessed a week apart incomparable, silently.
--
-- WHY IT IS ADMIN-ONLY AND DELIBERATELY EFFORTFUL. Re-keying moves the ground
-- under every score in the system. It is the single most consequential button
-- in this tool, so it names its consequence, records who pressed it, and can be
-- read back afterwards.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists key_changes (
  id           uuid primary key default gen_random_uuid(),
  item_id      text not null references items(id) on delete cascade,
  old_best     text not null,
  new_best     text not null,
  round_id     uuid references keying_rounds(id) on delete set null,
  -- ON DELETE SET NULL, not cascade and not restrict: an audit record must
  -- outlive the person who made it. People leave; what they changed about the
  -- item bank is permanent history, and deleting a staff row must not be able
  -- to erase it or be blocked by it.
  applied_by   uuid references staff(id) on delete set null,
  applied_at   timestamptz not null default now(),
  n_experts    int,
  note         text,
  profiles_recomputed int,
  matches_recomputed  int
);

-- Repair the constraint on a database where this table already exists.
do $$
begin
  alter table key_changes drop constraint if exists key_changes_applied_by_fkey;
  alter table key_changes add constraint key_changes_applied_by_fkey
    foreign key (applied_by) references staff(id) on delete set null;
end $$;

alter table key_changes enable row level security;
alter table key_changes force row level security;
drop policy if exists key_changes_staff on key_changes;
create policy key_changes_staff on key_changes for all to authenticated
  using (is_staff()) with check (is_staff());

-- ═══ SEEING IT ═════════════════════════════════════════════════════════════

-- Everything about one item's keying, in one object. Staff only — this is the
-- answer key, so it is the one payload a keyer must never receive.
create or replace function get_keying_report(p_round uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_keying_report: staff only'; end if;

  return jsonb_build_object(
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

          -- All four options with what the bank currently scores them.
          'options', (
            select jsonb_agg(jsonb_build_object(
                     'key', o.option_key, 'text', o.option_text,
                     'score', o.score_key,
                     'is_current_best', o.score_key = mx.top)
                   order by o.option_key)
            from item_options o where o.item_id = i.id),

          'current_best', (select o.option_key from item_options o
                            where o.item_id = i.id order by o.score_key desc limit 1),

          -- Who picked what, and why, if they said.
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
          'last_change', (
            select jsonb_build_object('old_best', c.old_best, 'new_best', c.new_best,
                                      'at', c.applied_at, 'by', s2.full_name)
            from key_changes c left join staff s2 on s2.id = c.applied_by
            where c.item_id = i.id order by c.applied_at desc limit 1)
        ) as x
        from items i
        join dimensions d on d.code = i.dimension_code
        cross join lateral (select max(score_key) as top from item_options where item_id = i.id) mx
        where i.active and i.format = 'sjt'
      ) t)
  );
end $$;

grant execute on function get_keying_report(uuid) to authenticated;

-- The actionable list: items where every expert who keyed it agreed, and
-- disagreed with the bank. This is the only case where a re-key is defensible
-- without a conversation — a split needs the item rewritten, not re-keyed (§13).
create or replace view v_rekey_pending as
select k.item_id,
       i.dimension_code,
       count(distinct k.expert_id)                       as n_experts,
       min(k.best_option_key)                            as agreed_best,
       (select o.option_key from item_options o
         where o.item_id = k.item_id order by o.score_key desc limit 1) as current_best
from keying_submissions k
join items i on i.id = k.item_id
group by k.item_id, i.dimension_code
having count(distinct k.best_option_key) = 1
   and min(k.best_option_key) <> (select o.option_key from item_options o
                                   where o.item_id = k.item_id order by o.score_key desc limit 1);

grant select on v_rekey_pending to authenticated;
alter view v_rekey_pending set (security_invoker = true);

-- ═══ APPLYING IT ═══════════════════════════════════════════════════════════

create or replace function apply_rekey(p_item_id text, p_new_best text,
                                       p_round uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid; v_old_best text; v_old_score numeric; v_new_score numeric;
  v_n_experts int; v_profiles int := 0; v_matches int := 0; r record;
begin
  if staff_role() <> 'admin' then raise exception 'apply_rekey: admin only'; end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  select o.option_key, o.score_key into v_old_best, v_old_score
  from item_options o where o.item_id = p_item_id order by o.score_key desc limit 1;
  if v_old_best is null then raise exception 'No such item: %', p_item_id; end if;

  select o.score_key into v_new_score
  from item_options o where o.item_id = p_item_id and o.option_key = p_new_best;
  if v_new_score is null then
    raise exception 'Option % is not on item %', p_new_best, p_item_id;
  end if;

  if v_old_best = p_new_best then
    return jsonb_build_object('changed', false,
      'reason', 'The bank already keys ' || p_new_best || ' as the best answer.');
  end if;

  select count(distinct expert_id) into v_n_experts
  from keying_submissions where item_id = p_item_id and best_option_key = p_new_best;

  -- SWAP, do not overwrite. The −1/0/+1/+2 spread is what every downstream
  -- calculation assumes; assigning a new number to one option would silently
  -- change this item's range and make it weigh differently from its 27 peers.
  update item_options set score_key = v_new_score
  where item_id = p_item_id and option_key = v_old_best;
  update item_options set score_key = v_old_score
  where item_id = p_item_id and option_key = p_new_best;

  -- Every score in the system was computed under the old key. Leaving them is
  -- not an option: two candidates assessed either side of this change would be
  -- silently incomparable.
  for r in select id from assessment_sessions where completed_at is not null loop
    begin
      perform compute_candidate_profile(r.id);
      v_profiles := v_profiles + 1;
    exception when others then
      raise warning 'apply_rekey: could not recompute session % — %', r.id, sqlerrm;
    end;
  end loop;

  for r in
    select req.id from requirements req
    join clients cl on cl.id = req.client_id
    where req.status = 'open' and req.target_profile_id is not null
      and cl.business_name not like 'ZZ_FIXTURE%'
  loop
    begin
      perform compute_matches(r.id);
      v_matches := v_matches + 1;
    exception when others then
      raise warning 'apply_rekey: could not rematch requirement % — %', r.id, sqlerrm;
    end;
  end loop;

  insert into key_changes (item_id, old_best, new_best, round_id, applied_by,
                           n_experts, note, profiles_recomputed, matches_recomputed)
  values (p_item_id, v_old_best, p_new_best, p_round, v_staff,
          v_n_experts, p_note, v_profiles, v_matches);

  return jsonb_build_object('changed', true, 'item_id', p_item_id,
                            'old_best', v_old_best, 'new_best', p_new_best,
                            'profiles_recomputed', v_profiles,
                            'matches_recomputed', v_matches);
end $$;

grant execute on function apply_rekey(text, text, uuid, text) to authenticated;

-- Undo, because a re-key applied on thin evidence should be reversible without
-- hand-editing the bank. Same swap in reverse, same recompute, same record.
create or replace function undo_rekey(p_change_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v jsonb;
begin
  if staff_role() <> 'admin' then raise exception 'undo_rekey: admin only'; end if;
  select * into c from key_changes where id = p_change_id;
  if c.id is null then raise exception 'No such key change.'; end if;

  v := apply_rekey(c.item_id, c.old_best, c.round_id,
                   'Undo of ' || to_char(c.applied_at, 'DD Mon YYYY HH24:MI'));
  return v;
end $$;

grant execute on function undo_rekey(uuid) to authenticated;

do $$
declare v int;
begin
  select count(*) into v from pg_proc
  where proname in ('get_keying_report','apply_rekey','undo_rekey');
  if v <> 3 then raise exception 'expected 3 keying-report functions, found %', v; end if;

  -- The report is the answer key. It must never be reachable without a session.
  begin
    perform get_keying_report(null);
    raise exception 'get_keying_report returned the answer key with no signed-in user';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%staff only%' then raise; end if;
  end;

  select count(*) into v from v_rekey_pending;
  raise notice 'sql/24 ok — % item(s) where the experts agree and the bank disagrees', v;
end $$;
