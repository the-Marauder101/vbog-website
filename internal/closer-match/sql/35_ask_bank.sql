-- ═══════════════════════════════════════════════════════════════════════════
-- 35 — the ASK scorecard, moved out of a file and into the system
--
-- ASK is the R2 interview: 14 attributes, 42 questions, each answer scored 0–3
-- against a written behavioural anchor. It already existed and already worked, as
-- one self-contained HTML file at `internal/ASK/index.html` — no database, no
-- sign-in, results downloaded as JSON.
--
-- That is enough for one person running one interview. It does not survive a
-- team, which is the entire point of this change:
--
--   · no record of who interviewed whom, so a colleague's judgement cannot be
--     reviewed, coached, or compared with anybody else's
--   · the result lives in a file on whoever's laptop ran the call
--   · nothing sits next to the candidate's questionnaire scores
--   · the wording can only be changed by editing code
--
-- ── WHAT IS NOT CHANGING ───────────────────────────────────────────────────
--
-- The instrument. Every question, hint and anchor below was extracted
-- programmatically from `internal/ASK/index.html` rather than retyped, because
-- **the wording IS the instrument** — "Knows both cold: specific on both, and can
-- explain what changed the connect rate" is doing the measuring, and a
-- transcription slip is a silent change to what is being measured. The extractor
-- asserted 14 attributes, 5 priority, 42 questions, 168 options, 2 reference.
-- Those same counts are asserted again at the bottom of this file.
--
-- ── WHAT ASK IS NOT ────────────────────────────────────────────────────────
--
-- **It does not touch the match score.** `compute_matches()`, `matches.composite`
-- and `candidate_profile.scores` are untouched by this file and by everything
-- downstream of it. ASK is a second, independent reading of the same person.
--
-- That is not squeamishness, it is the same argument as §12/§18 on keeping the
-- three predictors apart, and the same argument as sql/28 against a second
-- `final_keys` table:
--
-- > **Two measurements of one person are worth more apart than averaged. Blend
-- > them and you can never find out which one was right.**
--
-- The questionnaire measures fit against one client's stated needs. ASK measures
-- whether they can sell at all. Averaging produces a number that looks objective
-- while carrying an interviewer's judgement inside it, and destroys the only
-- experiment worth running: which of the two predicted a good hire.
--
-- ── R1 AND R2 ARE THE SAME BANK, DIFFERENT SCOPE ───────────────────────────
--
-- R1 is a 15-question phone screen — the five priority attributes only. R2 is all
-- 42. One bank, one scoring rule, one screen; the round decides what is served.
-- Both are stored, so a candidate can carry an R1 from the team and an R2 later.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The bank ────────────────────────────────────────────────────────────
create table if not exists ask_attributes (
  id          text primary key,
  section     text not null check (section in ('sell', 'sustain', 'who')),
  name        text not null,
  priority    boolean not null default false,   -- the five that make up R1
  skills      text[] not null default '{}',
  knowledge   text[] not null default '{}',
  sort_order  int not null,
  active      boolean not null default true
);

create table if not exists ask_questions (
  id            text primary key,
  attribute_id  text not null references ask_attributes(id) on delete cascade,
  prompt        text not null,
  hint          text,               -- what the interviewer listens for
  -- Two questions are put to the candidate's PREVIOUS MANAGER, not the candidate.
  -- They do not block submitting; the scorecard reads as incomplete until they
  -- are answered, which is the behaviour the standalone tool already had.
  is_reference  boolean not null default false,
  sort_order    int not null,
  active        boolean not null default true
);

create table if not exists ask_options (
  question_id  text not null references ask_questions(id) on delete cascade,
  score        int not null check (score between 0 and 3),
  label        text not null,        -- the short chip
  description  text not null,        -- the behavioural anchor
  primary key (question_id, score)
);

-- ── 2. Scorecards ──────────────────────────────────────────────────────────
create table if not exists ask_scorecards (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references candidates(id) on delete cascade,
  round          text not null check (round in ('r1', 'r2')),
  interviewer_id uuid references staff(id) on delete set null,
  client_context text,
  conducted_on   date not null default current_date,
  bank_revision  int,
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  total          int,
  max_total      int,
  pct            numeric,
  attributes     jsonb,              -- frozen per-attribute breakdown, on submit
  -- Frozen totals belong together: either all four are set (submitted) or none
  -- are (open). A half-frozen scorecard would be a number nobody could date.
  constraint ask_frozen_together check (
    (submitted_at is null and total is null and max_total is null and attributes is null)
    or (submitted_at is not null and total is not null and max_total is not null and attributes is not null))
);

create index if not exists ask_scorecards_candidate on ask_scorecards (candidate_id, round);

-- One OPEN scorecard per candidate per round. Submitted ones accumulate, because
-- re-interviewing somebody is a real thing and the earlier read is evidence.
create unique index if not exists ask_one_open_per_round
  on ask_scorecards (candidate_id, round) where submitted_at is null;

create table if not exists ask_scores (
  scorecard_id  uuid not null references ask_scorecards(id) on delete cascade,
  question_id   text not null references ask_questions(id),
  score         int not null check (score between 0 and 3),
  note          text,
  -- Snapshots. The bank is editable, so without these a scorecard from March
  -- would silently re-read itself against May's wording — a score whose question
  -- has changed underneath it is not a record of anything.
  question_text text not null,
  option_label  text not null,
  answered_at   timestamptz not null default now(),
  primary key (scorecard_id, question_id)
);

-- ── 3. A revision counter, so scorecards can be grouped by wording ────────
create table if not exists ask_bank_meta (
  only_row      boolean primary key default true check (only_row),
  bank_revision int not null default 1,
  updated_at    timestamptz not null default now()
);
insert into ask_bank_meta (only_row) values (true) on conflict do nothing;

create or replace function bump_ask_bank_revision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update ask_bank_meta set bank_revision = bank_revision + 1, updated_at = now();
  return null;
end $$;

drop trigger if exists ask_questions_bump on ask_questions;
create trigger ask_questions_bump after insert or update or delete on ask_questions
  for each statement execute function bump_ask_bank_revision();
drop trigger if exists ask_options_bump on ask_options;
create trigger ask_options_bump after insert or update or delete on ask_options
  for each statement execute function bump_ask_bank_revision();

-- ── 4. RLS — default deny, staff only, same as every other scored table ────
do $$
declare t text;
begin
  foreach t in array array['ask_attributes','ask_questions','ask_options',
                           'ask_scorecards','ask_scores','ask_bank_meta']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated '
                   'using (is_staff()) with check (is_staff())', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

insert into ask_attributes (id, section, name, priority, skills, knowledge, sort_order) values
  ('dialing', 'sell', 'Dialing Discipline', false, array['Call volume management', 'Daily target setting', 'Speed to lead', 'Rejection recovery'], array['Sales floor norms', 'Lead lifecycle stages', 'Inbound lead psychology'], 1),
  ('discovery', 'sell', 'Discovery & Diagnosis', true, array['Situation questioning', 'Gap identification', 'Active listening', 'Motivation uncovering'], array['Discovery frameworks', 'Buyer motivation types', 'Pain-to-aspiration mapping'], 2),
  ('objection', 'sell', 'Objection Handling', true, array['Objection acknowledgement', 'Value reframing', 'Price defence', 'Stall management'], array['Common objection types', 'Price psychology', 'Trust-based reframing'], 3),
  ('closing', 'sell', 'Closing Ability', true, array['Trial closing', 'Commitment asking', 'Urgency creation', 'Decision guiding'], array['High-ticket close psychology', 'Buying signal recognition', 'Decision triggers'], 4),
  ('followup', 'sustain', 'Follow-Up Discipline', false, array['Cadence management', 'Multi-touch sequencing', 'Pipeline prioritisation', 'Lead reactivation'], array['Follow-up timing norms', 'Multi-touch frameworks', 'Lead decay patterns'], 5),
  ('crm', 'sustain', 'CRM Discipline', false, array['Real-time updating', 'Pipeline stage management', 'Activity logging', 'Data accuracy'], array['CRM platform basics', 'Pipeline stage logic', 'Data hygiene'], 6),
  ('target', 'sustain', 'Target Orientation', false, array['Personal KPI tracking', 'Revenue forecasting', 'Performance self-review', 'Gap closing'], array['Revenue KPI structure', 'Conversion benchmarks', 'Performance diagnostics'], 7),
  ('ownership', 'who', 'Ownership', true, array['Self-diagnosis', 'Independent structuring', 'Result accountability'], array['Self-management principles', 'Performance causality'], 8),
  ('eq', 'who', 'Emotional Intelligence', false, array['Emotional state reading', 'Energy matching', 'Stakeholder management', 'Hesitation surfacing'], array['Emotional buying triggers', 'Stakeholder dynamics', 'Family decision patterns'], 9),
  ('coach', 'who', 'Coachability', false, array['Feedback reception', 'Behaviour adaptation', 'Self-review practice'], array['Call review process', 'Feedback implementation'], 10),
  ('pressure', 'who', 'Confidence Under Pressure', false, array['Frame holding', 'In-call recovery', 'Composure under challenge'], array['Value vs price framing', 'High-ticket sale dynamics'], 11),
  ('intent', 'who', 'Genuine Intent', false, array['Role-specific research', 'Honest self-assessment', 'Two-way evaluation'], array['Role-specific knowledge', 'Market awareness'], 12),
  ('consistency', 'who', 'Post-Hire Consistency', false, array['Motivation self-management', 'Standard maintenance', 'Routine discipline'], array['Personal motivation patterns', 'Performance consistency drivers'], 13),
  ('longevity', 'who', 'Longevity', true, array['Resilience through dips', 'Commitment history', 'Long-term thinking'], array['Sales performance cycles', 'Career commitment patterns'], 14)
on conflict (id) do update set
  section = excluded.section, name = excluded.name, priority = excluded.priority,
  skills = excluded.skills, knowledge = excluded.knowledge, sort_order = excluded.sort_order;

insert into ask_questions (id, attribute_id, prompt, hint, is_reference, sort_order) values
  ('dialing-1', 'dialing', 'What was your actual dial count on a normal day in your last role — and how many of those connected?', 'Anyone who has genuinely done volume knows both numbers without thinking. The connect rate is the harder one to fake.', false, 1),
  ('dialing-2', 'dialing', 'A warm lead comes in at 6pm. Your shift ends at 7. What do you do — and why?', 'Tests whether they understand speed-to-lead decay, or just work to a clock.', false, 2),
  ('dialing-3', 'dialing', 'You''ve had 12 rejections in a row this morning. What happens to your next call?', 'Anyone claiming it has zero effect either hasn''t done the volume or isn''t being honest. The tell is a real reset mechanism.', false, 3),
  ('discovery-1', 'discovery', 'How do you know within the first 3–5 minutes of a call whether this lead is going to close or not? What are you picking up on?', 'Only someone who has done hundreds of calls has an instinct here they can put into words. This is the single best filter on the sheet.', false, 1),
  ('discovery-2', 'discovery', 'What''s the one question you ask on every single discovery call, no matter what — and why that one?', 'Experienced closers have a signature question and clear reasoning for it. Freshers give a generic opener.', false, 2),
  ('discovery-3', 'discovery', 'When a prospect tells you their problem, how do you know they''re telling you the real one?', 'The stated problem is rarely the actual one. This tests whether they probe past the first answer.', false, 3),
  ('objection-1', 'objection', 'What''s the difference between a prospect who genuinely needs to think about it and one who''s already decided no but is being polite?', 'Anyone who has closed at volume can tell these apart instantly and treats them completely differently.', false, 1),
  ('objection-2', 'objection', '[Role-play] "₹45,000 is too expensive for me right now." — Respond exactly as you would on a live call.', 'Watch the first three seconds. Caving, apologising, or jumping straight to a payment plan are all tells.', false, 2),
  ('objection-3', 'objection', 'Which objection do you lose most deals to — and what have you changed about how you handle it?', 'Everyone loses to something. Claiming otherwise means they aren''t tracking or aren''t honest.', false, 3),
  ('closing-1', 'closing', 'At what point in a call do you know you''ve lost the deal — and what do you do in that moment?', 'Most interviewers never ask this. A closer who has done volume knows the exact moment a deal dies and has a recovery move.', false, 1),
  ('closing-2', 'closing', 'What are the exact words you use to ask for the payment? Say it to me the way you''d say it on a call.', 'Make them actually say it out loud. Hedging, over-explaining, or never quite asking are all visible here.', false, 2),
  ('closing-3', 'closing', 'After you ask for the close, how long do you stay silent?', 'Holding silence after the ask is a discipline most average closers cannot manage. The answer reveals real call experience.', false, 3),
  ('followup-1', 'followup', 'A prospect says "let me think about it" and ends the call. Walk me through every touch you make over the next 14 days — timing and channel.', 'Every JD across all nine clients flags follow-up. Ask for the actual sequence, not the intention.', false, 1),
  ('followup-2', 'followup', 'What do you say in follow-up #4 that you didn''t say in #1, #2 or #3?', 'Repeating "just checking in" four times is not follow-up. Each touch should carry a different angle.', false, 2),
  ('followup-3', 'followup', 'How many touches before you mark a lead dead — and what makes you decide that?', 'There''s no correct number. The reasoning is what matters. Stopping at two or three usually signals conflict avoidance.', false, 3),
  ('crm-1', 'crm', 'When in the day do you update your CRM — before the call, during, or after? Be specific.', 'A habit check, not a knowledge check. Batching at end of day is where leads get lost.', false, 1),
  ('crm-2', 'crm', 'If I opened your CRM from your last role and looked at a call note from three weeks ago, what would I find in it?', 'This is the question that separates people who log activity from people who log intelligence.', false, 2),
  ('crm-3', 'crm', 'What happens to a lead in your pipeline that hasn''t been touched in 3 weeks?', 'Tests whether they have a system or whether leads quietly rot in the pipeline.', false, 3),
  ('target-1', 'target', 'It''s the 20th of the month and you''re at 40% of target. What do you do differently for the next 10 days?', '"Work harder" is the wrong answer. You''re looking for someone who does the pipeline maths backwards from the gap.', false, 1),
  ('target-2', 'target', 'What was your close rate, average deal size, and monthly revenue in your last role?', 'Three numbers. A professional closer has all three. Team numbers instead of personal ones is a flag.', false, 2),
  ('target-3', 'target', 'How do you know on the 5th of the month whether you''re going to hit target or not?', 'Real target-driven closers forecast from leading indicators. Others find out on the 30th.', false, 3),
  ('ownership-1', 'ownership', 'When did you last notice your own numbers slipping before your manager brought it up — and what did you actually do that week?', 'The tell is not whether they take responsibility. It''s whether they caught it first. If a manager always flagged it, that''s a 0 regardless of how well they frame the rest.', false, 1),
  ('ownership-2', 'ownership', 'What did you track about your own performance that nobody asked you to track?', 'Owners build their own instruments. This is one of the cleanest ownership signals available.', false, 2),
  ('ownership-3', 'ownership', 'Tell me about a month you missed target. Whose fault was it?', 'Blunt on purpose. Listen for where the cause lands.', false, 3),
  ('eq-1', 'eq', 'Mid-call the prospect says "I need to discuss this with my wife." What do you do in the next 60 seconds?', 'Extremely common across EdTech, health and coaching. Passive acceptance here loses the deal.', false, 1),
  ('eq-2', 'eq', 'Have you ever chosen not to close someone you probably could have? What happened?', 'Closers with real EQ and integrity have this story and tell it without hesitation. "I always close" is not a strength.', false, 2),
  ('eq-3', 'eq', 'Tell me about a call where the prospect agreed with everything but you knew they weren''t going to buy. What were you picking up on?', 'Over-agreement is one of the most reliable false signals in high-ticket sales. Only experienced closers name it unprompted.', false, 3),
  ('coach-1', 'coach', 'What''s the last piece of feedback you got on your calls that stung? What did you do with it?', 'Real coachability needs a specific memory plus a specific action. "I''m always open to feedback" with no example is a 0.', false, 1),
  ('coach-2', 'coach', 'When did you last listen back to a recording of your own call — and what did you find?', 'Self-review is voluntary. Doing it unprompted is a strong signal.', false, 2),
  ('coach-3', 'coach', 'If I told you tomorrow that your discovery is the weakest part of your call — what happens next in this conversation?', 'Watch the immediate reaction, not the words. Defensiveness shows up in the first sentence.', false, 3),
  ('pressure-1', 'pressure', '[Role-play] "Honestly, I''ve been burned by programs like this before. Why should I trust you?" — Respond live.', 'Deliver it with some edge. Watch whether they get defensive, oversell, or stay calm and turn it into discovery.', false, 1),
  ('pressure-2', 'pressure', 'Tell me about the most aggressive prospect you''ve handled. What did they do, and what did you say?', 'Everyone who has done volume has one of these. No example usually means low call exposure.', false, 2),
  ('pressure-3', 'pressure', 'When a prospect goes cold mid-call, what do you do?', 'The good answer usually involves naming the shift out loud rather than pushing through it.', false, 3),
  ('intent-1', 'intent', 'What would make you turn this offer down, even if it came through?', 'This is the desperation filter. "Nothing, I really want this" is the answer you''re screening against — it''s the profile that deflates after the offer.', false, 1),
  ('intent-2', 'intent', 'What specifically about this role made you apply — not sales in general, this role?', 'Genuine candidates researched. Desperate candidates applied everywhere and can''t distinguish this one.', false, 2),
  ('intent-3', 'intent', 'What do you want to know about this role that I haven''t told you?', 'Save for the end. Confident candidates evaluate you back and ask questions with edge. Softballs designed to sound interested are the flag.', false, 3),
  ('consistency-1', 'consistency', 'How does your energy in month 1 of a new job compare to month 4? Be honest.', '"I''m exactly the same always" is either no self-awareness or a rehearsed answer. Honest admission plus a management strategy is what you want.', false, 1),
  ('consistency-2', 'consistency', 'What does a bad day look like for you at work — specifically — and what do you actually do about it?', 'Performed candidates describe a polished version of struggle. Real ones describe something specific and unglamorous.', false, 2),
  ('consistency-3', 'consistency', 'How did their output and energy in month 1 compare to month 4 of working with you?', 'Put this to the previous manager, not the candidate. The gap between month 1 and month 4 is the tell that catches the interview-face problem.', true, 3),
  ('longevity-1', 'longevity', 'Walk me through your last three roles — how long at each, and why did you leave each one?', 'Look for the pattern, not the reasons. Short tenures with consistently external explanations is the profile that quits on you in month three.', false, 1),
  ('longevity-2', 'longevity', 'Tell me about your worst 2–3 months in a sales role. What did you do during that stretch?', 'This is where quitters reveal themselves. Listen for whether they pushed through or started applying elsewhere.', false, 2),
  ('longevity-3', 'longevity', 'Would you rehire them? And did they ever indicate they were looking elsewhere?', 'Put this to the previous manager. Hesitation on the rehire question tells you more than the answer itself.', true, 3)
on conflict (id) do update set
  attribute_id = excluded.attribute_id, prompt = excluded.prompt, hint = excluded.hint,
  is_reference = excluded.is_reference, sort_order = excluded.sort_order;

insert into ask_options (question_id, score, label, description) values
  ('dialing-1', 0, 'Doesn''t know', 'Can''t give a number, or answers "as many as it takes." Has not tracked this.'),
  ('dialing-1', 1, 'Round number only', 'Gives a suspiciously clean figure with no connect rate behind it.'),
  ('dialing-1', 2, 'Knows dials, vague on connects', 'Solid dial number, approximate connect rate, can''t explain what moved it.'),
  ('dialing-1', 3, 'Knows both cold', 'Specific on both, and can explain what changed the connect rate — time of day, lead source, list age.'),
  ('dialing-2', 0, 'Calls tomorrow', 'Would leave it for the next morning. No sense that the lead is decaying.'),
  ('dialing-2', 1, 'Calls now, no reason', 'Says they''d call immediately but can''t explain why it matters.'),
  ('dialing-2', 2, 'Understands urgency', 'Calls now, knows warm leads go cold fast, but talks about it generally.'),
  ('dialing-2', 3, 'Knows the decay curve', 'Calls immediately and can articulate how sharply contact rates drop by the hour or day.'),
  ('dialing-3', 0, '"Doesn''t affect me"', 'Claims total immunity. Either untrue or they haven''t done real volume.'),
  ('dialing-3', 1, 'Admits it, no fix', 'Honest that it lands, but has no way of resetting.'),
  ('dialing-3', 2, 'Vague reset', 'Mentions taking a break or refocusing, but nothing concrete.'),
  ('dialing-3', 3, 'Specific routine', 'Honest about the effect and names an actual reset — a walk, a call review, a scripted first line.'),
  ('discovery-1', 0, 'No read', '"You can never really tell" or "I stay positive on every call." No signals named.'),
  ('discovery-1', 1, 'One vague signal', 'Mentions tone or interest level, nothing beyond that.'),
  ('discovery-1', 2, 'Real signals, no action', 'Names two or three genuine signals but can''t say what they do differently.'),
  ('discovery-1', 3, 'Reads and adapts', 'Specific signals — response latency, whether they ask questions back, how they answer the first open question — plus what they change because of it.'),
  ('discovery-2', 0, 'No such question', 'Doesn''t have one, or offers "what are you looking for?"'),
  ('discovery-2', 1, 'Has one, thin reason', 'Names a question but the reasoning is surface-level.'),
  ('discovery-2', 2, 'Good question, partial reason', 'Solid question, explains roughly what it gives them.'),
  ('discovery-2', 3, 'Question plus reasoning', 'Specific question and a clear account of what it unlocks — budget, urgency, decision authority, or real motivation.'),
  ('discovery-3', 0, 'Takes it at face value', 'Assumes the stated problem is the real problem.'),
  ('discovery-3', 1, 'Says they dig, no method', 'Claims to go deeper but can''t describe how.'),
  ('discovery-3', 2, 'Has a probe', 'Describes one technique for going a layer down.'),
  ('discovery-3', 3, 'Layered probing', 'Clear method — asking what they''ve already tried, what happens if nothing changes, why now — and knows what a real answer sounds like.'),
  ('objection-1', 0, 'No distinction', 'Treats both the same, or says you can''t tell.'),
  ('objection-1', 1, 'Senses a difference', 'Knows there''s a difference but can''t articulate the signals.'),
  ('objection-1', 2, 'Names the signals', 'Describes how the two sound different but handles them similarly.'),
  ('objection-1', 3, 'Different signals, different play', 'Clear behavioural distinctions and a genuinely different response to each.'),
  ('objection-2', 0, 'Caves', 'Offers a discount, apologises for the price, or gets visibly uncomfortable.'),
  ('objection-2', 1, 'Jumps to EMI', 'Goes straight to payment plans without exploring what "expensive" means.'),
  ('objection-2', 2, 'Acknowledges, partial reframe', 'Handles it calmly, reframes value, but doesn''t dig into the objection.'),
  ('objection-2', 3, 'Probes then reframes', 'Acknowledges, asks what expensive means relative to what, reframes against cost of inaction, holds price.'),
  ('objection-3', 0, '"I don''t lose deals"', 'Deflects the premise. Not tracking losses, or not honest.'),
  ('objection-3', 1, 'Names one, no change', 'Identifies an objection but hasn''t done anything about it.'),
  ('objection-3', 2, 'Named, vague fix', 'Names it and describes a general improvement.'),
  ('objection-3', 3, 'Named, specific iteration', 'Specific objection, specific change they made to how they handle it, and what happened after.'),
  ('closing-1', 0, 'Never gives up', '"I never think I''ve lost it." Sounds positive, means they can''t read a call.'),
  ('closing-1', 1, 'Knows after', 'Only realises the deal died in hindsight.'),
  ('closing-1', 2, 'Reads it live', 'Can name the moment but has no recovery move.'),
  ('closing-1', 3, 'Reads it and acts', 'Names the specific moment and has a real move — calling out the shift, resetting to discovery, asking directly what changed.'),
  ('closing-2', 0, 'Never actually asks', 'Trails off, describes the ask instead of making it, or waits for the prospect to offer.'),
  ('closing-2', 1, 'Hedged', 'Asks but apologetically — "if you''re comfortable", "no pressure at all".'),
  ('closing-2', 2, 'Clear but padded', 'Direct enough, but wrapped in unnecessary explanation.'),
  ('closing-2', 3, 'Clean and direct', 'Says it plainly and confidently, then stops talking.'),
  ('closing-3', 0, 'Doesn''t get it', 'Doesn''t understand the question, or fills the silence straight away.'),
  ('closing-3', 1, 'Knows but can''t hold it', 'Knows silence matters, admits they talk through it.'),
  ('closing-3', 2, 'Holds briefly', 'Waits a moment, but breaks before the prospect does.'),
  ('closing-3', 3, 'Holds it fully', 'Understands the discipline, has held it, and can explain why the first to speak usually concedes.'),
  ('followup-1', 0, 'No sequence', '"I''d call in a few days." No structure at all.'),
  ('followup-1', 1, 'Two or three touches', 'A few follow-ups, no timing logic or channel variation.'),
  ('followup-1', 2, 'Has a cadence', 'Real sequence with timing, but the same message each time.'),
  ('followup-1', 3, 'Structured multi-touch', 'Specific sequence across channels with distinct timing, and a reason behind the spacing.'),
  ('followup-2', 0, 'Same message', '"Just checking in" every time.'),
  ('followup-2', 1, 'Minor variation', 'Slightly different wording, same substance.'),
  ('followup-2', 2, 'Some new angles', 'A couple of touches carry new information.'),
  ('followup-2', 3, 'Every touch distinct', 'Each one has its own angle — new proof, a different objection addressed, a changed frame, a clean break-up message.'),
  ('followup-3', 0, 'Two or three', 'Stops early, often citing not wanting to annoy people.'),
  ('followup-3', 1, 'Number, no reason', 'Gives a figure with no logic behind it.'),
  ('followup-3', 2, 'Reasonable number', 'A sensible count with rough reasoning.'),
  ('followup-3', 3, 'Criteria-based', 'Doesn''t work purely to a count — decides on signals, and persists well beyond the average.'),
  ('crm-1', 0, 'End of day or later', '"When I get time." Batches it, or does it inconsistently.'),
  ('crm-1', 1, 'After, but batched', 'Updates after calls, but in clusters rather than immediately.'),
  ('crm-1', 2, 'After each call', 'Updates immediately, mostly consistent.'),
  ('crm-1', 3, 'Immediate, non-negotiable', 'Straight after every call without exception, and can explain why the delay costs deals.'),
  ('crm-2', 0, 'Nothing useful', 'Empty, or just "called, not interested."'),
  ('crm-2', 1, 'Bare minimum', 'Status only. No context.'),
  ('crm-2', 2, 'Decent notes', 'Objection and next step captured.'),
  ('crm-2', 3, 'Rich and usable', 'Objection raised, exact wording, personal context, agreed next step and date. Someone else could pick up the call cold.'),
  ('crm-3', 0, 'Nothing', 'It just sits there. No process.'),
  ('crm-3', 1, 'Eventually revisits', 'Says they''d get to it at some point.'),
  ('crm-3', 2, 'Has a habit', 'Reviews stale leads periodically, informally.'),
  ('crm-3', 3, 'Systematic', 'Defined reactivation sequence, stage change, or a scheduled sweep. Nothing goes stale unnoticed.'),
  ('target-1', 0, 'Work harder', 'More calls, more effort. No maths, no prioritisation.'),
  ('target-1', 1, 'Tactical tweak', 'Some adjustment, but no sense of what the gap actually requires.'),
  ('target-1', 2, 'Partial maths', 'Works out roughly how many closes are needed.'),
  ('target-1', 3, 'Works backwards', 'Calculates conversations needed at their close rate, identifies which leads to prioritise, and changes their day accordingly.'),
  ('target-2', 0, 'None of them', 'Can''t answer, or only quotes team figures.'),
  ('target-2', 1, 'One of three', 'Knows one number, approximately.'),
  ('target-2', 2, 'Two of three', 'Solid on two, vague on the third.'),
  ('target-2', 3, 'All three, plus trend', 'All three specifically, and knows how they moved over time and why.'),
  ('target-3', 0, 'Finds out at month end', 'No forward view at all.'),
  ('target-3', 1, 'Gut feel', 'Rough instinct, no numbers behind it.'),
  ('target-3', 2, 'Tracks pipeline', 'Watches pipeline volume but doesn''t convert it to a forecast.'),
  ('target-3', 3, 'Forecasts properly', 'Knows required pipeline coverage and tracks leading indicators to call the month early.'),
  ('ownership-1', 0, 'Manager always flagged it', 'Only ever course-corrected after being told.'),
  ('ownership-1', 1, 'Noticed late', 'Spotted it eventually, but around the same time as the manager.'),
  ('ownership-1', 2, 'Caught it, needed help', 'Noticed first but needed someone else to diagnose the cause.'),
  ('ownership-1', 3, 'Caught and corrected alone', 'Spotted it early, diagnosed the specific cause themselves, and changed something concrete that week.'),
  ('ownership-2', 0, 'Nothing', 'Only tracked what the company required.'),
  ('ownership-2', 1, 'One thing, loosely', 'Kept a rough personal note on something.'),
  ('ownership-2', 2, 'Real self-tracking', 'Tracked something of their own with a clear purpose.'),
  ('ownership-2', 3, 'Built their own system', 'Specific self-built tracking, a clear reason for it, and evidence they acted on what it showed.'),
  ('ownership-3', 0, 'External', 'Leads, product, market, pricing, manager. Never them.'),
  ('ownership-3', 1, 'Hedged', 'Splits it — some external, some theirs, without committing.'),
  ('ownership-3', 2, 'Owns it broadly', 'Takes responsibility but stays general about what they got wrong.'),
  ('ownership-3', 3, 'Owns the specific', 'Names the exact thing they did or failed to do, without prompting.'),
  ('eq-1', 0, 'Accepts and exits', '"Sure, I''ll follow up." Loses the room.'),
  ('eq-1', 1, 'Pushes back weakly', 'Tries to keep going but with no stakeholder strategy.'),
  ('eq-1', 2, 'Explores a little', 'Asks a question or two about the spouse''s likely concerns.'),
  ('eq-1', 3, 'Works the stakeholder', 'Finds out who actually decides, surfaces what her objection would be, and either gets her on the call or arms the prospect to handle it.'),
  ('eq-2', 0, '"I always close"', 'Rejects the premise. Aggression, not integrity.'),
  ('eq-2', 1, 'Vague hypothetical', 'Says they would, but has no actual instance.'),
  ('eq-2', 2, 'Has an example', 'Real story, reasoning is thin.'),
  ('eq-2', 3, 'Specific and clear', 'Concrete situation, clear reasoning about fit, no regret about the decision.'),
  ('eq-3', 0, 'Doesn''t happen', 'Can''t recall an instance, or takes agreement at face value.'),
  ('eq-3', 1, 'General sense', 'Vague feeling, no named signals.'),
  ('eq-3', 2, 'Names one signal', 'Identifies something specific, but limited.'),
  ('eq-3', 3, 'Reads the pattern', 'Names it clearly — no questions asked back, agreeing too fast, deflecting on specifics — and what they did about it.'),
  ('coach-1', 0, 'No example', 'Can''t recall any hard feedback, or claims never to have received it.'),
  ('coach-1', 1, 'Recalls, no action', 'Remembers the feedback but nothing changed.'),
  ('coach-1', 2, 'Acted on it', 'Specific feedback and a general change in response.'),
  ('coach-1', 3, 'Feedback → change → result', 'Names the feedback, the exact change, and what happened to their numbers after.'),
  ('coach-2', 0, 'Never', 'Has not done this, or only when forced.'),
  ('coach-2', 1, 'When required', 'Only in formal review sessions.'),
  ('coach-2', 2, 'Occasionally', 'Does it sometimes, has a rough takeaway.'),
  ('coach-2', 3, 'Regular habit', 'Reviews their own calls by choice and can name something specific they caught and fixed.'),
  ('coach-3', 0, 'Defends', 'Justifies, explains why that''s not accurate, or pushes back before hearing more.'),
  ('coach-3', 1, 'Accepts flatly', 'Takes it politely with no curiosity or follow-up.'),
  ('coach-3', 2, 'Asks a question', 'Accepts and asks something, but doesn''t drive toward a fix.'),
  ('coach-3', 3, 'Goes after it', 'Wants the specific calls, asks for examples, moves straight to what to change.'),
  ('pressure-1', 0, 'Defensive or oversells', 'Argues, over-explains, or starts making promises to compensate.'),
  ('pressure-1', 1, 'Rattled but recovers', 'Visibly thrown, gets there eventually.'),
  ('pressure-1', 2, 'Composed, scripted', 'Calm and reasonable, but clearly a rehearsed line.'),
  ('pressure-1', 3, 'Calm and curious', 'Acknowledges without flinching, doesn''t oversell, turns it into a question about what went wrong last time.'),
  ('pressure-2', 0, 'No example', 'Can''t recall one, or avoids these calls.'),
  ('pressure-2', 1, 'Lost the frame', 'Has an example but conceded or ended the call badly.'),
  ('pressure-2', 2, 'Held, no technique', 'Stayed composed but can''t say how.'),
  ('pressure-2', 3, 'Held with intent', 'Kept control, names the specific technique, and can say what happened to the deal.'),
  ('pressure-3', 0, 'Keeps pitching', 'Doesn''t notice, or carries on regardless.'),
  ('pressure-3', 1, 'Notices, no move', 'Registers the change but has no response.'),
  ('pressure-3', 2, 'Slows down', 'Adjusts pace or backs off slightly.'),
  ('pressure-3', 3, 'Re-anchors', 'Calls the shift out directly, asks what changed, and resets the call rather than pushing.'),
  ('intent-1', 0, '"Nothing"', 'Can''t name a single condition. Wants the offer more than the role.'),
  ('intent-1', 1, 'Generic', 'Salary or location only. No thought about fit.'),
  ('intent-1', 2, 'One real condition', 'Names something genuine about how they work.'),
  ('intent-1', 3, 'Honest and specific', 'Clear, considered condition that reveals what they actually need to perform. Comfortable saying it out loud.'),
  ('intent-2', 0, 'Generic', '"I love sales", "great opportunity", "want to grow." Could be any job.'),
  ('intent-2', 1, 'Surface detail', 'Repeats something from the JD without engaging with it.'),
  ('intent-2', 2, 'Some specificity', 'Names a real aspect — the domain, the ticket size, the lead structure.'),
  ('intent-2', 3, 'Clearly researched', 'Specific to this client type or offer, and connects it to how they work best.'),
  ('intent-3', 0, 'No questions', 'Nothing to ask, or purely polite noises.'),
  ('intent-3', 1, 'Softballs', '"What does success look like?" — designed to sound engaged, not to learn anything.'),
  ('intent-3', 2, 'Reasonable questions', 'Fair questions about the role, no real edge.'),
  ('intent-3', 3, 'Pointed', 'Asks about lead quality, realistic close rates, ramp expectations, or why the last person left. Pushes back a little.'),
  ('consistency-1', 0, '"Always the same"', 'Claims perfect consistency. No self-awareness, or performing.'),
  ('consistency-1', 1, 'Admits a dip, no plan', 'Honest that it changes, has no way of handling it.'),
  ('consistency-1', 2, 'Aware, loose plan', 'Recognises the pattern and has a rough approach.'),
  ('consistency-1', 3, 'Honest and managed', 'Candid about the dip and names a specific way they manage through it.'),
  ('consistency-2', 0, '"I don''t have bad days"', 'Denies them, or "I just push through" with nothing behind it.'),
  ('consistency-2', 1, 'Vague', 'Describes a bad day generically, coping mechanism is a platitude.'),
  ('consistency-2', 2, 'Specific day, loose fix', 'Real description of a bad day, rough approach to it.'),
  ('consistency-2', 3, 'Specific and real', 'Concrete, unpolished description plus an actual routine they use to reset.'),
  ('consistency-3', 0, 'Clear drop-off', 'Manager describes a visible decline once the candidate settled in.'),
  ('consistency-3', 1, 'Noticeable dip', 'Some falling away, or the manager hedges heavily.'),
  ('consistency-3', 2, 'Mostly steady', 'Broadly consistent with minor variation.'),
  ('consistency-3', 3, 'Steady or improving', 'Output held or grew over time. Manager is unhesitating about it.'),
  ('longevity-1', 0, 'Serial short stints', 'Multiple exits under 12 months, every reason external — bad leads, bad manager, bad company.'),
  ('longevity-1', 1, 'Short, mixed reasons', 'Short tenures, but some reasons are fair.'),
  ('longevity-1', 2, 'Mixed tenure', 'At least one decent stint alongside shorter ones.'),
  ('longevity-1', 3, 'Real commitment history', 'At least one 18+ month stint, and can describe what they actually built in that time.'),
  ('longevity-2', 0, 'Left or never had one', 'Started looking elsewhere, or claims they''ve never had a bad stretch.'),
  ('longevity-2', 1, 'Stayed passively', 'Waited it out, did nothing differently.'),
  ('longevity-2', 2, 'Stayed and tried', 'Stuck with it, made some effort to change things.'),
  ('longevity-2', 3, 'Fought through it', 'Stayed, took specific action, and can describe exactly how they came out the other side.'),
  ('longevity-3', 0, 'No', 'Wouldn''t rehire, or confirms the candidate was actively looking while employed.'),
  ('longevity-3', 1, 'Hedges', 'Noticeable hesitation, or qualifies the answer heavily.'),
  ('longevity-3', 2, 'Qualified yes', 'Would rehire with some caveats.'),
  ('longevity-3', 3, 'Unhesitating yes', 'Clear yes, no flight signals during their time there.')
on conflict (question_id, score) do update set
  label = excluded.label, description = excluded.description;
-- ── 5. The seed above was extracted, not typed. See the header. ──────────

-- ── 6. Serving the bank ────────────────────────────────────────────────────
-- R1 serves the five priority attributes, R2 serves all fourteen. One bank, one
-- scoring rule; the round decides scope. The standalone tool filtered on exactly
-- this flag, so R1 stays the same 15 questions it has always been.
create or replace function get_ask_bank(p_round text default 'r2')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_ask_bank: staff only'; end if;
  if p_round not in ('r1', 'r2') then raise exception 'Round must be r1 or r2.'; end if;

  return jsonb_build_object(
    'round', p_round,
    'bank_revision', (select bank_revision from ask_bank_meta),
    'sections', jsonb_build_object(
      'sell', 'Can they actually sell?',
      'sustain', 'Can they sustain it?',
      'who', 'Who are they underneath?'),
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'section', a.section, 'name', a.name, 'priority', a.priority,
        'skills', a.skills, 'knowledge', a.knowledge,
        'questions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', q.id, 'prompt', q.prompt, 'hint', q.hint,
            'is_reference', q.is_reference,
            'options', (
              select jsonb_agg(jsonb_build_object(
                'score', o.score, 'label', o.label, 'description', o.description)
                order by o.score)
              from ask_options o where o.question_id = q.id))
            order by q.sort_order), '[]'::jsonb)
          from ask_questions q where q.attribute_id = a.id and q.active))
      order by a.sort_order)
      from ask_attributes a
      where a.active and (p_round = 'r2' or a.priority)), '[]'::jsonb));
end $$;

grant execute on function get_ask_bank(text) to authenticated;

-- ── 7. Running one ─────────────────────────────────────────────────────────
create or replace function start_ask(p_candidate_id uuid, p_round text,
                                     p_client_context text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_staff uuid; v_name text; v_new boolean := false;
begin
  if not is_staff() then raise exception 'start_ask: staff only'; end if;
  if p_round not in ('r1', 'r2') then raise exception 'Round must be r1 or r2.'; end if;

  select full_name into v_name from candidates where id = p_candidate_id;
  if v_name is null then raise exception 'No such candidate.'; end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  -- Resume the open one if there is one. A dropped call mid-interview is the
  -- normal case, not the exception.
  select id into v_id from ask_scorecards
  where candidate_id = p_candidate_id and round = p_round and submitted_at is null;

  if v_id is null then
    insert into ask_scorecards (candidate_id, round, interviewer_id, client_context,
                                bank_revision)
    values (p_candidate_id, p_round, v_staff, nullif(btrim(p_client_context), ''),
            (select bank_revision from ask_bank_meta))
    returning id into v_id;
    v_new := true;
  elsif p_client_context is not null then
    update ask_scorecards set client_context = nullif(btrim(p_client_context), '')
    where id = v_id;
  end if;

  return jsonb_build_object(
    'scorecard_id', v_id, 'resumed', not v_new,
    'candidate', v_name, 'round', p_round,
    'answered', coalesce((
      select jsonb_object_agg(question_id, jsonb_build_object('score', score, 'note', note))
      from ask_scores where scorecard_id = v_id), '{}'::jsonb));
end $$;

grant execute on function start_ask(uuid, text, text) to authenticated;

create or replace function save_ask_score(p_scorecard uuid, p_question text,
                                          p_score int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub timestamptz; v_prompt text; v_label text;
begin
  if not is_staff() then raise exception 'save_ask_score: staff only'; end if;

  select submitted_at into v_sub from ask_scorecards where id = p_scorecard;
  if not found then raise exception 'No such scorecard.'; end if;
  if v_sub is not null then
    raise exception 'This scorecard was submitted on %. Run the round again rather '
                    'than editing a finished one.', to_char(v_sub, 'DD Mon YYYY');
  end if;

  select prompt into v_prompt from ask_questions where id = p_question and active;
  if v_prompt is null then raise exception 'No such question: %', p_question; end if;

  select label into v_label from ask_options
  where question_id = p_question and score = p_score;
  if v_label is null then
    raise exception 'Score % is not one of the four anchors on %.', p_score, p_question;
  end if;

  insert into ask_scores (scorecard_id, question_id, score, note, question_text, option_label)
  values (p_scorecard, p_question, p_score, nullif(btrim(p_note), ''), v_prompt, v_label)
  on conflict (scorecard_id, question_id) do update set
    score = excluded.score, note = excluded.note,
    question_text = excluded.question_text, option_label = excluded.option_label,
    answered_at = now();
end $$;

grant execute on function save_ask_score(uuid, text, int, text) to authenticated;

-- ── 8. Freezing it ─────────────────────────────────────────────────────────
-- Totals are computed once and stored. The bank is editable, so a total derived
-- on every read would drift the day somebody rewords a question — the same
-- reasoning as the frozen predictors in sql/13.
create or replace function submit_ask(p_scorecard uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_card ask_scorecards; v_missing int; v_refs int;
  v_total int; v_max int; v_attrs jsonb;
begin
  if not is_staff() then raise exception 'submit_ask: staff only'; end if;
  select * into v_card from ask_scorecards where id = p_scorecard;
  if v_card.id is null then raise exception 'No such scorecard.'; end if;
  if v_card.submitted_at is not null then
    raise exception 'Already submitted on %.', to_char(v_card.submitted_at, 'DD Mon YYYY');
  end if;

  -- Everything in scope except the reference questions, which are asked of a
  -- previous manager and may land days later.
  select count(*) into v_missing
  from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and not q.is_reference
    and (v_card.round = 'r2' or a.priority)
    and not exists (select 1 from ask_scores s
                     where s.scorecard_id = p_scorecard and s.question_id = q.id);

  if v_missing > 0 then
    raise exception '% question(s) still unanswered. Score them, or use the '
                    'skip control — a blank is not a zero.', v_missing;
  end if;

  select count(*) into v_refs
  from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and q.is_reference
    and (v_card.round = 'r2' or a.priority)
    and not exists (select 1 from ask_scores s
                     where s.scorecard_id = p_scorecard and s.question_id = q.id);

  -- Per attribute, then the whole. Stored, never re-derived.
  select jsonb_agg(x order by x->>'sort'), sum((x->>'score')::int), sum((x->>'max')::int)
    into v_attrs, v_total, v_max
  from (
    select jsonb_build_object(
      'id', a.id, 'name', a.name, 'section', a.section, 'priority', a.priority,
      'sort', lpad(a.sort_order::text, 3, '0'),
      'score', coalesce(sum(s.score), 0),
      'max', count(q.id) * 3,
      'unscored', count(q.id) filter (where s.question_id is null)) as x
    from ask_attributes a
    join ask_questions q on q.attribute_id = a.id and q.active
    left join ask_scores s on s.scorecard_id = p_scorecard and s.question_id = q.id
    where a.active and (v_card.round = 'r2' or a.priority)
    group by a.id, a.name, a.section, a.priority, a.sort_order) t;

  update ask_scorecards set
    submitted_at = now(), total = v_total, max_total = v_max,
    pct = round(v_total::numeric / nullif(v_max, 0) * 100, 1),
    attributes = v_attrs
  where id = p_scorecard;

  return jsonb_build_object('submitted', true, 'total', v_total, 'max_total', v_max,
    'pct', round(v_total::numeric / nullif(v_max, 0) * 100, 1),
    'outstanding_refs', v_refs,
    'note', case when v_refs > 0
      then v_refs || ' reference question(s) still to put to their previous manager. '
           || 'The scorecard reads as incomplete until those are scored.'
      else null end);
end $$;

grant execute on function submit_ask(uuid) to authenticated;

-- A reference answer arrives after submit, by design. It updates the frozen
-- totals — the only edit a submitted scorecard accepts, and only for the two
-- questions that were never the candidate's to answer.
create or replace function score_ask_reference(p_scorecard uuid, p_question text,
                                               p_score int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref boolean; v_prompt text; v_label text; v_total int; v_max int; v_attrs jsonb;
declare v_round text;
begin
  if not is_staff() then raise exception 'score_ask_reference: staff only'; end if;

  select is_reference, prompt into v_ref, v_prompt from ask_questions where id = p_question;
  if v_prompt is null then raise exception 'No such question: %', p_question; end if;
  if not v_ref then
    raise exception 'Only the reference questions can be scored after submitting.';
  end if;

  select round into v_round from ask_scorecards where id = p_scorecard;
  if v_round is null then raise exception 'No such scorecard.'; end if;

  select label into v_label from ask_options where question_id = p_question and score = p_score;
  if v_label is null then raise exception 'Score % is not an anchor on %.', p_score, p_question; end if;

  insert into ask_scores (scorecard_id, question_id, score, note, question_text, option_label)
  values (p_scorecard, p_question, p_score, nullif(btrim(p_note), ''), v_prompt, v_label)
  on conflict (scorecard_id, question_id) do update set
    score = excluded.score, note = excluded.note, answered_at = now();

  select jsonb_agg(x order by x->>'sort'), sum((x->>'score')::int), sum((x->>'max')::int)
    into v_attrs, v_total, v_max
  from (
    select jsonb_build_object(
      'id', a.id, 'name', a.name, 'section', a.section, 'priority', a.priority,
      'sort', lpad(a.sort_order::text, 3, '0'),
      'score', coalesce(sum(s.score), 0), 'max', count(q.id) * 3,
      'unscored', count(q.id) filter (where s.question_id is null)) as x
    from ask_attributes a
    join ask_questions q on q.attribute_id = a.id and q.active
    left join ask_scores s on s.scorecard_id = p_scorecard and s.question_id = q.id
    where a.active and (v_round = 'r2' or a.priority)
    group by a.id, a.name, a.section, a.priority, a.sort_order) t;

  update ask_scorecards set total = v_total, max_total = v_max,
    pct = round(v_total::numeric / nullif(v_max, 0) * 100, 1), attributes = v_attrs
  where id = p_scorecard;

  return jsonb_build_object('total', v_total, 'max_total', v_max,
    'pct', round(v_total::numeric / nullif(v_max, 0) * 100, 1));
end $$;

grant execute on function score_ask_reference(uuid, text, int, text) to authenticated;

-- ── 9. Reading one back ────────────────────────────────────────────────────
create or replace function get_ask_scorecard(p_scorecard uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_staff() then raise exception 'get_ask_scorecard: staff only'; end if;

  select jsonb_build_object(
    'id', c.id, 'candidate_id', c.candidate_id, 'candidate', cand.full_name,
    'round', c.round, 'interviewer', st.full_name,
    'client_context', c.client_context, 'conducted_on', c.conducted_on,
    'started_at', c.started_at, 'submitted_at', c.submitted_at,
    'bank_revision', c.bank_revision,
    'total', c.total, 'max_total', c.max_total, 'pct', c.pct,
    'attributes', c.attributes,
    'outstanding_refs', (
      select count(*) from ask_questions q
      join ask_attributes a on a.id = q.attribute_id
      where q.is_reference and q.active and a.active
        and (c.round = 'r2' or a.priority)
        and not exists (select 1 from ask_scores s
                         where s.scorecard_id = c.id and s.question_id = q.id)),
    -- The answers as they were given, against the wording they were given
    -- against. Never re-joined to the live bank.
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', s.question_id, 'question', s.question_text,
        'score', s.score, 'chose', s.option_label, 'note', s.note,
        'attribute', q.attribute_id, 'is_reference', q.is_reference)
      order by a2.sort_order, q.sort_order)
      from ask_scores s
      join ask_questions q on q.id = s.question_id
      join ask_attributes a2 on a2.id = q.attribute_id
      where s.scorecard_id = c.id), '[]'::jsonb))
  into v
  from ask_scorecards c
  join candidates cand on cand.id = c.candidate_id
  left join staff st on st.id = c.interviewer_id
  where c.id = p_scorecard;

  if v is null then raise exception 'No such scorecard.'; end if;
  return v;
end $$;

grant execute on function get_ask_scorecard(uuid) to authenticated;

-- Everything ASK knows about one candidate, newest round first.
create or replace function get_candidate_ask(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_candidate_ask: staff only'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'round', c.round, 'interviewer', st.full_name,
      'client_context', c.client_context, 'conducted_on', c.conducted_on,
      'submitted_at', c.submitted_at,
      'total', c.total, 'max_total', c.max_total, 'pct', c.pct,
      'attributes', c.attributes,
      'sections', case when c.attributes is null then null else (
        select jsonb_object_agg(x->>'section', jsonb_build_object(
                 'score', (x->>'score')::int, 'max', (x->>'max')::int))
        from (select jsonb_build_object(
                'section', a->>'section',
                'score', sum((a->>'score')::int),
                'max', sum((a->>'max')::int)) as x
              from jsonb_array_elements(c.attributes) a
              group by a->>'section') s) end,
      'outstanding_refs', (
        select count(*) from ask_questions q
        join ask_attributes at2 on at2.id = q.attribute_id
        where q.is_reference and q.active and at2.active
          and (c.round = 'r2' or at2.priority)
          and not exists (select 1 from ask_scores s2
                           where s2.scorecard_id = c.id and s2.question_id = q.id)))
    order by c.submitted_at desc nulls first, c.started_at desc)
    from ask_scorecards c
    left join staff st on st.id = c.interviewer_id
    where c.candidate_id = p_candidate_id), '[]'::jsonb);
end $$;

grant execute on function get_candidate_ask(uuid) to authenticated;

-- ── 10. Nothing already run is lost ────────────────────────────────────────
-- The standalone tool exported a JSON file per interview. Those are somebody's
-- real judgement about a real candidate, and retiring the tool must not throw
-- them away. This loads one back in, matched on question text rather than id,
-- because the export never carried ids.
create or replace function import_ask_json(p_candidate_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round text; v_card uuid; v_staff uuid; a jsonb; q jsonb;
  v_qid text; v_matched int := 0; v_skipped text[] := '{}'; v_label text;
begin
  if not is_staff() then raise exception 'import_ask_json: staff only'; end if;
  if not exists (select 1 from candidates where id = p_candidate_id) then
    raise exception 'No such candidate.';
  end if;

  v_round := lower(coalesce(p_payload->>'round', 'r2'));
  if v_round not in ('r1', 'r2') then
    raise exception 'The file says round "%", which is neither R1 nor R2.', p_payload->>'round';
  end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  insert into ask_scorecards (candidate_id, round, interviewer_id, client_context,
                              conducted_on, bank_revision)
  values (p_candidate_id, v_round, v_staff,
          nullif(btrim(p_payload->'meta'->>'client'), ''),
          coalesce((p_payload->'meta'->>'date')::date, current_date),
          (select bank_revision from ask_bank_meta))
  returning id into v_card;

  for a in select * from jsonb_array_elements(coalesce(p_payload->'attributes', '[]'::jsonb)) loop
    for q in select * from jsonb_array_elements(coalesce(a->'questions', '[]'::jsonb)) loop
      if q->>'score' is null then continue; end if;

      -- Match on the question text. An export from a version whose wording has
      -- since changed will not match, and that is reported rather than guessed
      -- at — a mis-matched answer is worse than a missing one.
      select id into v_qid from ask_questions where prompt = q->>'question';
      if v_qid is null then
        v_skipped := array_append(v_skipped, left(q->>'question', 60));
        continue;
      end if;

      select label into v_label from ask_options
      where question_id = v_qid and score = (q->>'score')::int;

      insert into ask_scores (scorecard_id, question_id, score, note, question_text, option_label)
      values (v_card, v_qid, (q->>'score')::int, nullif(btrim(q->>'notes'), ''),
              q->>'question', coalesce(v_label, '(imported)'))
      on conflict (scorecard_id, question_id) do nothing;
      v_matched := v_matched + 1;
    end loop;
  end loop;

  if v_matched = 0 then
    delete from ask_scorecards where id = v_card;
    raise exception 'Nothing in that file matched the current question bank. '
                    'It may be an export from a different scorecard.';
  end if;

  perform submit_ask(v_card);

  return jsonb_build_object('scorecard_id', v_card, 'round', v_round,
    'imported', v_matched, 'unmatched', coalesce(array_length(v_skipped, 1), 0),
    'unmatched_questions', to_jsonb(v_skipped),
    'total', (select total from ask_scorecards where id = v_card),
    'max_total', (select max_total from ask_scorecards where id = v_card));
end $$;

grant execute on function import_ask_json(uuid, jsonb) to authenticated;

-- ── Assertions ─────────────────────────────────────────────────────────────
-- The same counts the extractor asserted against the source file. If a seed
-- edit ever drops a question, this is where it stops.
do $$
declare v int; v_bad text;
begin
  select count(*) into v from ask_attributes where active;
  if v <> 14 then raise exception 'expected 14 ASK attributes, found %', v; end if;

  select count(*) into v from ask_attributes where active and priority;
  if v <> 5 then raise exception 'expected 5 priority attributes (the R1 set), found %', v; end if;

  select count(*) into v from ask_questions where active;
  if v <> 42 then raise exception 'expected 42 ASK questions, found %', v; end if;

  select count(*) into v from ask_questions where active and is_reference;
  if v <> 2 then raise exception 'expected 2 reference questions, found %', v; end if;

  select count(*) into v from ask_options;
  if v <> 168 then raise exception 'expected 168 anchors (42 x 4), found %', v; end if;

  -- Every question must carry all four anchors, scored 0,1,2,3 exactly once.
  select string_agg(q.id, ', ') into v_bad
  from ask_questions q
  where q.active and (
    select array_agg(o.score order by o.score) from ask_options o where o.question_id = q.id
  ) is distinct from array[0,1,2,3];
  if v_bad is not null then
    raise exception 'question(s) without a clean 0-3 anchor set: %', v_bad;
  end if;

  -- R1 must be the 15-question screen it has always been.
  select count(*) into v
  from ask_questions q join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and a.priority;
  if v <> 15 then raise exception 'R1 should serve 15 questions, serves %', v; end if;

  -- No anchor may be blank: the wording is the instrument.
  select count(*) into v from ask_options
  where btrim(coalesce(label, '')) = '' or btrim(coalesce(description, '')) = '';
  if v > 0 then raise exception '% anchor(s) have no text', v; end if;

  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in
    ('get_ask_bank','start_ask','save_ask_score','submit_ask','score_ask_reference',
     'get_ask_scorecard','get_candidate_ask','import_ask_json');
  if v <> 8 then raise exception 'expected 8 ASK functions, found %', v; end if;

  -- Nothing here may be reachable without a session.
  select count(*) into v from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname like 'ask\_%'
    and has_table_privilege('anon', c.oid, 'select');
  if v > 0 then raise exception '% ASK table(s) are readable by anon', v; end if;

  raise notice 'sql/35 ok — 14 attributes, 42 questions, 168 anchors, and none of it touches a match score';
end $$;
