// Data calls for the deal tabs, payables, Tally and admin screens (live Supabase only).
// Amounts and weights shown on screen come from the database views; nothing here does money maths.
import { supabase } from "./api";

export const DEMO_MSG = "Demo mode covers documents only. This screen needs the live system.";
const sb = () => { if (!supabase) throw new Error(DEMO_MSG); return supabase; };

type PgError = { message: string; code?: string; details?: string };
function friendly(e: PgError): string {
  const m = e.message ?? "";
  if (m.includes("sorting_lines_check1")) return "Debited kg differs from sorted kg: write the reason.";
  if (m.includes("sorting_lines_check")) return "A rate-difference line needs the rate cut.";
  if (e.code === "23505") {
    if (m.includes("deal_no")) return "This deal number is already used.";
    if (m.includes("po_no")) return "This PO number is already used on another deal.";
    if (m.includes("gstin")) return "A supplier with this GSTIN already exists.";
    if (m.includes("invoices")) return "This invoice number is already entered for this deal.";
    return "This already exists.";
  }
  if (e.code === "23503") return "This is still used elsewhere, so it cannot be deleted.";
  if (e.code === "23514") return `A value is not allowed here (${m}).`;
  return m;
}
function ok<T>(r: { data: unknown; error: PgError | null }): T {
  if (r.error) throw new Error(friendly(r.error));
  return r.data as T;
}
async function rpc<T = void>(fn: string, args: Record<string, unknown>): Promise<T> {
  return ok<T>(await sb().rpc(fn, args));
}

// ---------- types (rows as the views return them) ----------
export type Num = number;
export type Supplier = { id: string; name: string; gstin: string | null; state: string | null; kyc_status: "pending" | "verified" | "blocked"; provisional_pct: Num | null; credit_days: number | null };
export type Grade = { code: string; name: string; name_hi: string | null };
export type SortCat = { code: string; name: string; name_hi: string | null; default_action: "rate_diff" | "return" };
export type DealLine = { id: string; grade: string; qty_kg: Num; rate_per_kg: Num };
export type DealFull = {
  id: string; deal_no: string; supplier_id: string; plant_id: string; deal_date: string; po_no: string | null; po_date: string | null;
  status: DealStatus; notes: string | null; suppliers: Supplier; deal_lines: DealLine[];
};
export const DEAL_STATUSES = ["booked", "po_issued", "in_transit", "received", "sorted", "dn_approved", "settled", "closed", "cancelled"] as const;
export type DealStatus = typeof DEAL_STATUSES[number];

export type InvoiceLine = { id: string; invoice_id: string; grade: string; billed_net_kg: Num; billed_rate: Num; slip_gross_kg: Num | null; slip_bag_kg: Num | null };
export type Invoice = { id: string; deal_id: string; invoice_no: string; invoice_date: string; gst_rate: Num; taxable_value: Num; gst_amount: Num; total: Num; due_date: string | null; invoice_lines: InvoiceLine[] };
export type SortLine = { id: string; receipt_line_id: string; category: string; sorted_kg: Num; action: "rate_diff" | "return"; rate_cut: Num | null; dn_kg: Num; change_reason: string | null };
export type ReceiptLine = { id: string; receipt_id: string; grade: string; factory_gross_kg: Num; bag_count: number | null; factory_bag_kg: Num; factory_net_kg: Num; sorting_lines: SortLine[] };
export type Receipt = { id: string; deal_id: string; invoice_id: string | null; received_on: string; vehicle_no: string | null; receipt_lines: ReceiptLine[] };
export type Inward = { receipt_line_id: string; grade: string; deal_rate: Num; billed_rate: Num; slip_net_kg: Num | null; billed_net_kg: Num; factory_net_kg: Num; weight_short_kg: Num; slip_vs_invoice_kg: Num | null; rate_vs_deal: Num };
export type InvoiceCheck = { invoice_id: string; lines_taxable: Num; taxable_gap: Num; gst_gap: Num; total_gap: Num };
export type SortException = { grade: string; category: string; sorted_kg: Num; dn_kg: Num; kg_not_debited: Num; value_not_recovered: Num; change_reason: string | null };

export type DnType = "weight_short" | "rate_diff" | "return";
export const DN_TYPES: DnType[] = ["weight_short", "rate_diff", "return"];
export type DnCalc = { invoice_id: string; dn_type: DnType; taxable: Num; gst_amount: Num; total_exact: Num; total_rounded: Num };
export type DnLine = { grade: string; description: string; qty_kg: Num; rate: Num; amount: Num };
export type DnCalcLine = DnLine & { invoice_id: string; dn_type: DnType };
export type DebitNote = {
  id: string; deal_id: string; invoice_id: string; dn_type: DnType; dn_date: string; taxable: Num; gst_amount: Num; round_off: Num; total: Num;
  status: "approved" | "exported" | "booked_in_tally" | "cancelled"; tally_dn_no: string | null; approved_at: string; cancel_reason: string | null;
  debit_note_lines: DnLine[];
};
export type ReturnRow = { id: string; deal_id: string; dispatched_on: string | null; kg: Num; packages: number | null; eway_bill_no: string | null; transporter: string | null; lr_no: string | null; freight: Num | null; freight_paid_by: "rich_alloys" | "supplier" | null; freight_recovered: boolean; delivered_on: string | null };
export type Payable = { deal_no: string; supplier: string; invoice_id: string; invoice_no: string; invoice_date: string; due_date: string | null; invoice_total: Num; debit_notes: Num; deductions: Num; paid: Num; balance: Num; deal_id: string; supplier_id: string; days_overdue: number };
export type SupplierPayable = { supplier_id: string; supplier: string; bills: number; invoice_total: Num; debit_notes: Num; deductions: Num; paid: Num; balance: Num; overdue_balance: Num; max_days_overdue: number; next_due: string | null };
export type Payment = { id: string; deal_id: string; invoice_id: string | null; kind: "advance" | "provisional" | "final"; amount: Num; paid_on: string | null; bank_ref: string | null; in_tally: boolean };
export type Deduction = { id: string; invoice_id: string; kind: string; section: string | null; amount: Num; on_portal: boolean };
export type TallyPending = { kind: "debit_note" | "payment"; id: string; deal_no: string; party: string; detail: string; ref: string | null; amount: Num; status: string; on_date: string | null };
export type DoublePay = { issue: "overpaid" | "same_bank_ref" | "same_amount_same_day"; deal_no: string; supplier: string; invoice_no: string | null; bank_ref: string | null; amount: Num };
export type TallyExportRow = Record<string, string | number | null>;

// ---------- masters ----------
export async function masters() {
  const [g, c, s] = await Promise.all([
    sb().from("grades").select("code, name, name_hi").order("code"),
    sb().from("sort_categories").select("code, name, name_hi, default_action").order("name"),
    sb().from("suppliers").select("id, name, gstin, state, kyc_status, provisional_pct, credit_days").order("name"),
  ]);
  return { grades: ok<Grade[]>(g), cats: ok<SortCat[]>(c), suppliers: ok<Supplier[]>(s) };
}
export async function saveSupplier(s: Partial<Supplier> & { name: string }) {
  const { id, ...row } = s;
  if (id) ok(await sb().from("suppliers").update(row).eq("id", id));
  else ok(await sb().from("suppliers").insert(row));
}
export async function addSupplier(s: Omit<Supplier, "id">): Promise<string> {
  return ok<{ id: string }>(await sb().from("suppliers").insert(s).select("id").single()).id;
}
export async function saveGrade(g: Grade, isNew: boolean) {
  if (isNew) ok(await sb().from("grades").insert(g));
  else ok(await sb().from("grades").update({ name: g.name, name_hi: g.name_hi }).eq("code", g.code));
}
export async function saveSortCat(c: SortCat, isNew: boolean) {
  if (isNew) ok(await sb().from("sort_categories").insert(c));
  else ok(await sb().from("sort_categories").update({ name: c.name, name_hi: c.name_hi, default_action: c.default_action }).eq("code", c.code));
}

// ---------- deals ----------
const DEAL_SELECT = "id, deal_no, supplier_id, plant_id, deal_date, po_no, po_date, status, notes, suppliers(id, name, gstin, state, kyc_status, provisional_pct, credit_days), deal_lines(id, grade, qty_kg, rate_per_kg)";
export async function dealFull(id: string): Promise<DealFull> {
  return ok<DealFull>(await sb().from("deals").select(DEAL_SELECT).eq("id", id).single());
}
export async function setDealStatus(id: string, status: DealStatus) {
  ok(await sb().from("deals").update({ status }).eq("id", id));
}
export async function dealNumbers(): Promise<string[]> {
  return ok<{ deal_no: string }[]>(await sb().from("deals").select("deal_no")).map((d) => d.deal_no);
}
export async function createDeal(d: { deal_no: string; supplier_id: string; deal_date: string; po_no: string | null; po_date: string | null; notes: string | null },
                                 lines: { grade: string; qty_kg: number; rate_per_kg: number }[], userId: string): Promise<string> {
  const plant = ok<{ id: string }>(await sb().from("plants").select("id").eq("name", "Palghar").single());
  const deal = ok<{ id: string }>(await sb().from("deals").insert({
    ...d, plant_id: plant.id, status: d.po_no ? "po_issued" : "booked", created_by: userId,
  }).select("id").single());
  const r = await sb().from("deal_lines").insert(lines.map((l) => ({ ...l, deal_id: deal.id })));
  if (r.error) { await sb().from("deals").delete().eq("id", deal.id); throw new Error(friendly(r.error)); }
  return deal.id;
}

// ---------- weights and sorting ----------
export async function weights(dealId: string, dealNo: string) {
  const [inv, rec, inw, chk, exc, dns] = await Promise.all([
    sb().from("invoices").select("*, invoice_lines(*)").eq("deal_id", dealId).order("invoice_date"),
    sb().from("receipts").select("*, receipt_lines(*, sorting_lines(*))").eq("deal_id", dealId).order("received_on"),
    sb().from("v_inward").select("*").eq("deal_id", dealId),
    sb().from("v_invoice_check").select("*").eq("deal_id", dealId),
    sb().from("v_sorting_exceptions").select("*").eq("deal_no", dealNo),
    sb().from("debit_notes").select("invoice_id").eq("deal_id", dealId).neq("status", "cancelled"),
  ]);
  return {
    invoices: ok<Invoice[]>(inv), receipts: ok<Receipt[]>(rec), inward: ok<Inward[]>(inw),
    checks: ok<InvoiceCheck[]>(chk), exceptions: ok<SortException[]>(exc),
    frozen: new Set(ok<{ invoice_id: string }[]>(dns).map((d) => d.invoice_id)),
  };
}
export async function saveInvoice(i: Omit<Invoice, "id" | "invoice_lines"> & { id?: string }): Promise<string> {
  const { id, ...row } = i;
  if (id) { ok(await sb().from("invoices").update(row).eq("id", id)); return id; }
  return ok<{ id: string }>(await sb().from("invoices").insert(row).select("id").single()).id;
}
export async function saveInvoiceLine(l: Omit<InvoiceLine, "id">) {
  ok(await sb().from("invoice_lines").upsert(l, { onConflict: "invoice_id,grade" }));
}
export async function saveReceipt(r: Omit<Receipt, "id" | "receipt_lines"> & { id?: string }): Promise<string> {
  const { id, ...row } = r;
  if (id) { ok(await sb().from("receipts").update(row).eq("id", id)); return id; }
  return ok<{ id: string }>(await sb().from("receipts").insert(row).select("id").single()).id;
}
export async function saveReceiptLine(l: { receipt_id: string; grade: string; factory_gross_kg: number; bag_count: number | null; factory_bag_kg: number }) {
  ok(await sb().from("receipt_lines").upsert(l, { onConflict: "receipt_id,grade" }));
}
export async function saveSortLine(s: Omit<SortLine, "id"> & { id?: string }) {
  const { id, ...row } = s;
  if (id) ok(await sb().from("sorting_lines").update(row).eq("id", id));
  else ok(await sb().from("sorting_lines").insert(row));
}
export async function deleteSortLine(id: string) { ok(await sb().from("sorting_lines").delete().eq("id", id)); }

// ---------- debit notes and returns ----------
export async function debitNotes(dealId: string) {
  const [calc, lines, dns, rets, docs] = await Promise.all([
    sb().from("v_dn_calc").select("*").eq("deal_id", dealId),
    sb().from("v_dn_calc_lines").select("*").eq("deal_id", dealId),
    sb().from("debit_notes").select("*, debit_note_lines(grade, description, qty_kg, rate, amount)").eq("deal_id", dealId).order("approved_at"),
    sb().from("returns").select("*").eq("deal_id", dealId).order("dispatched_on"),
    sb().from("invoices").select("id, invoice_no, invoice_date, gst_rate").eq("deal_id", dealId).order("invoice_date"),
  ]);
  return {
    calc: ok<DnCalc[]>(calc), calcLines: ok<DnCalcLine[]>(lines), notes: ok<DebitNote[]>(dns), returns: ok<ReturnRow[]>(rets),
    invoices: ok<{ id: string; invoice_no: string; invoice_date: string; gst_rate: Num }[]>(docs),
  };
}
export const approveDn = (invoiceId: string, type: DnType, round: boolean) =>
  rpc<string>("approve_debit_note", { p_invoice: invoiceId, p_type: type, p_round_to_rupee: round });
export const cancelDn = (id: string, reason: string) => rpc("cancel_debit_note", { p_id: id, p_reason: reason });
export const setTallyNo = (id: string, no: string) => rpc("set_dn_tally_no", { p_id: id, p_tally_no: no });
export const markExported = (ids: string[]) => rpc<number>("mark_dns_exported", { p_ids: ids });
export async function saveReturn(r: Omit<ReturnRow, "id"> & { id?: string }) {
  const { id, ...row } = r;
  if (id) ok(await sb().from("returns").update(row).eq("id", id));
  else ok(await sb().from("returns").insert(row));
}
export async function deleteReturn(id: string) { ok(await sb().from("returns").delete().eq("id", id)); }
/** Signed links (2 minutes) to rejected-material photos for the supplier DN working. */
export async function rejectionPhotos(dealId: string): Promise<{ url: string; pdf: boolean }[]> {
  const docs = ok<{ storage_path: string }[]>(await sb().from("documents").select("storage_path")
    .eq("deal_id", dealId).eq("doc_type", "REJECTION_PHOTOS").neq("status", "rejected"));
  const out: { url: string; pdf: boolean }[] = [];
  for (const d of docs) {
    const { data } = await sb().storage.from("deal-docs").createSignedUrl(d.storage_path, 120);
    if (data) out.push({ url: data.signedUrl, pdf: d.storage_path.toLowerCase().endsWith(".pdf") });
  }
  return out;
}

// ---------- payments ----------
export async function payment(dealId: string) {
  const [pay, pm, de] = await Promise.all([
    sb().from("v_payable").select("*").eq("deal_id", dealId).order("invoice_date"),
    sb().from("payments").select("*").eq("deal_id", dealId).order("paid_on", { nullsFirst: true }),
    sb().from("deductions").select("*, invoices!inner(deal_id)").eq("invoices.deal_id", dealId),
  ]);
  return { bills: ok<Payable[]>(pay), payments: ok<Payment[]>(pm), deductions: ok<Deduction[]>(de) };
}
export async function savePayment(p: Omit<Payment, "id">) { ok(await sb().from("payments").insert(p)); }
export async function setPaymentInTally(id: string, inTally: boolean) { ok(await sb().from("payments").update({ in_tally: inTally }).eq("id", id)); }
export async function deletePayment(id: string) { ok(await sb().from("payments").delete().eq("id", id)); }
export async function saveDeduction(d: Omit<Deduction, "id">) { ok(await sb().from("deductions").insert(d)); }
export async function setDeductionOnPortal(id: string, on: boolean) { ok(await sb().from("deductions").update({ on_portal: on }).eq("id", id)); }
export async function deleteDeduction(id: string) { ok(await sb().from("deductions").delete().eq("id", id)); }

export async function payables() {
  const [sup, bills, tot] = await Promise.all([
    sb().from("v_payable_by_supplier").select("*").order("max_days_overdue", { ascending: false }).order("balance", { ascending: false }),
    sb().from("v_payable").select("*").order("due_date", { nullsFirst: false }),
    sb().from("v_payable_total").select("*").single(),
  ]);
  return { suppliers: ok<SupplierPayable[]>(sup), bills: ok<Payable[]>(bills), total: ok<{ balance: Num; overdue_balance: Num; suppliers: number }>(tot) };
}

// ---------- Tally ----------
export async function tally() {
  const [pend, dbl, exp] = await Promise.all([
    sb().from("v_tally_pending").select("*").order("on_date"),
    sb().from("v_double_payment").select("*"),
    sb().from("v_tally_dn_export").select("*").in("status", ["approved", "exported"]).order("dn_date"),
  ]);
  return { pending: ok<TallyPending[]>(pend), doubles: ok<DoublePay[]>(dbl), exportRows: ok<TallyExportRow[]>(exp) };
}
