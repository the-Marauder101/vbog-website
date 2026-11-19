-- TEST/START DATA: stock opening on 1 Nov 2026 = Tinu's closing on 31 Oct 2026 (PRD 7a item 4).
-- Source: (7)STOCK_OCT 2026.xlsx and (7)production report oct2026.xlsx (Project files / Drive).
-- Zero closings (copper strips, the second ingot item, plastic scrap) need no entry. Plastic scrap is 0 in Tinu's
-- stock statement; the -29,020 kg in his October production report is an error there (PRD 7c, question 24).
-- Copper scrap: 105,380.660 per the stock ledger and production report; the stock statement says 105,380.75 (question 28).
-- Earlier movements in the portal (e.g. the Ogo lot of 25 Oct) are inside these figures and stop counting.
insert into stock_moves (move_date, item, kind, kg, doc_no) values
  ('2026-11-01', 'COPPER_SCRAP',      'opening', 105380.660, 'Closing 31 Oct 2026, Tinu stock sheet'),
  ('2026-11-01', 'COPPER_WIRE',       'opening',   6701.620, 'Closing 31 Oct 2026, Tinu stock sheet'),
  ('2026-11-01', 'PHOS_COPPER',       'opening',   2670.000, 'Closing 31 Oct 2026, Tinu stock sheet'),
  ('2026-11-01', 'COPPER_INGOT',      'opening',  10893.850, 'Closing 31 Oct 2026, Tinu stock sheet'),
  ('2026-11-01', 'COPPER_GROSS_SLAG', 'opening',  17457.000, 'Closing 31 Oct 2026, Tinu production report'),
  ('2026-11-01', 'COPPER_ASH',        'opening',   8051.640, 'Closing 31 Oct 2026, Tinu production report');
