-- ═══════════════════════════════════════════════════════════════════════════
-- Candidate Item Bank v1.1 — 44 items, keys included
-- Source: item_bank_v1.1_FINAL.md
--
-- "Seed these into items and item_options. NEVER hardcode in the frontend."
-- The frontend reads this table. It does not know the keys, which is also what
-- keeps the keys out of the browser where a candidate could read them.
--
-- Item count by dimension (enforced at the bottom of this file):
--   RES 4 · DRV 4 · DSC 4 · CLS_C 4 · CLS_F 4 · CCH 4 · INT 4
--   MOT 5 · STY 5 · BF 3 · SD 3  = 44
-- ═══════════════════════════════════════════════════════════════════════════

-- Idempotent reseed of bank v1.1. candidate_responses references items(id) but
-- ids are stable across reseeds, so this never orphans a response.
delete from item_options where item_id in (select id from items where bank_version = '1.1');
delete from items where bank_version = '1.1';

-- ═══ BLOCK A — SJT: Resilience & Composure (RES) ════════════════════════════

insert into items (id, dimension_code, format, block_label, sort_order, stem) values
('RES-01','RES','sjt','A',10,
 'You have taken nine calls today. Eight were no, and two of those were rude about your price. Your ninth call starts in four minutes, with a lead who has already rescheduled twice. What do you do with those four minutes?'),
('RES-02','RES','sjt','A',20,
 'A prospect ends a call by telling you that you sound like every other person who has wasted his time. That evening, what is most likely true of you?'),
('RES-03','RES','sjt','A',30,
 'Your month closes in six days. You are at 40% of target and it is mathematically impossible to hit it. What do you do with the six days?'),
('RES-04','RES','sjt','A',40,
 'A ₹1.8L deal you had verbally agreed goes silent for eight days after the client''s finance head gets involved. What is your move?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('RES-01','a','Skim his notes and decide on one specific question to open with.', 2,1),
('RES-01','b','Step outside for air and go in fresh without looking at the notes.', 1,2),
('RES-01','c','Message your manager that today''s lead quality is poor, so it is on record.', 0,3),
('RES-01','d','Push the call to tomorrow — better to catch him when you are sharper.', -1,4),

('RES-02','a','You have replayed the call once, noted one thing you would change, and moved on.', 2,1),
('RES-02','b','You have not thought about it again — single calls do not stay with you.', 1,2),
('RES-02','c','You are still turning it over, and it affected your last two calls of the day.', 0,3),
('RES-02','d','You have drafted a sharp reply and you are deciding whether to send it.', -1,4),

('RES-03','a','Work the pipeline normally and start building next month''s early so you open strong.', 2,1),
('RES-03','b','Push hard on every open deal — a miracle week is still possible.', 1,2),
('RES-03','c','Focus on activity numbers so at least your effort looks defensible in review.', 0,3),
('RES-03','d','Ease off, protect your energy, and reset on the 1st.', -1,4),

('RES-04','a','Send one clear message asking directly whether finance''s involvement has changed the decision, and propose a date to close the loop either way.', 2,1),
('RES-04','b','Keep following up warmly every few days without raising the finance angle.', 1,2),
('RES-04','c','Escalate to your manager and ask someone senior to call the finance head.', 0,3),
('RES-04','d','Treat it as dead, take it out of your forecast, and stop chasing.', -1,4);

-- ═══ BLOCK B — SJT: Achievement Drive (DRV) ═════════════════════════════════

insert into items (id, dimension_code, format, block_label, sort_order, stem) values
('DRV-01','DRV','sjt','B',50,
 'You hit 100% of target on the 22nd. Nine days are left in the month. What actually happens?'),
('DRV-02','DRV','sjt','B',60,
 'Your company target is eight closes a month. What number is actually in your head?'),
('DRV-03','DRV','sjt','B',70,
 'You find out a teammate closed ₹6L last month against your ₹3.5L, working the same lead pool. What is the first thing you do?'),
('DRV-04','DRV','sjt','B',80,
 'Your incentive has already maxed out for the quarter. No additional payout is possible for the next three weeks. What changes?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('DRV-01','a','You keep selling — the extra closes are yours and it makes next month easier.', 2,1),
('DRV-01','b','You maintain normal activity and have a lighter finish to the month.', 1,2),
('DRV-01','c','You keep working but push most new deals into next month to bank a strong start.', 0,3),
('DRV-01','d','You slow down. You delivered what was asked.', -1,4),

('DRV-02','a','Ten to twelve. I set my own number above the company''s.', 2,1),
('DRV-02','b','Whatever the top performer did last month.', 1,2),
('DRV-02','c','Eight. That is the target, and hitting it consistently is the job.', 0,3),
('DRV-02','d','It depends on the leads I am given that month.', -1,4),

('DRV-03','a','Ask him to walk you through his last three closes and what he did differently.', 2,1),
('DRV-03','b','Compare your call counts and conversion against his to locate the gap.', 1,2),
('DRV-03','c','Note it and stay focused on your own numbers — comparison is not useful.', 0,3),
('DRV-03','d','Check whether he was given better leads or an easier segment.', -1,4),

('DRV-04','a','Nothing changes in how I work.', 2,1),
('DRV-04','b','I use the time to build pipeline and help train the newer people.', 1,2),
('DRV-04','c','I reduce new outreach and focus on servicing deals already in motion.', 0,3),
('DRV-04','d','I hold closes back so they land next quarter, where they pay.', -1,4);

-- ═══ BLOCK C — SJT: Process Discipline (DSC) ════════════════════════════════

insert into items (id, dimension_code, format, block_label, sort_order, stem) values
('DSC-01','DSC','sjt','C',90,
 'It is 8:40 pm. You have finished six calls, three need follow-up notes logged, and your family is waiting. What happens?'),
('DSC-02','DSC','sjt','C',100,
 'A prospect says "not now, maybe after Diwali." What do you do in the next sixty seconds?'),
('DSC-03','DSC','sjt','C',110,
 'The company has no CRM. Leads arrive on WhatsApp from the founder. Six weeks in, what does your system look like?'),
('DSC-04','DSC','sjt','C',120,
 'You have 22 open deals. It is Monday morning. How do you decide who to call first?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('DSC-01','a','Log all three now, even briefly, before leaving.', 2,1),
('DSC-01','b','Log the two important ones and leave the small one for morning.', 1,2),
('DSC-01','c','Leave now and log everything first thing tomorrow.', 0,3),
('DSC-01','d','Skip the notes. You remember your own deals.', -1,4),

('DSC-02','a','Set a dated reminder for a specific day after Diwali, with a note recording his exact objection in his own words.', 2,1),
('DSC-02','b','Add him to your follow-up list to revisit later.', 1,2),
('DSC-02','c','Send him a message now so he has your details when he is ready.', 0,3),
('DSC-02','d','Mark it closed-lost. If he wants it, he will come back.', -1,4),

('DSC-03','a','A spreadsheet I built, with stage, next action, and date for every lead.', 2,1),
('DSC-03','b','Labelled WhatsApp chats plus a daily to-do list.', 1,2),
('DSC-03','c','I have asked the founder repeatedly to buy a CRM and I am waiting on that.', 0,3),
('DSC-03','d','It is in my head and my call log. My volume is manageable.', -1,4),

('DSC-04','a','Sort by expected close date and value; work highest-value, nearest-close first.', 2,1),
('DSC-04','b','Call the ones that feel warmest.', 1,2),
('DSC-04','c','Work down the list in the order they came in.', 0,3),
('DSC-04','d','Wait for replies to come in and respond as they do.', -1,4);

-- ═══ BLOCK D — SJT: Closing Assertiveness, Considered Purchase (CLS_C) ══════

insert into items (id, dimension_code, format, block_label, sort_order, framing_note, stem) values
('CLS-01','CLS_C','sjt','D',130,
 'For the next four, assume a considered purchase above ₹1,00,000, with several conversations before a decision.',
 'You have presented a ₹1.5L programme to a 48-year-old business owner whose company is larger than yours. He says: "Send me the details, I''ll think about it." What do you say?'),
('CLS-02','CLS_C','sjt','D',140,
 'For the next four, assume a considered purchase above ₹1,00,000, with several conversations before a decision.',
 'You have asked for the close. The prospect goes quiet for eight seconds. What do you do?'),
('CLS-03','CLS_C','sjt','D',150,
 'For the next four, assume a considered purchase above ₹1,00,000, with several conversations before a decision.',
 'The prospect says: "Your competitor is ₹40,000 cheaper for the same thing." You know it is not the same thing. Your response?'),
('CLS-04','CLS_C','sjt','D',160,
 'For the next four, assume a considered purchase above ₹1,00,000, with several conversations before a decision.',
 'Third call with a warm prospect. He keeps saying he is interested but will not commit to a date. You are confident he has the authority to decide today.');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('CLS-01','a','"Happy to — before I do, what specifically would you be weighing up? If it''s the price, let''s talk about that now."', 2,1),
('CLS-01','b','"Of course. Can we hold fifteen minutes on Thursday to go through whatever comes up?"', 1,2),
('CLS-01','c','"Sure, I''ll send it across and follow up on Thursday."', 0,3),
('CLS-01','d','"No problem, take your time and reach out whenever you''re ready."', -1,4),

('CLS-02','a','Stay silent and wait.', 2,1),
('CLS-02','b','Wait about three seconds, then ask what he is weighing.', 1,2),
('CLS-02','c','Fill the silence by restating your strongest benefit.', 0,3),
('CLS-02','d','Offer a discount to break the tension.', -1,4),

('CLS-03','a','Ask exactly what the competitor included, then compare point by point where you actually differ.', 2,1),
('CLS-03','b','Explain your differentiators without engaging on the competitor''s pricing.', 1,2),
('CLS-03','c','Check with your manager whether you can match or part-match.', 0,3),
('CLS-03','d','Offer to match it to keep the deal alive.', -1,4),

('CLS-04','a','Name it directly: "You''ve told me yes three times now without moving. What''s actually holding this up?"', 2,1),
('CLS-04','b','Book a fourth call and bring a case study closer to his exact situation.', 1,2),
('CLS-04','c','Give him space — pushing a warm lead risks losing him.', 0,3),
('CLS-04','d','Mention that the price or the slot may change at month end, though you are not certain it will.', -1,4);

-- ═══ BLOCK D2 — SJT: Closing Assertiveness, Fast Close (CLS_F) ══════════════
-- The key INVERTS against Block D. This is the entire reason CLS is split, and
-- the reason no blended CLS is ever stored on a candidate (§5, §7.2).

insert into items (id, dimension_code, format, block_label, sort_order, framing_note, stem) values
('CLS-F01','CLS_F','sjt','D2',170,
 'For the next four, assume an inbound lead, an offer under ₹30,000, a ten-to-fifteen minute call, and sixteen calls booked that day.',
 'A ₹18,000 programme. You are twelve minutes into a call the prospect expected to be ten. He says: "Let me discuss with my wife and I''ll call you back."'),
('CLS-F02','CLS_F','sjt','D2',180,
 'For the next four, assume an inbound lead, an offer under ₹30,000, a ten-to-fifteen minute call, and sixteen calls booked that day.',
 'Call four of sixteen booked today. ₹22,000 offer. The lead is interested but says he wants to look at the website first.'),
('CLS-F03','CLS_F','sjt','D2',190,
 'For the next four, assume an inbound lead, an offer under ₹30,000, a ten-to-fifteen minute call, and sixteen calls booked that day.',
 '₹25,000 offer. He says: "That''s more than I expected."'),
('CLS-F04','CLS_F','sjt','D2',200,
 'For the next four, assume an inbound lead, an offer under ₹30,000, a ten-to-fifteen minute call, and sixteen calls booked that day.',
 'Six minutes into a ten-minute inbound call. He has confirmed the problem, and the budget fits. What do you do?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('CLS-F01','a','"Of course — is she around right now? It''s a two-minute conversation, I''m happy to hold."', 2,1),
('CLS-F01','b','"Sure. What do you think she''ll ask? Let''s make sure you''ve got the answer ready."', 1,2),
('CLS-F01','c','"No problem — I''ll WhatsApp you the details so you both have them."', 0,3),
('CLS-F01','d','"Absolutely, take your time and reach out whenever you''re ready."', -1,4),

('CLS-F02','a','Ask what specifically he wants to check, answer that on the call, and ask for the decision now.', 2,1),
('CLS-F02','b','Send the one relevant link and stay on the line while he reads it.', 1,2),
('CLS-F02','c','Send the link and book a callback for tomorrow.', 0,3),
('CLS-F02','d','End the call and add him to your follow-up list.', -1,4),

-- Downselling is not always wrong. What is keyed here is the REFLEX — offering
-- it before the objection has even been explored.
('CLS-F03','a','Ask what he was expecting, then hold your price and reframe against the cost of not fixing the problem.', 2,1),
('CLS-F03','b','Break it into a monthly figure and hold the price.', 1,2),
('CLS-F03','c','Ask your manager whether you can do a one-time discount.', 0,3),
('CLS-F03','d','Immediately offer the ₹15,000 lighter version to save the sale.', -1,4),

-- THE INVERSION ITEM. In a considered-purchase frame option d would score near
-- +1 and option a near 0. DO NOT re-key it — that inversion is precisely why
-- CLS_C and CLS_F are measured separately.
('CLS-F04','a','Ask for the close now.', 2,1),
('CLS-F04','b','Cover two more relevant benefits, then ask.', 1,2),
('CLS-F04','c','Complete your full presentation as trained, then ask.', 0,3),
('CLS-F04','d','Suggest booking a longer call to go deeper first.', -1,4);

-- ═══ BLOCK E — SJT: Coachability (CCH) ══════════════════════════════════════

insert into items (id, dimension_code, format, block_label, sort_order, stem) values
('CCH-01','CCH','sjt','E',210,
 'Your manager listens to a recording and says your discovery is too shallow — you pitch after two questions. You disagree; your close rate is above team average. What do you do?'),
('CCH-02','CCH','sjt','E',220,
 'You are given a new script. It feels unnatural and your first four calls with it go badly.'),
('CCH-03','CCH','sjt','E',230,
 'What does useful feedback look like to you?'),
('CCH-04','CCH','sjt','E',240,
 'In your last role, what did you actually do with call recordings?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('CCH-01','a','Run it his way for two weeks and compare your own numbers before arguing.', 2,1),
('CCH-01','b','Show him your results, then agree to test his approach on a portion of your calls.', 1,2),
('CCH-01','c','Show him your numbers and carry on as you are.', 0,3),
('CCH-01','d','Agree in the meeting and keep doing what works.', -1,4),

('CCH-02','a','Flag the specific lines that broke down and ask to adapt those, keeping the structure.', 2,1),
('CCH-02','b','Push through with it for a full week before judging it.', 1,2),
('CCH-02','c','Go back to your old script and mention that the new one did not suit you.', 0,3),
('CCH-02','d','Use the new script when you are being observed and your own one otherwise.', -1,4),

('CCH-03','a','Specific, about one behaviour, with an example from a real call.', 2,1),
('CCH-03','b','Frequent and direct, even when it is blunt.', 1,2),
('CCH-03','c','Delivered privately and framed positively.', 0,3),
('CCH-03','d','From someone who has personally outsold me. Otherwise it is just opinion.', -1,4),

('CCH-04','a','Reviewed my own losses regularly and noted the patterns.', 2,1),
('CCH-04','b','Reviewed them when my manager flagged something.', 1,2),
('CCH-04','c','We had them, but I rarely listened back.', 0,3),
('CCH-04','d','I do not find listening to my own calls useful.', -1,4);

-- ═══ BLOCK F — SJT: Sales Integrity (INT) ═══════════════════════════════════
-- NEVER described to candidates as an integrity or honesty check. That framing
-- makes the keyed answers obvious and destroys the items.

insert into items (id, dimension_code, format, block_label, sort_order, stem) values
('INT-01','INT','sjt','F',250,
 'A prospect is clearly not a fit — your programme will not solve his problem — but he is ready to pay ₹45,000 today and you are behind target.'),
('INT-02','INT','sjt','F',260,
 'Your offer carries a written 30-day refund policy that the founder rarely honours in practice. A prospect asks directly: "Can I get my money back if it doesn''t work?"'),
('INT-03','INT','sjt','F',270,
 'Mid-call you realise you gave this prospect a wrong figure last time — you said 85% of clients see results within 60 days. The real number is closer to 50%.'),
('INT-04','INT','sjt','F',280,
 'A teammate is closing well by telling prospects that a limited-slot offer expires Friday. There is no such limit. Your manager knows and says nothing.');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('INT-01','a','Tell him it is not the right fit, and refer him elsewhere if I can.', 2,1),
('INT-01','b','Take the sale, but flag my concerns to the delivery team in writing.', 1,2),
('INT-01','c','Take the sale. He is an adult making his own decision.', 0,3),
('INT-01','d','Reframe the offer so it sounds closer to his problem, and close.', -1,4),

('INT-02','a','State the written policy, and tell him honestly that refunds have been slow in practice.', 2,1),
('INT-02','b','State the written policy exactly as written, nothing added.', 1,2),
('INT-02','c','Redirect to why he will not need a refund.', 0,3),
('INT-02','d','Tell him yes, there is a full refund guarantee — which is technically what the policy says.', -1,4),

('INT-03','a','Correct it immediately on the call and give him the accurate figure.', 2,1),
('INT-03','b','Correct it in the follow-up email so it is on record.', 1,2),
('INT-03','c','Avoid repeating the figure and move the conversation on.', 0,3),
('INT-03','d','Leave it. He is already sold and the correction may cost the deal.', -1,4),

('INT-04','a','Raise it with the manager once, clearly — then decide whether I want to work here.', 2,1),
('INT-04','b','Raise it with the teammate directly.', 1,2),
('INT-04','c','Stay out of it and sell my own way.', 0,3),
('INT-04','d','Use the same line. It works and it is clearly sanctioned.', -1,4);

-- ═══ BLOCK G — Forced-choice: Deal Motion Orientation (MOT) ═════════════════
-- Shown to candidate: "Both options are reasonable. Pick the one that is more
-- like you."  0 = pitch-forward / high-volume · 100 = consultative / deal-craft

insert into items (id, dimension_code, format, block_label, sort_order, framing_note, stem) values
('MOT-01','MOT','forced_choice','G',290,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('MOT-02','MOT','forced_choice','G',300,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('MOT-03','MOT','forced_choice','G',310,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('MOT-04','MOT','forced_choice','G',320,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('MOT-05','MOT','forced_choice','G',330,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('MOT-01','a','I would rather take 40 calls a week and close six quickly.',   0,1),
('MOT-01','b','I would rather take 12 calls a week and close three large ones slowly.', 100,2),
('MOT-02','a','I get the offer on the table early and handle objections as they come.', 0,1),
('MOT-02','b','I spend most of the first call understanding the situation before I mention the offer.', 100,2),
('MOT-03','a','I am energised by momentum and a full calendar.', 0,1),
('MOT-03','b','I am energised by cracking one difficult, high-value deal.', 100,2),
('MOT-04','a','A short call that ends in a decision.', 0,1),
('MOT-04','b','A long call that ends in real understanding, even without a decision yet.', 100,2),
('MOT-05','a','I would rather work a list of 300 leads.', 0,1),
('MOT-05','b','I would rather work a list of 30 accounts.', 100,2);

-- ═══ BLOCK H — Forced-choice: Interpersonal Style (STY) ═════════════════════
-- 0 = task-direct · 100 = rapport-warm

insert into items (id, dimension_code, format, block_label, sort_order, framing_note, stem) values
('STY-01','STY','forced_choice','H',340,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('STY-02','STY','forced_choice','H',350,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('STY-03','STY','forced_choice','H',360,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('STY-04','STY','forced_choice','H',370,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?'),
('STY-05','STY','forced_choice','H',380,'Both options are reasonable. Pick the one that is more like you.','Which is more like you?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('STY-01','a','I build a personal connection before getting to business.', 100,1),
('STY-01','b','I respect people''s time and get to the point.',               0,2),
('STY-02','a','Prospects tend to describe me as warm.',                     100,1),
('STY-02','b','Prospects tend to describe me as sharp.',                      0,2),
('STY-03','a','I would rather be liked and trusted.',                       100,1),
('STY-03','b','I would rather be respected and believed.',                    0,2),
('STY-04','a','I follow up with something personal I remembered from the call.', 100,1),
('STY-04','b','I follow up with a clear next step and a date.',               0,2),
('STY-05','a','I open a call with some genuine small talk.',                100,1),
('STY-05','b','I open a call by confirming the agenda.',                      0,2);

-- ═══ BLOCK I — Behavioural frequency (interleaved, ±5 adjustment) ═══════════
-- Adjusts DSC, DRV and RES only. Never shown as its own block.

insert into items (id, dimension_code, format, block_label, sort_order, stem) values
('BF-01','DSC','behavioural_freq','I',390,
 'In your last full working week, on how many days did you update your notes or CRM the same day as the call?'),
('BF-02','DRV','behavioural_freq','I',400,
 'In the last 30 days, how many prospects did you contact who had previously said no or not now?'),
('BF-03','RES','behavioural_freq','I',410,
 'Think of your longest recent stretch of calls without a close. What happened to your daily call count during it?');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('BF-01','a','Five or more days',           5,1),
('BF-01','b','Three to four days',          2,2),
('BF-01','c','One to two days',             0,3),
('BF-01','d','None / I don''t work this way', -5,4),

('BF-02','a','16 or more',                  5,1),
('BF-02','b','6 to 15',                     2,2),
('BF-02','c','1 to 5',                      0,3),
('BF-02','d','None',                       -5,4),

-- a and b are deliberately keyed the same: increasing activity under drought
-- and holding steady are both healthy. The discriminating signal is the drop.
('BF-03','a','It went up',                  5,1),
('BF-03','b','It stayed the same',          5,2),
('BF-03','c','It dropped slightly',         0,3),
('BF-03','d','It dropped a lot',           -5,4);

-- ═══ BLOCK J — Social desirability check (interleaved, never scored) ════════
-- Never scored into a dimension. Never shown as a block. Never mentioned to the
-- candidate. dimension_code is deliberately NULL — there is no dimension for it
-- to leak into.

insert into items (id, dimension_code, format, block_label, sort_order, stem) values
('SD-01', null,'sd_check','J',420,'I have never exaggerated a product''s benefit in order to close a deal.'),
('SD-02', null,'sd_check','J',430,'I have never felt discouraged after a bad sales week.'),
('SD-03', null,'sd_check','J',440,'I have never been late to a scheduled call with a prospect.');

insert into item_options (item_id, option_key, option_text, score_key, sort_order) values
('SD-01','true','True', 1,1), ('SD-01','false','False', 0,2),
('SD-02','true','True', 1,1), ('SD-02','false','False', 0,2),
('SD-03','true','True', 1,1), ('SD-03','false','False', 0,2);

-- ═══ SEED ASSERTIONS ═══════════════════════════════════════════════════════
-- §7.3 / bank maintenance: "Scores stay comparable across bank versions within
-- a dictionary version ONLY IF the item count per dimension is unchanged."
-- A miscounted seed silently breaks comparability, so it fails loudly here.

do $$
declare
  n_total int;
  bad     text;
begin
  select count(*) into n_total from items where bank_version = '1.1' and active;
  if n_total <> 44 then
    raise exception 'Item bank seed: expected 44 items, found %', n_total;
  end if;

  select string_agg(format('%s=%s', k, c), ', ' order by k) into bad
  from (
    select coalesce(dimension_code,'SD') as k, count(*) as c
    from items where bank_version = '1.1' and active
    group by 1
  ) t
  where (k,c) not in (
    ('RES',5),('DRV',5),('DSC',5),   -- 4 SJT + 1 interleaved BF
    ('CLS_C',4),('CLS_F',4),('CCH',4),('INT',4),
    ('MOT',5),('STY',5),('SD',3)
  );
  if bad is not null then
    raise exception 'Item bank seed: wrong item count per dimension -> %', bad;
  end if;

  -- Every SJT item must offer exactly one +2, one +1, one 0 and one −1.
  select string_agg(item_id, ', ') into bad
  from (
    select i.id as item_id
    from items i join item_options o on o.item_id = i.id
    where i.format = 'sjt' and i.bank_version = '1.1'
    group by i.id
    having array_agg(o.score_key order by o.score_key) <> array[-1,0,1,2]::numeric[]
  ) t;
  if bad is not null then
    raise exception 'Item bank seed: SJT items not keyed -1/0/+1/+2 -> %', bad;
  end if;

  -- Every forced-choice pair must offer exactly one 0-pole and one 100-pole.
  select string_agg(item_id, ', ') into bad
  from (
    select i.id as item_id
    from items i join item_options o on o.item_id = i.id
    where i.format = 'forced_choice' and i.bank_version = '1.1'
    group by i.id
    having array_agg(o.score_key order by o.score_key) <> array[0,100]::numeric[]
  ) t;
  if bad is not null then
    raise exception 'Item bank seed: forced-choice items not keyed 0/100 -> %', bad;
  end if;

  raise notice 'Item bank v1.1 seeded: 44 items, keys verified.';
end $$;
