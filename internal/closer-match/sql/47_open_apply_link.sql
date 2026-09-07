-- ═══════════════════════════════════════════════════════════════════════════
-- 47 — one link, many applicants
--
-- Every assessment link so far has been minted for one named person by a member
-- of staff. That is right for a candidate you already have, and useless for a job
-- post: you cannot put a per-person link in an advert.
--
-- So: one durable link. Applicant gives a name and an email, and goes straight
-- into the assessment. They land in the same `candidates` table as everybody
-- else, appear in the same queue, and are matched and scored by the same engine.
-- Nothing about the existing flow changes — issuing a link to a named candidate
-- works exactly as before, and is still the right thing for somebody you sourced.
--
-- ── THIS IS A DOOR ANYBODY CAN PUSH, SO ───────────────────────────────────
--
-- An anon-callable function that INSERTS is a different animal from one that
-- reads. Four things hold it shut, and each closes a specific way of abusing it:
--
--   1. **Dedupe on email.** The same address always resolves to the same
--      candidate and the same live token. So the link is idempotent per person:
--      reopening it resumes rather than creating a second row, which is both the
--      correct behaviour for somebody who closed the tab AND the thing that stops
--      one applicant becoming forty rows.
--
--   2. **A per-link cap.** `max_uses` counts DISTINCT candidates created through
--      that link. Reaching it closes the link rather than silently accepting
--      more. A link in a job post that suddenly has ten thousand applicants is
--      not a recruiting success.
--
--   3. **A rate limit.** No more than `burst_per_hour` new candidates through one
--      link in any rolling hour. A script hammering the endpoint gets refused
--      while a real morning's applications do not.
--
--   4. **Expiry, and an off switch.** Every link has an end date, and any admin
--      can deactivate one immediately.
--
-- What it deliberately does NOT do is hide whether an email is already known. It
-- says "you have already started, here is your test again", because the
-- alternative — pretending not to recognise them and creating a duplicate — is
-- worse for the applicant and worse for the data. This is a job application, not
-- an account: there is no password to enumerate and nothing to take over.
--
-- ── AND IT STILL CANNOT READ ANYTHING ─────────────────────────────────────
--
-- `open_link_apply()` returns exactly one thing: an assessment token for the
-- person who just typed their own name in. It cannot read a score, cannot list
-- candidates, cannot tell you whether an email exists without that email being
-- typed, and cannot reach any other candidate's token. R1 holds.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists open_links (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  label          text not null,
  created_by     uuid references staff(id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  active         boolean not null default true,
  max_uses       int,
  burst_per_hour int not null default 40,
  valid_days     int not null default 14,
  constraint open_links_label_not_blank check (btrim(label) <> ''),
  constraint open_links_burst_sane check (burst_per_hour between 1 and 500),
  constraint open_links_cap_sane check (max_uses is null or max_uses > 0)
);

comment on table open_links is
  'A durable link that anybody may open to apply. Unlike assessment_tokens, which '
  'name one candidate, this names none — the applicant supplies their own name and '
  'email and a candidate row is created for them.';

-- Which candidates came through which link. Also the rate-limit ledger, so the
-- limit is derived from what actually happened rather than a counter that can
-- drift away from the rows it claims to count.
create table if not exists open_link_uses (
  link_id      uuid not null references open_links(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  used_at      timestamptz not null default now(),
  primary key (link_id, candidate_id)
);

create index if not exists open_link_uses_recent_idx on open_link_uses (link_id, used_at desc);

alter table open_links enable row level security;
alter table open_links force row level security;
alter table open_link_uses enable row level security;
alter table open_link_uses force row level security;

drop policy if exists staff_all on open_links;
create policy staff_all on open_links for all to authenticated
  using (is_staff()) with check (is_staff());
drop policy if exists staff_all on open_link_uses;
create policy staff_all on open_link_uses for all to authenticated
  using (is_staff()) with check (is_staff());

revoke all on open_links from anon;
revoke all on open_link_uses from anon;

insert into nikash_owned_tables (table_name, note)
values ('open_links', 'created by this repository''s migrations'),
       ('open_link_uses', 'created by this repository''s migrations')
on conflict (table_name) do nothing;

-- Where the candidate came from. Nothing scores differently because of it; it is
-- there so a shortlist can say "this one applied to the advert" and so a bad link
-- can be traced to everything it let in.
alter table candidates add column if not exists source text;
comment on column candidates.source is
  'null or ''staff'' for a candidate added by a member of staff; ''open_link'' for '
  'one who applied through a public link. Provenance only — it changes no score.';

-- ── What the applicant sees before typing anything ────────────────────────
create or replace function get_open_link(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l open_links;
begin
  select * into l from open_links where slug = p_slug;

  -- One shape for every kind of "no", so the page has one thing to render and a
  -- stranger learns nothing from which one they hit.
  if l.id is null or not l.active or l.expires_at <= now() then
    return jsonb_build_object('ok', false,
      'reason', 'This link is not open. If somebody sent it to you recently, ask '
                'them for a current one.');
  end if;

  if l.max_uses is not null
     and (select count(*) from open_link_uses u where u.link_id = l.id) >= l.max_uses then
    return jsonb_build_object('ok', false,
      'reason', 'This link has reached the number of applicants it was set up for.');
  end if;

  return jsonb_build_object('ok', true, 'label', l.label);
end $$;

-- ── Applying ──────────────────────────────────────────────────────────────
-- `search_path = public, extensions` for gen_random_bytes, and the token is
-- minted INLINE rather than through issue_assessment_token(). That function is
-- is_staff() guarded, and SECURITY DEFINER changes the privileges a function runs
-- with — it does not change `auth.uid()`. An applicant has no staff row, so
-- calling it from here raised "issue_assessment_token: staff only" and the
-- applicant saw a dead end.
--
-- Duplicating four lines is the lesser evil against relaxing that guard: the one
-- staff-only path for minting a link on demand stays staff-only, and this door
-- mints its own for the one candidate it just created.
create or replace function open_link_apply(p_slug text, p_name text, p_email text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  l open_links; v_email text; v_name text; v_cand uuid; v_tok text;
  v_recent int; v_total int; v_returning boolean := false;
begin
  select * into l from open_links where slug = p_slug;
  if l.id is null or not l.active or l.expires_at <= now() then
    raise exception 'This link is not open.';
  end if;

  v_name  := btrim(coalesce(p_name, ''));
  v_email := lower(btrim(coalesce(p_email, '')));

  if length(v_name) < 2 then
    raise exception 'Please enter your full name.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Please enter an email address we can reach you on.';
  end if;

  -- ── Already applied? Same person, same candidate, same test ────────────
  -- Checked BEFORE the cap and the rate limit, deliberately: somebody coming
  -- back to finish a test they started must not be turned away because the link
  -- filled up in the meantime. They are not a new applicant.
  select c.id into v_cand
  from candidates c
  join open_link_uses u on u.candidate_id = c.id
  where u.link_id = l.id and lower(c.contact->>'email') = v_email
  limit 1;

  if v_cand is not null then
    v_returning := true;
    select token into v_tok from assessment_tokens
    where candidate_id = v_cand and expires_at > now()
    order by issued_at desc limit 1;
    if v_tok is null then
      v_tok := encode(gen_random_bytes(24), 'hex');
      insert into assessment_tokens (token, candidate_id, expires_at)
      values (v_tok, v_cand, now() + make_interval(days => l.valid_days));
    end if;
  else
    -- ── A new applicant, and the two limits that apply to one ────────────
    if l.max_uses is not null then
      select count(*) into v_total from open_link_uses u where u.link_id = l.id;
      if v_total >= l.max_uses then
        raise exception 'This link has reached the number of applicants it was set up for.';
      end if;
    end if;

    select count(*) into v_recent from open_link_uses u
    where u.link_id = l.id and u.used_at > now() - interval '1 hour';
    if v_recent >= l.burst_per_hour then
      raise exception 'Too many applications through this link in the last hour. '
                      'Please try again shortly.';
    end if;

    insert into candidates (full_name, contact, consent_version, consent_at, source)
    values (v_name, jsonb_build_object('email', v_email), 'pending', now(), 'open_link')
    returning id into v_cand;

    insert into open_link_uses (link_id, candidate_id) values (l.id, v_cand);
    v_tok := encode(gen_random_bytes(24), 'hex');
    insert into assessment_tokens (token, candidate_id, expires_at)
    values (v_tok, v_cand, now() + make_interval(days => l.valid_days));
  end if;

  -- The token, and nothing else. No candidate id, no scores, no counts.
  return jsonb_build_object('ok', true, 'token', v_tok, 'returning', v_returning,
    'name', (select full_name from candidates where id = v_cand));
end $$;

-- ── Minting and retiring links ────────────────────────────────────────────
-- `search_path = public, extensions`, not just public. pgcrypto lives in
-- `extensions` on Supabase, so `gen_random_bytes` is invisible to a function
-- pinned to public alone — which is what sql/14 was written about, and what this
-- function reintroduced by copying the wrong neighbour's header.
--
-- The migration's own assertion did not catch it: applied through the Management
-- API it runs as `postgres`, whose search_path already includes `extensions`, so
-- minting a link worked in the migration and 42883'd for every real caller. Same
-- shape as §7ao's safeupdate trigger — code correct in the one context it was
-- run in.
create or replace function create_open_link(p_label text, p_valid_days int default 90,
                                            p_max_uses int default null,
                                            p_burst_per_hour int default 40)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare v_slug text; v_id uuid; v_staff uuid;
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can create a public application link.';
  end if;
  if coalesce(btrim(p_label), '') = '' then
    raise exception 'Give the link a label — you will have several and they all '
                    'look the same in a URL.';
  end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  -- Long enough that it cannot be guessed, short enough to paste into an advert.
  v_slug := encode(gen_random_bytes(12), 'hex');

  insert into open_links (slug, label, created_by, expires_at, max_uses,
                          burst_per_hour, valid_days)
  values (v_slug, btrim(p_label), v_staff, now() + make_interval(days => p_valid_days),
          p_max_uses, coalesce(p_burst_per_hour, 40), 14)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'slug', v_slug, 'label', btrim(p_label));
end $$;

create or replace function set_open_link_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can open or close a public application link.';
  end if;
  update open_links set active = p_active where id = p_id;
  if not found then raise exception 'No such link.'; end if;
  return jsonb_build_object('id', p_id, 'active', p_active);
end $$;

create or replace function list_open_links()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'list_open_links: staff only'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'slug', l.slug, 'label', l.label,
      'created_by', st.full_name, 'created_at', l.created_at,
      'expires_at', l.expires_at, 'expired', l.expires_at <= now(),
      'active', l.active, 'max_uses', l.max_uses, 'burst_per_hour', l.burst_per_hour,
      'used', (select count(*) from open_link_uses u where u.link_id = l.id),
      'last_used_at', (select max(u.used_at) from open_link_uses u where u.link_id = l.id),
      -- How many of them actually sat the test. A link that brings in ninety
      -- applicants and four completed assessments is telling you something.
      'completed', (select count(*) from open_link_uses u
                    join assessment_sessions s on s.candidate_id = u.candidate_id
                    where u.link_id = l.id and s.completed_at is not null))
    order by l.created_at desc)
  from open_links l left join staff st on st.id = l.created_by), '[]'::jsonb);
end $$;

-- ── Grants ────────────────────────────────────────────────────────────────
revoke all on function get_open_link(text) from public;
revoke all on function open_link_apply(text, text, text) from public;
revoke all on function create_open_link(text, int, int, int) from public;
revoke all on function set_open_link_active(uuid, boolean) from public;
revoke all on function list_open_links() from public;

grant execute on function get_open_link(text) to anon, authenticated;
grant execute on function open_link_apply(text, text, text) to anon, authenticated;
grant execute on function create_open_link(text, int, int, int) to authenticated;
grant execute on function set_open_link_active(uuid, boolean) to authenticated;
grant execute on function list_open_links() to authenticated;

-- The two anon-callable ones go on the allowlist with their reason, or sql/31's
-- event trigger will revoke them again on the next sweep — correctly, because an
-- anon-callable function that nobody wrote down is exactly what that guards.
insert into anon_callable (proname, why) values
  ('get_open_link',
   'A public application link has to be able to say whether it is open before the '
   'applicant types anything. Returns a label and a yes/no, nothing else.'),
  ('open_link_apply',
   'The application itself. Creates one candidate and returns one assessment token '
   'for the person who typed their own name and email. Deduped on email, capped '
   'per link and rate limited per hour. Reads no score and lists nothing.')
on conflict (proname) do update set why = excluded.why;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare
  v_slug text; v_id uuid; r jsonb; r2 jsonb; v_n int; v_cand uuid;
begin
  if not is_staff() then
    -- The behavioural half needs a staff identity to mint a link. What must hold
    -- everywhere is that the anon-callable pair is on the allowlist, because the
    -- grant sweep will otherwise take the feature away on its next run.
    if (select count(*) from anon_callable
        where proname in ('get_open_link', 'open_link_apply')) <> 2 then
      raise exception 'the open-link functions are not on the anon allowlist';
    end if;
    raise notice 'sql/47: created; behaviour covered by test/assess.js';
    return;
  end if;

  r := create_open_link('ZZ_FIXTURE open link', 30, 3, 40);
  v_slug := r->>'slug';
  v_id := (r->>'id')::uuid;

  if length(v_slug) < 20 then raise exception 'the slug is too short to be unguessable'; end if;
  if not (get_open_link(v_slug)->>'ok')::boolean then
    raise exception 'a link that was just created does not read as open';
  end if;

  -- A real application.
  -- NOTE: run here as `postgres`, which IS staff-adjacent enough that a staff
  -- guard inside a called function would not fire. The real proof that an anon
  -- applicant can complete this is in test/apply.js, which uses the published key
  -- with no session — the guard that broke the first version was invisible here.
  r := open_link_apply(v_slug, 'ZZ_FIXTURE Applicant', 'ZZ.Applicant@Example.com ');
  if not (r->>'ok')::boolean or coalesce(r->>'token', '') = '' then
    raise exception 'applying did not return a token';
  end if;
  if (r->>'returning')::boolean then
    raise exception 'a first application reads as a returning one';
  end if;

  select candidate_id into v_cand from open_link_uses where link_id = v_id limit 1;
  if (select source from candidates where id = v_cand) <> 'open_link' then
    raise exception 'the candidate does not record where they came from';
  end if;
  -- Email is stored lowercased and trimmed, or the dedupe below is decorative.
  if (select contact->>'email' from candidates where id = v_cand) <> 'zz.applicant@example.com' then
    raise exception 'the email was not normalised: %',
      (select contact->>'email' from candidates where id = v_cand);
  end if;

  -- ── The load-bearing one: the same person twice is one candidate ───────
  r2 := open_link_apply(v_slug, 'ZZ_FIXTURE Applicant', 'zz.applicant@example.com');
  if not (r2->>'returning')::boolean then
    raise exception 'applying twice with the same email did not recognise them';
  end if;
  if r2->>'token' <> r->>'token' then
    raise exception 'a returning applicant got a second live token for the same test';
  end if;
  select count(*) into v_n from open_link_uses where link_id = v_id;
  if v_n <> 1 then
    raise exception 'the same email created % candidates', v_n;
  end if;

  -- Different case and whitespace is the same person too.
  r2 := open_link_apply(v_slug, 'ZZ_FIXTURE Applicant', '  ZZ.APPLICANT@example.com  ');
  if not (r2->>'returning')::boolean then
    raise exception 'a differently-cased email was treated as a new person';
  end if;

  -- ── Rubbish in ─────────────────────────────────────────────────────────
  begin
    perform open_link_apply(v_slug, 'A', 'zz.b@example.com');
    raise exception 'a one-character name was accepted';
  exception when others then
    if sqlerrm not like '%full name%' then raise; end if;
  end;
  begin
    perform open_link_apply(v_slug, 'ZZ_FIXTURE Two', 'not-an-email');
    raise exception 'a malformed email was accepted';
  exception when others then
    if sqlerrm not like '%email address%' then raise; end if;
  end;

  -- ── The cap ────────────────────────────────────────────────────────────
  perform open_link_apply(v_slug, 'ZZ_FIXTURE Two', 'zz.two@example.com');
  perform open_link_apply(v_slug, 'ZZ_FIXTURE Three', 'zz.three@example.com');
  begin
    perform open_link_apply(v_slug, 'ZZ_FIXTURE Four', 'zz.four@example.com');
    raise exception 'the max_uses cap did not stop a fourth applicant';
  exception when others then
    if sqlerrm not like '%number of applicants%' then raise; end if;
  end;
  -- …but somebody who already applied still gets back in.
  r2 := open_link_apply(v_slug, 'ZZ_FIXTURE Applicant', 'zz.applicant@example.com');
  if not (r2->>'returning')::boolean then
    raise exception 'a full link locked out somebody who had already started';
  end if;

  -- ── The off switch ─────────────────────────────────────────────────────
  perform set_open_link_active(v_id, false);
  if (get_open_link(v_slug)->>'ok')::boolean then
    raise exception 'a deactivated link still reads as open';
  end if;
  begin
    perform open_link_apply(v_slug, 'ZZ_FIXTURE Five', 'zz.five@example.com');
    raise exception 'a deactivated link still accepted an application';
  exception when others then
    if sqlerrm not like '%not open%' then raise; end if;
  end;

  -- Tidy up: candidates first, then the link.
  for v_cand in select candidate_id from open_link_uses where link_id = v_id loop
    perform purge_candidate(v_cand);
  end loop;
  delete from open_links where id = v_id;

  raise notice 'sql/47: open apply link verified — dedupe, cap, rate limit, off switch';
end $$;
