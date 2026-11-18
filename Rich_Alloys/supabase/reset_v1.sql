-- ONE TIME, only for a project that ran the first (v1) setup.sql and holds no real data.
-- Removes the v1 tables, views and functions, and the interim additions the live project received on
-- 18 Nov (staff columns, upload-retry index, slices 2-5: 0005-0007 of the v1 build).
-- Login accounts and uploaded files are kept. Then run setup.sql, then add_user.sql again for each person.
drop view if exists v_payable_total, v_payable_by_supplier, v_invoice_check, v_tally_pending, v_double_payment cascade;
drop view if exists v_tally_dn_export, v_doc_gaps, v_payable, v_sorting_exceptions, v_dn_calc, v_dn_calc_lines, v_inward cascade;
drop table if exists audit_log, documents, doc_types, deductions, payments, returns, debit_note_lines, debit_notes,
  sorting_lines, receipt_lines, receipts, invoice_lines, invoices, deal_lines, deals, sort_categories, grades,
  suppliers, profiles, plants cascade;
drop function if exists approve_dn(uuid, text, date, boolean, uuid), verify_document(uuid), approve_document(uuid),
  reject_document(uuid, text), my_role(), is_staff() cascade;
drop function if exists can_manage_staff(), approve_debit_note(uuid, text, boolean), cancel_debit_note(uuid, text),
  set_dn_tally_no(uuid, text), mark_dns_exported(uuid[]), lock_after_dn(), check_deal_close(), audit_row() cascade;
drop policy if exists deal_docs_read on storage.objects;
drop policy if exists deal_docs_upload on storage.objects;
