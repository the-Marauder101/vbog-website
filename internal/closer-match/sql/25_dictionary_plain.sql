-- ═══════════════════════════════════════════════════════════════════════════
-- 25 — what the scores actually mean
--
-- *"Can we also see what the candidate scores actually mean? The CLS-C, F etc.,
--  I can't really understand those."*
--
-- Fair. `dimensions.definition` is one line written for the person who BUILT the
-- instrument — "Behaviour change after correction, including correction they
-- disagree with" is precise and tells a recruiter nothing about what a 55 will
-- look like on Tuesday. A construct definition is not an explanation.
--
-- So each dimension now carries four plain-language fields, written for someone
-- reading a shortlist rather than designing a test:
--
--   high_looks_like  — what an 80 does on the floor, concretely
--   low_looks_like   — what a 30 does, without pretending it is a character flaw
--   why_it_matters   — the commercial consequence, which is the only reason to
--                      measure anything
--   how_measured     — which items produce it, so the number is inspectable
--                      rather than magic
--
-- CLS_C AND CLS_F GET EXTRA CARE, because they are the two that confuse people
-- and the two the whole matching engine turns on. They are not "closing, part 1
-- and part 2". They are the SAME trait measured in two different sales motions,
-- and a candidate can be strong in one and weak in the other. Which one counts
-- is decided by the client's ticket size and cycle length, not by the candidate.
-- ═══════════════════════════════════════════════════════════════════════════

alter table dimensions add column if not exists high_looks_like text;
alter table dimensions add column if not exists low_looks_like  text;
alter table dimensions add column if not exists why_it_matters  text;
alter table dimensions add column if not exists how_measured    text;
alter table dimensions add column if not exists plain_name      text;

update dimensions set
  plain_name = 'Closing — on a considered sale',
  high_looks_like =
    'Asks for the money out loud, then stops talking. Holds a price when the '
    'buyer pushes, and holds their own frame with a founder or a head of '
    'department who is used to being deferred to. Comes back to a stalled deal '
    'with a reason to decide rather than a reason to check in.',
  low_looks_like =
    'Presents well and then trails off — "let me know what you think", "no rush". '
    'Discounts before being asked. Goes quiet on a senior buyer, or turns a '
    'closing conversation into another round of information.',
  why_it_matters =
    'On a deal worth ₹1L+ that takes weeks and several conversations, nothing '
    'else in the profile can compensate for not asking. This is the single '
    'dimension most likely to decide whether a considered pipeline converts.',
  how_measured =
    'Four scenario items set in multi-conversation sales: a silence after the '
    'price, a discount request, a senior buyer deferring, and a deal that has '
    'gone quiet. Scored −1 to +2 per item, then rescaled to 0–100.'
where code = 'CLS_C';

update dimensions set
  plain_name = 'Closing — on a fast sale',
  high_looks_like =
    'Closes inside the call they are already on. Reads that the buyer is ready '
    'and moves, rather than booking a follow-up that will never be taken. '
    'Comfortable asking twice in ten minutes without sounding aggressive.',
  low_looks_like =
    'Ends a warm inbound call with "I''ll send you the details" and loses the '
    'moment. Needs a second conversation to do what could have been done in the '
    'first. Not necessarily weak at closing — often strong at the considered '
    'version and simply slower than a same-day desk needs.',
  why_it_matters =
    'On a ₹20k product sold off an inbound call, the deal exists for about as '
    'long as the call does. A closer who needs three touches to get there will '
    'be out-produced by someone weaker on every other dimension.',
  how_measured =
    'Four scenario items set inside a single short inbound call. Same scoring as '
    'the considered version — deliberately, so the two are directly comparable.'
where code = 'CLS_F';

update dimensions set
  plain_name = 'Holding up under a bad run',
  high_looks_like =
    'Dials the same on the ninth no as on the first. Tone does not curdle after '
    'a rude buyer. A bad month changes their plan, not their activity.',
  low_looks_like =
    'Activity quietly drops during a bad week — fewer calls, later starts, more '
    'admin. Not laziness; it is the ordinary human response to repeated '
    'rejection, and it is exactly what a cold desk cannot absorb.',
  why_it_matters =
    'On any role that is heavily cold outbound, this predicts whether the '
    'pipeline survives February. On a warm inbound desk it matters far less, '
    'which is why the required level moves with the role.',
  how_measured =
    'Four scenario items covering a losing streak, a hostile buyer, a missed '
    'month, and a public setback.'
where code = 'RES';

update dimensions set
  plain_name = 'Setting their own bar',
  high_looks_like =
    'Has a number in their head that is higher than the one you gave them. '
    'Treats target as a floor. Notices their own dip before a manager does.',
  low_looks_like =
    'Works to the target and stops. Perfectly reliable, and will need managing '
    'to a number rather than releasing at one.',
  why_it_matters =
    'Decides how much management a desk costs you. Two closers can produce the '
    'same in month one and diverge sharply by month six on this alone.',
  how_measured =
    'Four scenario items about what they do once the target is already hit, and '
    'how they set their own standards when nobody is watching.'
where code = 'DRV';

update dimensions set
  plain_name = 'Keeping the pipeline honest',
  high_looks_like =
    'Logs the call the same day. Follow-ups have dates, not intentions. Builds '
    'their own tracker when the CRM does not do what they need.',
  low_looks_like =
    'Carries the pipeline in their head. It works until the pipeline gets big, '
    'they get ill, or somebody else has to pick it up.',
  why_it_matters =
    'This is the dimension that decides whether you can see the desk at all. '
    'It matters most where there is no CRM to lean on — which the intake asks '
    'about, and which raises the required level when the answer is no.',
  how_measured =
    'Four scenario items on same-day logging, dated follow-ups, pipeline hygiene '
    'and what they build when the system is not given to them.'
where code = 'DSC';

update dimensions set
  plain_name = 'Changing when corrected',
  high_looks_like =
    'Tries the new approach properly before judging it — including when they '
    'think it is wrong. Comes back with what happened rather than with why they '
    'were right.',
  low_looks_like =
    'Agrees in the meeting and carries on. Or argues, wins, and never tests. '
    'Both leave you unable to move the desk.',
  why_it_matters =
    'Determines whether the other eight dimensions can be improved. A coachable '
    'closer who is short on one thing is a hire; an uncoachable one who is short '
    'on the same thing is a permanent gap.',
  how_measured =
    'Four scenario items where correction arrives — from a manager they respect, '
    'from one they do not, from a peer, and from data.'
where code = 'CCH';

update dimensions set
  plain_name = 'What they will not do to close',
  high_looks_like =
    'Says the product does not fit and means it. Does not invent a deadline. '
    'Will lose a deal rather than sell someone the wrong thing.',
  low_looks_like =
    'Manufactures urgency. Oversells the edges. Closes people who will churn — '
    'which shows up in your refund rate and in the client''s opinion of you '
    'about ninety days later.',
  why_it_matters =
    'The one dimension whose cost lands on somebody else''s P&L before it lands '
    'on yours. It matters most where a refund policy exists, and the intake '
    'raises the required level when it does.',
  how_measured =
    'Four scenario items with a commercial incentive to shade the truth, and a '
    'cost to doing so that is not immediately visible.'
where code = 'INT';

update dimensions set
  plain_name = 'Volume or craft — not better or worse',
  high_looks_like =
    'Toward 100: works a smaller number of deals deeply. Maps stakeholders, '
    'builds a case, is comfortable with a sale that takes six weeks.',
  low_looks_like =
    'Toward 0: works volume. Fast qualification, high activity, little patience '
    'for a deal that will not move. Excellent on a same-day desk and miserable '
    'on an enterprise one.',
  why_it_matters =
    'This is a FIT dimension, not a quality one. There is no good score. A '
    'candidate at 20 is wrong for a ₹3L consultative role and close to ideal for '
    'a ₹20k same-day one — so the engine measures DISTANCE from what the role '
    'needs, never height.',
  how_measured =
    'Five forced-choice items with no better answer, scored as a position on the '
    'axis rather than a total.'
where code = 'MOT';

update dimensions set
  plain_name = 'How they build the relationship — not better or worse',
  high_looks_like =
    'Toward 100: rapport-warm. Builds trust first, reads the room, buyers like '
    'them before they believe them.',
  low_looks_like =
    'Toward 0: task-direct. Gets to the point, respects the buyer''s time, can '
    'read as blunt to somebody expecting warmth.',
  why_it_matters =
    'Also a FIT dimension. A procurement manager buying a commodity often '
    'prefers task-direct; a founder buying a service usually does not. The '
    'intake asks how their buyer responds, and the target follows from that.',
  how_measured =
    'Five forced-choice items with no better answer, scored as a position on the '
    'axis.'
where code = 'STY';

-- Correction to sql/25: three "how it is measured" lines were wrong.
--
-- RES, DRV and DSC each carry four scenario items PLUS one behavioural-frequency
-- item — a self-reported count about the candidate's own last week or month.
-- The first draft said "four scenario items" for all three. A dictionary that
-- misstates how a number is produced is worse than no dictionary: it is the one
-- page a reader will trust when they want to know whether to trust the number.
update dimensions set how_measured =
  'Four scenario items covering a losing streak, a hostile buyer, a missed month '
  'and a public setback — plus one behavioural-frequency item asking what actually '
  'happened to their daily activity during their longest recent run without a close. '
  'The scenarios ask what they would do; the frequency item asks what they did.'
where code = 'RES';

update dimensions set how_measured =
  'Four scenario items about what they do once the target is already hit and how '
  'they set their own standards unobserved — plus one behavioural-frequency item '
  'asking how many previously-cold prospects they actually re-contacted in the last '
  '30 days. Intent and evidence, scored together.'
where code = 'DRV';

update dimensions set how_measured =
  'Four scenario items on same-day logging, dated follow-ups, pipeline hygiene and '
  'what they build when no system is given to them — plus one behavioural-frequency '
  'item asking on how many days last week they actually updated their notes the same '
  'day. The one dimension where a self-report is easy to check against a CRM.'
where code = 'DSC';

update dimensions set how_measured =
  'Four scenario items where correction arrives — from a manager they respect, one '
  'they do not, a peer, and from data. Scored −1 to +2 per item, rescaled to 0–100.'
where code = 'CCH';

update dimensions set how_measured =
  'Four scenario items with a commercial incentive to shade the truth and a cost to '
  'doing so that is not immediately visible. Scored −1 to +2, rescaled to 0–100.'
where code = 'INT';

-- Every dimension's stated item count must match the bank, checked rather than
-- claimed. This is the assertion the first draft did not have.
do $$
declare r record; v_claimed int; v_actual int;
begin
  for r in select code, how_measured, (select count(*) from items i
             where i.dimension_code = dimensions.code and i.active) as n
           from dimensions where active
  loop
    -- "Four scenario items ..." plus optionally "one behavioural-frequency item"
    v_claimed := case when r.how_measured ilike '%four scenario%' then 4
                      when r.how_measured ilike '%five forced-choice%' then 5
                      else null end
               + case when r.how_measured ilike '%one behavioural-frequency%' then 1 else 0 end;
    if v_claimed is null then
      raise exception 'dimension % does not state how many items it uses', r.code;
    end if;
    if v_claimed <> r.n then
      raise exception 'dimension % claims % items, the bank has %', r.code, v_claimed, r.n;
    end if;
  end loop;
  raise notice 'every dimension states its true item count';
end $$;

-- ═══ THE DICTIONARY, as one object ═════════════════════════════════════════
-- Staff-only, like everything that touches the instrument's internals. Includes
-- the required level each open role asks for, so the glossary is not a separate
-- world from the shortlist.
create or replace function get_dictionary()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_dictionary: staff only'; end if;

  return jsonb_build_object(
    'dimensions', (
      select coalesce(jsonb_agg(x order by x->>'sort'), '[]'::jsonb) from (
        select jsonb_build_object(
          'code', d.code, 'name', d.name, 'plain_name', d.plain_name,
          'kind', d.kind, 'definition', d.definition,
          'pole_0', d.pole_0_label, 'pole_100', d.pole_100_label,
          'high_looks_like', d.high_looks_like,
          'low_looks_like', d.low_looks_like,
          'why_it_matters', d.why_it_matters,
          'how_measured', d.how_measured,
          'n_items', (select count(*) from items i
                       where i.dimension_code = d.code and i.active),
          'sort', case d.code
                    when 'CLS_C' then '1' when 'CLS_F' then '2' when 'RES' then '3'
                    when 'DRV'   then '4' when 'DSC'   then '5' when 'CCH' then '6'
                    when 'INT'   then '7' when 'MOT'   then '8' else '9' end,
          'required_by', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'title', req.title, 'business_name', cl.business_name,
                     'level', case when d.kind = 'bipolar'
                                   then (tp.bipolar_targets->>d.code)::numeric
                                   when d.code in ('CLS_C','CLS_F')
                                   then (tp.required_levels->>'CLS')::numeric
                                   else (tp.required_levels->>d.code)::numeric end)
                   order by cl.business_name), '[]'::jsonb)
            from requirements req
            join clients cl on cl.id = req.client_id
            join client_target_profile tp on tp.id = req.target_profile_id
            where req.status = 'open' and cl.business_name not like 'ZZ_FIXTURE%')
        ) as x
        from dimensions d where d.active
      ) t),
    'scale',
      'Every unipolar dimension is 0–100, rescaled from four scenario items '
      'scored −1 to +2. 50 is not a pass mark — it is the middle of the scale. '
      'What counts as enough is set per role by the client''s own intake answers, '
      'never by a fixed threshold. The last two are different: they have no better '
      'end, so 0 is not a low score, it is one side. Both are built from five '
      'either/or questions, so they can only land on 0, 20, 40, 60, 80 or 100 — '
      'read them as a lean, not a measurement, and expect people to bunch up.',
    'caveat',
      'These weights are expert-set, not learned from outcomes. Until roughly a '
      'hundred placements have been followed up, treat every number here as a '
      'structured opinion rather than a prediction.'
  );
end $$;

grant execute on function get_dictionary() to authenticated;

do $$
declare v int;
begin
  select count(*) into v from dimensions
  where active and (high_looks_like is null or low_looks_like is null
                    or why_it_matters is null or how_measured is null
                    or plain_name is null);
  if v > 0 then raise exception '% dimension(s) still have no plain-language text', v; end if;
  raise notice 'sql/25 ok — all 9 dimensions explained in plain language';
end $$;
