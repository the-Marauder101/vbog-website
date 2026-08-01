-- ═══════════════════════════════════════════════════════════════════════════
-- 17 — KEYING BY LINK
--
-- §13 wants THREE experts to key all 28 SJT items blind. The whole point is
-- independence, and the most independent keyers are the ones who do not work
-- here — an outside sales psychologist, a closer from another firm, someone
-- whose judgement is not already shaped by ours.
--
-- Until now keying required a Supabase account plus a `staff` row, which means
-- handing an outsider a login to the tool that renders every score in the
-- system. That is a bad trade for a half-day of work. So keying now follows the
-- pattern the other three external surfaces already use: a token in a URL, no
-- account, no table access, nothing reachable but the items.
--
--   keying.html?t=<token>
--
-- FOUR THINGS THIS MUST NOT BREAK, and how each is held:
--
--   1. BLINDNESS. `get_keying_by_token()` does not select `score_key`, exactly
--      as `get_keying_items()` does not. A keyer who can see the current key is
--      not an independent keyer, and the projection is where that is decided —
--      not the UI.
--   2. NOTHING ELSE IS REACHABLE. `anon` still has no table access anywhere.
--      The three token RPCs are SECURITY DEFINER and touch only items, options
--      and this keyer's own submissions.
--   3. THE LINK IS NOT AN ACCOUNT. Each keyer gets a `staff` row so their keys
--      can be attributed and `v_keying_agreement` keeps working unchanged — but
--      with `auth_uid = null`, `active = false` and `role = 'keyer'`. `is_staff()`
--      requires `auth_uid = auth.uid() AND active`, so such a row grants exactly
--      nothing. It is a name to attribute keys to, not a way in. If that email
--      ever signs up for real, it links and is STILL inactive.
--   4. ONE LINK, ONE KEYER. The token identifies the person. Two experts
--      sharing a link would silently overwrite each other, because
--      `keying_submissions` is keyed on (round, expert, item) — so a link is
--      minted per named keyer and the page shows whose it is, in the open,
--      before they answer anything.
-- ═══════════════════════════════════════════════════════════════════════════

-- A keyer is a name, not an account. Extending the role check rather than
-- inventing a parallel table keeps v_keying_agreement, delete_keying_round()
-- and the agreement report working with no changes at all.
do $$
begin
  alter table staff drop constraint if exists staff_role_check;
  alter table staff add constraint staff_role_check
    check (role in ('admin','recruiter','psych','keyer'));
end $$;

create table if not exists keying_tokens (
  token       text primary key,
  round_id    uuid not null references keying_rounds(id) on delete cascade,
  expert_id   uuid not null references staff(id) on delete cascade,
  issued_at   timestamptz default now(),
  expires_at  timestamptz not null,
  last_seen_at timestamptz,
  revoked_at  timestamptz,
  unique (round_id, expert_id)          -- one live link per keyer per round
);

alter table keying_tokens enable row level security;
alter table keying_tokens force row level security;
drop policy if exists keying_tokens_staff on keying_tokens;
create policy keying_tokens_staff on keying_tokens for all to authenticated
  using (is_staff()) with check (is_staff());

-- ═══ STAFF SIDE ════════════════════════════════════════════════════════════

-- Admin only, like create_keying_round(): who gets to key is an admin decision.
create or replace function create_keying_link(
  p_round uuid, p_name text, p_email text, p_valid_days int default 21)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_expert uuid; v_token text; v_email text := lower(btrim(p_email));
begin
  if staff_role() <> 'admin' then raise exception 'create_keying_link: admin only'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'A name is required — the keys are attributed to it.'; end if;
  if v_email = '' or v_email not like '%_@_%' then raise exception 'A valid email is required.'; end if;
  if not exists (select 1 from keying_rounds where id = p_round) then
    raise exception 'No such keying round.';
  end if;

  select id into v_expert from staff where lower(email) = v_email;
  if v_expert is null then
    -- auth_uid null + active false: is_staff() can never be true for this row.
    insert into staff (email, full_name, role, active)
    values (v_email, btrim(p_name), 'keyer', false)
    returning id into v_expert;
  else
    update staff set full_name = coalesce(nullif(btrim(p_name), ''), full_name)
    where id = v_expert;
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into keying_tokens (token, round_id, expert_id, expires_at)
  values (v_token, p_round, v_expert, now() + make_interval(days => p_valid_days))
  on conflict (round_id, expert_id) do update set
    token = excluded.token, issued_at = now(),
    expires_at = excluded.expires_at, revoked_at = null;

  return jsonb_build_object('token', v_token, 'expert_id', v_expert,
                            'name', btrim(p_name), 'email', v_email);
end $$;

create or replace function revoke_keying_link(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if staff_role() <> 'admin' then raise exception 'revoke_keying_link: admin only'; end if;
  update keying_tokens set revoked_at = now() where token = p_token;
end $$;

-- What the console shows: who has a link, whether they have started, how far
-- they got. Progress is the number that matters — §13 stalls when one of the
-- three never finishes, and that is invisible unless it is on screen.
create or replace view v_keying_links as
select t.token, t.round_id, r.label as round_label, r.open as round_open,
       s.id as expert_id, s.full_name, s.email,
       t.issued_at, t.expires_at, t.last_seen_at, t.revoked_at,
       (t.revoked_at is not null)                                as revoked,
       (t.expires_at < now())                                    as expired,
       (select count(*) from keying_submissions k
         where k.round_id = t.round_id and k.expert_id = t.expert_id) as keyed,
       (select count(*) from items i where i.active and i.format = 'sjt') as total
from keying_tokens t
join keying_rounds r on r.id = t.round_id
join staff s on s.id = t.expert_id;

grant select on v_keying_links to authenticated;
grant execute on function create_keying_link(uuid, text, text, int) to authenticated;
grant execute on function revoke_keying_link(text)                  to authenticated;

-- ═══ KEYER SIDE — three RPCs, no account, no table access ══════════════════

-- Resolves a token to (round, expert) or raises with a sentence a human can act
-- on. Every token RPC goes through this, so there is one place the rules live.
-- A named composite type rather than `record`, because plpgsql cannot assign a
-- bare record-returning call to a variable without a column definition list.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'keying_ctx') then
    create type keying_ctx as (
      round_id uuid, expert_id uuid, round_open boolean, label text, full_name text);
  end if;
end $$;

create or replace function keying_token_expert(p_token text, p_need_open boolean)
returns keying_ctx language plpgsql security definer set search_path = public as $$
declare
  v_round uuid; v_expert uuid; v_open boolean; v_label text; v_name text;
  v_revoked timestamptz; v_expires timestamptz;
begin
  select t.round_id, t.expert_id, k.open, k.label, s.full_name, t.revoked_at, t.expires_at
    into v_round, v_expert, v_open, v_label, v_name, v_revoked, v_expires
  from keying_tokens t
  join keying_rounds k on k.id = t.round_id
  join staff s on s.id = t.expert_id
  where t.token = p_token;

  if not found then
    raise exception 'This keying link is not valid. Ask for a new one.';
  end if;
  if v_revoked is not null then
    raise exception 'This keying link has been withdrawn. Ask for a new one.';
  end if;
  if v_expires < now() then
    raise exception 'This keying link expired on %. Ask for a new one.',
      to_char(v_expires, 'DD Mon YYYY');
  end if;
  if p_need_open and not v_open then
    raise exception 'This keying round is closed. Nothing you sent is lost.';
  end if;
  return (v_round, v_expert, v_open, v_label, v_name)::keying_ctx;
end $$;

-- The same payload get_keying_items() returns, and the same deliberate
-- omission: score_key is not selected. Blindness is a property of the
-- projection, not of the page.
create or replace function get_keying_by_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r keying_ctx;
begin
  r := keying_token_expert(p_token, false);
  update keying_tokens set last_seen_at = now() where token = p_token;

  return jsonb_build_object(
    'round', r.label,
    'round_open', r.round_open,
    'expert_id', r.expert_id,
    'expert_name', r.full_name,
    'items', (
      select coalesce(jsonb_agg(x order by (x->>'sort_order')::int), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', i.id, 'stem', i.stem, 'framing_note', i.framing_note,
          'sort_order', i.sort_order,
          -- score_key is deliberately absent from this projection.
          'options', (select jsonb_agg(jsonb_build_object('key', o.option_key, 'text', o.option_text)
                                       order by o.option_key)
                      from item_options o where o.item_id = i.id),
          'mine', (select jsonb_build_object('best', k.best_option_key, 'worst', k.worst_option_key,
                                             'note', k.note)
                   from keying_submissions k
                   where k.round_id = r.round_id and k.expert_id = r.expert_id and k.item_id = i.id)
        ) as x
        from items i where i.active and i.format = 'sjt'
      ) t)
  );
end $$;

create or replace function save_keying_by_token(
  p_token text, p_item text, p_best text,
  p_worst text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r keying_ctx;
begin
  r := keying_token_expert(p_token, true);
  -- Validate against the bank rather than trusting the caller: an option key
  -- that does not exist would otherwise land in the agreement report as a real
  -- expert opinion.
  if not exists (select 1 from item_options where item_id = p_item and option_key = p_best) then
    raise exception 'That is not an option on this item.';
  end if;
  if p_worst is not null and not exists (
       select 1 from item_options where item_id = p_item and option_key = p_worst) then
    raise exception 'That is not an option on this item.';
  end if;

  insert into keying_submissions (round_id, expert_id, item_id, best_option_key, worst_option_key, note)
  values (r.round_id, r.expert_id, p_item, p_best, p_worst, p_note)
  on conflict (round_id, expert_id, item_id) do update set
    best_option_key = excluded.best_option_key,
    worst_option_key = excluded.worst_option_key,
    note = excluded.note, submitted_at = now();
  update keying_tokens set last_seen_at = now() where token = p_token;
end $$;

create or replace function clear_keying_by_token(p_token text, p_item text)
returns void language plpgsql security definer set search_path = public as $$
declare r keying_ctx;
begin
  r := keying_token_expert(p_token, true);
  delete from keying_submissions
  where round_id = r.round_id and expert_id = r.expert_id and item_id = p_item;
end $$;

-- anon gets these three and nothing else. No grant on any table.
grant execute on function get_keying_by_token(text)                       to anon, authenticated;
grant execute on function save_keying_by_token(text, text, text, text, text) to anon, authenticated;
grant execute on function clear_keying_by_token(text, text)               to anon, authenticated;
-- The resolver is an internal helper; it is never called from a browser.
revoke execute on function keying_token_expert(text, boolean) from anon, authenticated, public;

-- ═══ ASSERTIONS ════════════════════════════════════════════════════════════
do $$
declare v int;
begin
  -- The one thing that must be true: neither keying projection selects the key.
  -- Comments are stripped first — both functions carry a comment SAYING that
  -- score_key is deliberately absent, and the first version of this assertion
  -- matched that comment and failed. An assertion that reads its own
  -- documentation is not checking anything.
  select count(*) into v from pg_proc p
  where p.proname in ('get_keying_by_token','get_keying_items')
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') like '%score_key%';
  if v > 0 then
    raise exception 'A keying projection selects score_key — blindness broken (% functions)', v;
  end if;

  -- anon must not have gained ROW access along the way. The first version of
  -- this counted anon's table GRANTS and found 140, which looked like a
  -- catastrophe and was nothing: Supabase grants anon blanket privileges on
  -- public by default, and RLS is what actually holds the line. Counting the
  -- wrong thing produces a scary number and no information. What matters is
  -- whether any POLICY admits anon or public — every table here is
  -- default-deny, so with no such policy there are no readable rows regardless
  -- of the grants.
  select count(*) into v from pg_policies
  where schemaname = 'public'
    and (roles::text like '%anon%' or roles::text like '%public%' or roles::text = '{}');
  if v > 0 then
    raise exception 'A policy now admits anon or public (% found) — the candidate/keyer surfaces must reach the database only through SECURITY DEFINER functions', v;
  end if;

  select count(*) into v from pg_proc
  where proname in ('create_keying_link','revoke_keying_link','get_keying_by_token',
                    'save_keying_by_token','clear_keying_by_token','keying_token_expert');
  if v <> 6 then raise exception 'expected 6 keying-link functions, found %', v; end if;

  raise notice 'sql/17 ok — keying by link, blindness asserted, anon still has no tables';
end $$;
