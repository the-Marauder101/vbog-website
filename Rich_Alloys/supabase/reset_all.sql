-- ONE TIME, only while the project holds test data. Removes every Rich Alloys table, view and function
-- (v1 or v2). Login accounts and uploaded files are kept. Then run setup.sql, then add_user.sql per person.
do $$ declare r record; begin
  for r in select table_name from information_schema.views where table_schema = 'public' and table_name like 'v\_%' loop
    execute format('drop view if exists public.%I cascade', r.table_name);
  end loop;
end $$;
drop table if exists reminder_log, reminders, supplier_onboarding, onboarding_steps, payment_hold_acks, price_decisions, deal_rate_history, gstr2b_lines, gstr2b_imports, audit_log, documents, stock_tally_checks, stock_moves, production_lines,
  production_runs, tally_marks, ledger_confirmations, tds, payments, returns, note_lines, notes, sorting_lines, lot_lines,
  lots, invoice_lines, invoices, deal_lines, deals, suppliers, doc_types, sort_categories, grades, items, permissions,
  profiles, plants, deductions, debit_note_lines, debit_notes, receipt_lines, receipts cascade;
drop sequence if exists deal_seq, lot_seq;
do $$ declare r record; begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('my_role','is_staff','can','my_actions','require','via_fn','audit_row',
             'lot_has_notes','guard_sorting','guard_weights','guard_payment','guard_profile','lot_is_paid','stock_summary',
             'create_deal','create_lot','close_lot','reopen_lot','approve_dn','cancel_note','set_note_tally_no','mark_tally',
             'unmark_tally','clear_tally_change','entity_amount','reconcile_payment','reject_payment','confirm_ledger',
             'set_invoice_2b','save_production','verify_document','approve_document','reject_document','doc_norm','import_gstr2b',
             'transfer_stock','create_receipt','doc_kind_for','create_unbooked_lot','confirm_deal_rate',
             'log_rate_change','apply_deal_rate','set_deal_rate','decide_price',
             'pin_truck_price','apply_truck_price','set_lot_rate','ack_payment_hold','set_onboarding_step','set_supplier_onboarded',
             'next_due','po_on_insert','complete_reminder','suggest_po_no','issue_po','close_production') loop
    execute format('drop function if exists %s cascade', r.f);
  end loop;
end $$;
drop policy if exists deal_docs_read on storage.objects;
drop policy if exists deal_docs_upload on storage.objects;
