import { useState } from "react";
import { COMPANY, csv, day, download, esc, inr, isNum, kg, printHtml, q, rpc, sb, today, useCan, useLang, useLoad, useT, nm, type Row } from "../lib";
import { DateIn, Btn, Chip, Choice, Empty, Err, Field, KV, Loading, NumIn, Section, Select, Sheet, SaveBar, Tabs, TextIn } from "../ui";
import { DN_LABEL, DealDocs, HoldHint, PaymentRow, PaymentSheet, PriceDecisions, RateCell, RateHistory, Stepper, StageChip, TallyTick, useSave } from "../common";
import { TermsSheet } from "./Deal";
import { TermsLine } from "./Lots";

// PRD 7b: only domestic purchases carry money. Branch, import and job-work lots work in kg.
type TT = (en: string, hi?: string) => string;
const isDomestic = (d: { v: Row }) => (d.v.supplier_type ?? "domestic") === "domestic";
export const noteWord = (t: TT, type: string | undefined, plural = false) =>
  type === "import" ? (plural ? t("Claim notes", "क्लेम नोट") : t("Claim note", "क्लेम नोट"))
  : type && type !== "domestic" ? (plural ? t("Shortage / return notes", "कमी / वापसी नोट") : t("Shortage / return note", "कमी / वापसी नोट"))
  : (plural ? t("Debit notes", "डेबिट नोट") : t("Debit note", "डेबिट नोट"));
export const docWord = (t: TT, kind: string | undefined) =>
  kind === "delivery_note" ? t("Delivery note", "डिलीवरी नोट") : kind === "bill_of_entry" ? t("Bill of entry", "बिल ऑफ एंट्री")
  : kind === "challan" ? t("Challan", "चालान") : t("Invoice", "बिल");
const noteKg = (n: Row) => (n.note_lines ?? []).reduce((a: number, l: Row) => a + Number(l.qty_kg), 0);

async function loadLot(id: string, money: boolean) {
  const lot = await q<Row>(sb.from("lots").select("*, deals(*, suppliers(*)), invoices(*)").eq("id", id).single());
  const inv = lot.invoice_id as string | null;
  const [v, lines, sorting, calc, calcLines, notes, returns, cats, exc] = await Promise.all([
    q(sb.from("v_lots").select("*").eq("lot_id", id)),
    q(sb.from("v_lot_lines").select("*").eq("lot_id", id).order("grade")),
    q(sb.from("sorting_lines").select("*, lot_lines!inner(lot_id, grade)").eq("lot_lines.lot_id", id).order("sorted_on").order("created_at")),
    q(sb.from("v_dn_calc").select("*").eq("lot_id", id)),
    q(sb.from("v_dn_calc_lines").select("*").eq("lot_id", id)),
    q(sb.from("notes").select("*, note_lines(*)").eq("lot_id", id).order("approved_at")),
    q(sb.from("returns").select("*").eq("lot_id", id).order("dispatched_on")),
    q(sb.from("sort_categories").select("*").order("sort")),
    q(sb.from("v_sorting_exceptions").select("*").eq("lot_id", id)),
  ]);
  const supId = lot.deals?.supplier_id as string;
  const [payable, payments, tds, priceHistory, holds] = money && inv ? await Promise.all([
    q(sb.from("v_payable").select("*").eq("invoice_id", inv)),
    q(sb.from("payments").select("*").eq("invoice_id", inv).order("paid_on")),
    q(sb.from("tds").select("*").eq("invoice_id", inv).order("deducted_on")),
    q(sb.from("deal_rate_history").select("*, profiles(full_name)").eq("lot_id", id).order("changed_at", { ascending: false })),
    q(sb.from("v_payment_holds").select("*").in("ref_id", [id, supId])),
    ]) : [[], [], [], [], []];
  const ids = [inv, ...notes.map((n) => n.id), ...payments.map((p) => p.id), ...tds.map((x) => x.id)].filter(Boolean) as string[];
  const marks = ids.length ? await q(sb.from("tally_marks").select("*").in("entity_id", ids)) : [];
  return { lot, v: v[0] ?? {}, lines, sorting, calc, calcLines, notes, returns, cats, exc, payable: payable[0], payments, tds, priceHistory, hold: holds[0] as Row | undefined, marks };
}
export type LotData = Awaited<ReturnType<typeof loadLot>>;

export default function Lot({ id, tab }: { id: string; tab?: string }) {
  const t = useT(); const can = useCan();
  const { data, error, reload } = useLoad(() => loadLot(id, can("money_view")), [id]);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const d = data; const sup = d.lot.deals?.suppliers ?? {};
  const cur = tab ?? "summary";
  const live = d.notes.filter((n) => n.status !== "cancelled");
  const tabs = [
    { id: "summary", label: t("Summary", "सारांश") },
    { id: "weights", label: t("Weights", "वज़न") },
    { id: "sorting", label: t("Sorting", "छँटाई"), badge: d.sorting.length },
    { id: "dn", label: noteWord(t, d.v.supplier_type, true), badge: d.calc.filter((c) => !c.approved).length },
    { id: "docs", label: t("Documents", "दस्तावेज़"), badge: Number(d.v.doc_gaps) || 0 },
    ...(can("money_view") && isDomestic(d) ? [{ id: "pay", label: t("Payment", "पेमेंट") }] : []),
  ];
  return (
    <>
      <button type="button" className="link back" onClick={() => history.back()}>← {t("Back", "वापस")}</button>
      <div className="page-head">
        <div>
          <h1>{d.lot.lot_no}</h1>
          <p className="muted"><a href={`#/deal/${d.lot.deal_id}`}>{d.lot.deals?.deal_no}</a> · {sup.name}</p>
        </div>
        <StageChip stage={d.v.stage} />
      </div>
      <Tabs tabs={tabs} value={cur} onChange={(x) => { history.replaceState(null, "", `#/lot/${id}/${x}`); window.dispatchEvent(new HashChangeEvent("hashchange")); }} />
      {cur === "summary" && <Summary d={d} live={live} reload={reload} />}
      {cur === "weights" && <Weights d={d} reload={reload} />}
      {cur === "sorting" && <Sorting d={d} reload={reload} />}
      {cur === "dn" && <Notes d={d} reload={reload} />}
      {cur === "docs" && <DealDocs dealId={d.lot.deal_id} dealNo={d.lot.deals?.deal_no} hasReturn={d.returns.length > 0} />}
      {cur === "pay" && <Pay d={d} reload={reload} />}
    </>
  );
}

// ---------------- summary ----------------
function Summary({ d, live, reload }: { d: LotData; live: Row[]; reload: () => void }) {
  const t = useT(); const can = useCan();
  const inv = d.lot.invoices;
  return (
    <>
      <Stepper stage={d.v.stage} />
      <PriceDecisions lotId={d.lot.id} onDone={reload} />
      <KV rows={[
        [t("Received", "माल आया"), `${day(d.lot.received_on)} · ${d.v.days_open} ${t("days ago", "दिन पहले")}`],
        [t("Vehicle", "गाड़ी"), d.lot.vehicle_no ?? "—"],
        [docWord(t, d.v.doc_kind), inv ? `${inv.invoice_no} · ${day(inv.invoice_date)}` : "—"],
        ...(d.lot.sent_by ? [[t("Sent by", "किसने भेजा"), d.lot.sent_by] as [string, string]] : []),
        [t("Weight short", "वज़न कम"), kg(d.v.weight_short_kg)],
        ...(Number(d.v.weight_excess_kg) > 0 ? [[t("Weight excess", "वज़न ज़्यादा"), kg(d.v.weight_excess_kg), "warn"] as [string, string, string]] : []),
        [t("Sorting", "छँटाई"), d.lot.sorting_closed_at ? `${t("Closed", "बंद")} ${day(d.lot.sorting_closed_at)}` : t("Open", "चालू")],
        ...(can("money_view") && d.payable ? [
          [t("Invoice total", "बिल कुल"), inr(d.payable.total)],
          [t("Debit notes", "डेबिट नोट"), inr(d.payable.notes)],
          [t("Balance to pay", "देना बाकी"), <strong key="b">{inr(d.payable.balance)}</strong>],
        ] as [string, JSX.Element | string][] : []),
      ]} />
      {can("money_view") && isDomestic(d) && inv && <TermsBox d={d} reload={reload} />}
      {can("money_view") && isDomestic(d) && inv && <TruckPrice d={d} locked={live.length > 0} reload={reload} />}
      {d.exc.length > 0 && (
        <div className="warnbox">
          <strong>{t("Sorted but not fully debited", "छँटा पर पूरा डेबिट नहीं हुआ")}</strong>
          {d.exc.map((x, i) => <p key={i}>{x.grade} {x.category}: {kg(x.kg_not_debited)} · {inr(x.value_not_recovered)} · {x.reasons}</p>)}
        </div>
      )}
      <Section title={t("Entered in Tally?", "टैली में दर्ज?")}>
        <ul className="rows tally">
          {inv && <li><div className="row static"><span className="row-main"><span>{isDomestic(d) ? t("Purchase invoice", "खरीद बिल") : docWord(t, d.v.doc_kind)} {inv.invoice_no}</span></span>
            <span className="ticks"><TallyTick entity="invoice" id={inv.id} book="factory" marks={d.marks} onDone={reload} />{isDomestic(d) && <TallyTick entity="invoice" id={inv.id} book="office" marks={d.marks} onDone={reload} />}</span></div></li>}
          {live.map((n) => <li key={n.id}><div className="row static"><span className="row-main"><span>{isDomestic(d) ? t(...DN_LABEL[n.dn_type]) : noteWord(t, d.v.supplier_type)} {n.tally_no ?? ""} · {isDomestic(d) ? inr(n.total) : kg(noteKg(n))}</span></span>
            <span className="ticks"><TallyTick entity="note" id={n.id} book="factory" marks={d.marks} onDone={reload} />{isDomestic(d) && <TallyTick entity="note" id={n.id} book="office" marks={d.marks} onDone={reload} />}</span></div></li>)}
          {d.payments.filter((p) => p.status === "reconciled").map((p) => <li key={p.id}><div className="row static"><span className="row-main"><span>{t("Payment", "पेमेंट")} {inr(p.amount)} · {day(p.paid_on)}</span></span>
            <span className="ticks"><TallyTick entity="payment" id={p.id} book="office" marks={d.marks} onDone={reload} /></span></div></li>)}
          {d.tds.map((x) => <li key={x.id}><div className="row static"><span className="row-main"><span>TDS {x.section} · {inr(x.amount)}</span></span>
            <span className="ticks"><TallyTick entity="tds" id={x.id} book="office" marks={d.marks} onDone={reload} /></span></div></li>)}
        </ul>
      </Section>
      <div className="actions">
        <Btn onClick={() => printLot(d)}>{t("Print lot summary", "लॉट सारांश प्रिंट करें")}</Btn>
        {live.length > 0 && <Btn onClick={() => exportTally(d)}>{isDomestic(d) ? t("Download debit notes for Tally (CSV)", "टैली के लिए डेबिट नोट (CSV)") : t("Download notes for Tally (CSV)", "टैली के लिए नोट (CSV)")}</Btn>}
      </div>
    </>
  );
}

// ---------------- weights ----------------
// Payment terms for this lot (else the deal's, else the supplier's) and the hold, with one button to change them
function TermsBox({ d, reload }: { d: LotData; reload: () => void }) {
  const t = useT(); const can = useCan();
  const [open, setOpen] = useState(false);
  const deal = d.lot.deals ?? {}; const sup = deal.suppliers ?? {};
  const own = d.lot.provisional_pct != null || d.lot.provisional_days != null || d.lot.balance_days != null || d.lot.hold_pct != null;
  return (
    <Section title={t("Payment terms", "पेमेंट शर्तें")} right={can("deal_edit") ? <Btn small onClick={() => setOpen(true)}>{t("Set for this lot", "इस लॉट के लिए")}</Btn> : undefined}>
      <p><TermsLine pct={d.lot.provisional_pct ?? deal.provisional_pct ?? sup.provisional_pct} pdays={d.lot.provisional_days ?? deal.provisional_days ?? sup.provisional_days} bdays={d.lot.balance_days ?? deal.balance_days ?? sup.balance_days} />
        <span className="muted small"> · {own ? t("set for this lot", "इस लॉट के लिए तय") : t("from the deal or supplier", "सौदे या सप्लायर से")}</span></p>
      {d.hold ? <HoldBox h={d.hold} reload={reload} />
        : <p className="muted small">{t("No hold set. Set a hold % to be alerted when that much is paid.", "रोक तय नहीं। तय करें तो उतना देने पर सूचना मिलेगी।")}</p>}
      {open && <TermsSheet table="lots" id={d.lot.id} row={d.lot} onClose={() => setOpen(false)} onSaved={reload} />}
    </Section>
  );
}
function HoldBox({ h, reload }: { h: Row; reload: () => void }) {
  const t = useT(); const can = useCan(); const s = useSave();
  if (h.status === "cleared") return <p className="muted small">{t("Hold", "रोक")} {h.hold_pct}%: {t("paid in full.", "पूरा दे दिया।")}</p>;
  return (
    <>
      <HoldHint h={h} />
      {h.status === "holding" && can("payment_enter") && <div className="actions">
        <Btn small disabled={s.busy} onClick={() => s.run(() => rpc("ack_payment_hold", { p_scope: h.scope, p_ref: h.ref_id }), reload, ["Noted", "नोट किया"])}>{t("Noted: stop paying", "नोट किया: पेमेंट रोकें")}</Btn></div>}
    </>
  );
}

// The price this truck is bought at: fixed when it came in; after that only Himanshu (rate_confirm) changes it.
function TruckPrice({ d, locked, reload }: { d: LotData; locked: boolean; reload: () => void }) {
  const t = useT(); const can = useCan(); const lang = useLang();
  const edit = can("rate_confirm") && !locked;
  const names = Object.fromEntries(d.lines.map((l) => [l.grade, nm(lang, { name: l.grade_name, name_hi: l.grade_name_hi })]));
  return (
    <Section title={t("Price for this truck", "इस ट्रक का रेट")}>
      <table className="tbl">
        <thead><tr><th>{t("Grade", "ग्रेड")}</th><th className="n">{t("Invoice", "बिल")}</th><th className="n">{t("Our price", "हमारा रेट")}</th></tr></thead>
        <tbody>{d.lines.map((l) => <tr key={l.lot_line_id}><td>{names[l.grade]}</td><td className="n">{inr(l.billed_rate)}</td>
          <td className="n"><RateCell rate={l.deal_rate} label={l.grade} editable={edit} save={(v) => rpc("set_lot_rate", { p_lot: d.lot.id, p_grade: l.grade, p_rate: v })} onSaved={reload} /></td></tr>)}</tbody>
      </table>
      <p className="muted small">{edit ? t("Fixed when the truck came in. Tap to change it; only you can.", "ट्रक आते ही तय हुआ। बदलने के लिए टैप करें; सिर्फ़ आप बदल सकते हैं।")
        : can("rate_confirm") ? t("Debit notes are approved: cancel them to change the price.", "डेबिट नोट मंज़ूर हैं: रेट बदलने के लिए उन्हें रद्द करें।")
        : t("Fixed when the truck came in. Only Himanshu can change it.", "ट्रक आते ही तय हुआ। सिर्फ़ हिमांशु बदल सकते हैं।")}</p>
      {d.priceHistory.length > 0 && <RateHistory rows={d.priceHistory} names={names} />}
    </Section>
  );
}

function Weights({ d, reload }: { d: LotData; reload: () => void }) {
  const t = useT(); const can = useCan(); const lang = useLang();
  const locked = d.notes.some((n) => n.status !== "cancelled");
  const [edit, setEdit] = useState<Row | null>(null);
  const [invEdit, setInvEdit] = useState(false);
  const inv = d.lot.invoices;
  const sumTax = d.lines.reduce((a, l) => a + Number(l.billed_net_kg ?? 0) * Number(l.billed_rate ?? 0), 0);
  return (
    <>
      {locked && <p className="muted small">{t("Weights are locked because debit notes are approved. Cancel the notes to correct them.", "डेबिट नोट मंज़ूर हैं, इसलिए वज़न लॉक है। सुधारने के लिए नोट रद्द करें।")}</p>}
      {d.lines.map((l) => {
        const diff = Number(l.weight_diff_kg);
        return (
          <div className="card" key={l.lot_line_id}>
            <div className="item-head"><h3>{nm(lang, { name: l.grade_name, name_hi: l.grade_name_hi })}</h3>
              <Chip tone={diff > 0.0005 ? "bad" : diff < -0.0005 ? "wait" : "ok"}>{diff > 0.0005 ? `${t("Short", "कम")} ${kg(diff)}` : diff < -0.0005 ? `${t("Excess", "ज़्यादा")} ${kg(-diff)}` : t("Matches", "बराबर")}</Chip></div>
            <table className="tbl compact">
              <thead><tr><th></th><th className="n">{t("Supplier", "सप्लायर")}</th><th className="n">{t("Ours", "हमारा")}</th></tr></thead>
              <tbody>
                <tr><td>{t("Gross", "कुल")}</td><td className="n">{kg(l.slip_gross_kg)}</td><td className="n">{kg(l.factory_gross_kg)}</td></tr>
                <tr><td>{t("Bags", "बोरी")}</td><td className="n">{kg(l.slip_bag_kg)}</td><td className="n">{kg(l.factory_bag_kg)}{l.bag_count != null ? ` (${l.bag_count})` : ""}</td></tr>
                <tr><td><strong>{t("Net", "नेट")}</strong></td><td className="n"><strong>{kg(l.billed_net_kg)}</strong></td><td className="n"><strong>{kg(l.factory_net_kg)}</strong></td></tr>
              </tbody>
            </table>
            {l.slip_vs_invoice_kg != null && Math.abs(Number(l.slip_vs_invoice_kg)) > 0.0005 &&
              <p className="warn">{t("Packing slip nets to", "पैकिंग स्लिप का नेट")} {kg(l.slip_net_kg)}, {t("invoice bills", "बिल में")} {kg(l.billed_net_kg)}.</p>}
            {l.rate_vs_deal != null && Math.abs(Number(l.rate_vs_deal)) > 0.0005 &&
              <p className="warn">{t("Invoice rate", "बिल रेट")} {inr(l.billed_rate)} {t("differs from agreed", "तय रेट से अलग")} {inr(l.deal_rate)}.</p>}
            {can("inward_edit") && !locked && <Btn small onClick={() => setEdit(l)}>{t("Correct weights", "वज़न सुधारें")}</Btn>}
          </div>
        );
      })}
      {inv && (
        <div className="card">
          <h3>{t("Invoice", "बिल")} {inv.invoice_no}</h3>
          <KV rows={[
            [t("Date", "तारीख"), day(inv.invoice_date)],
            ...(can("money_view") ? [[t("Taxable", "कर योग्य"), inr(inv.taxable_value)], [`GST ${inv.gst_rate}%`, inr(inv.gst_amount)], [t("Total", "कुल"), inr(inv.total)]] as [string, string][] : []),
            ["GSTR-2B", inv.in_2b ? `✓ ${inv.gstr2b_period ?? ""}` : t("Not yet", "अभी नहीं")],
          ]} />
          {can("money_view") && Math.abs(sumTax - Number(inv.taxable_value)) > 1 &&
            <p className="warn">{t("Taxable value differs from billed weights × rate", "कर योग्य रकम बिल वज़न × रेट से अलग है")} ({inr(sumTax)}).</p>}
          {can("inward_edit") && !locked && <Btn small onClick={() => setInvEdit(true)}>{t("Correct invoice", "बिल सुधारें")}</Btn>}
        </div>
      )}
      {edit && <WeightEdit d={d} l={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {invEdit && inv && <InvoiceEdit inv={inv} onClose={() => setInvEdit(false)} onSaved={reload} />}
    </>
  );
}

function WeightEdit({ d, l, onClose, onSaved }: { d: LotData; l: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const s = (v: unknown) => (v == null ? "" : String(v));
  const [f, setF] = useState({ slipGross: s(l.slip_gross_kg), slipBags: s(l.slip_bag_kg), billed: s(l.billed_net_kg), rate: s(l.billed_rate), gross: s(l.factory_gross_kg), bags: s(l.bag_count), bagKg: s(l.factory_bag_kg) });
  const sv = useSave();
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  const save = () => sv.run(async () => {
    if (!isNum(f.billed) || !isNum(f.rate) || !isNum(f.gross)) throw new Error(t("Billed net, rate and our gross are required.", "बिल नेट, रेट और हमारा कुल वज़न ज़रूरी है।"));
    await q(sb.from("lot_lines").update({ factory_gross_kg: n(f.gross), bag_count: n(f.bags), factory_bag_kg: n(f.bagKg) ?? 0 }).eq("id", l.lot_line_id));
    if (d.lot.invoice_id) await q(sb.from("invoice_lines").update({ billed_net_kg: n(f.billed), billed_rate: n(f.rate), slip_gross_kg: n(f.slipGross), slip_bag_kg: n(f.slipBags) }).eq("invoice_id", d.lot.invoice_id).eq("grade", l.grade));
  }, () => { onSaved(); onClose(); });
  const fld = (k: keyof typeof f, label: string, suffix?: string) => <Field label={label}><NumIn value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} suffix={suffix} /></Field>;
  return (
    <Sheet title={`${t("Correct weights", "वज़न सुधारें")} · ${l.grade}`} onClose={onClose} footer={<SaveBar busy={sv.busy} error={sv.error} onSave={save} label={t("Save", "सेव करें")} />}>
      <p className="label-row">{t("As per supplier", "सप्लायर के अनुसार")}</p>
      <div className="grid2">{fld("slipGross", t("Slip gross", "स्लिप कुल"), "kg")}{fld("slipBags", t("Slip bags", "स्लिप बोरी"), "kg")}{fld("billed", t("Billed net", "बिल नेट"), "kg")}{fld("rate", t("Billed rate", "बिल रेट"), "₹/kg")}</div>
      <p className="label-row">{t("At our weighbridge", "हमारे काँटे पर")}</p>
      <div className="grid2">{fld("gross", t("Gross", "कुल वज़न"), "kg")}{fld("bags", t("Number of bags", "बोरी गिनती"))}{fld("bagKg", t("Bag weight", "बोरी वज़न"), "kg")}</div>
    </Sheet>
  );
}

function InvoiceEdit({ inv, onClose, onSaved }: { inv: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ no: inv.invoice_no as string, date: inv.invoice_date as string, tax: String(inv.taxable_value), gst: String(inv.gst_amount), total: String(inv.total) });
  const sv = useSave();
  return (
    <Sheet title={t("Correct invoice", "बिल सुधारें")} onClose={onClose}
      footer={<SaveBar busy={sv.busy} error={sv.error} label={t("Save", "सेव करें")} onSave={() => sv.run(async () => {
        if (!f.no.trim() || !isNum(f.tax) || !isNum(f.gst) || !isNum(f.total)) throw new Error(t("Fill every field.", "सारे खाने भरें।"));
        await q(sb.from("invoices").update({ invoice_no: f.no.trim(), invoice_date: f.date, taxable_value: Number(f.tax), gst_amount: Number(f.gst), total: Number(f.total) }).eq("id", inv.id));
      }, () => { onSaved(); onClose(); })} />}>
      <div className="grid2">
        <Field label={t("Invoice number", "बिल नंबर")}><TextIn value={f.no} onValue={(v) => setF({ ...f, no: v })} /></Field>
        <Field label={t("Invoice date", "बिल तारीख")}><DateIn value={f.date} onChange={(v) => setF({ ...f, date: v })} futureOnly /></Field>
        <Field label={t("Taxable", "कर योग्य")}><NumIn value={f.tax} onChange={(v) => setF({ ...f, tax: v })} suffix="₹" /></Field>
        <Field label="GST"><NumIn value={f.gst} onChange={(v) => setF({ ...f, gst: v })} suffix="₹" /></Field>
        <Field label={t("Total", "कुल")}><NumIn value={f.total} onChange={(v) => setF({ ...f, total: v })} suffix="₹" /></Field>
      </div>
    </Sheet>
  );
}

// ---------------- sorting ----------------
function Sorting({ d, reload }: { d: LotData; reload: () => void }) {
  const t = useT(); const can = useCan(); const lang = useLang();
  const [add, setAdd] = useState(false);
  const s = useSave();
  const closed = !!d.lot.sorting_closed_at;
  const catName = (c: string) => nm(lang, d.cats.find((x) => x.code === c)) || c;
  return (
    <>
      <Err error={s.error} />
      {!closed && can("sorting_edit") && <Btn kind="primary" className="block big" onClick={() => setAdd(true)}>+ {t("Add sorting result", "छँटाई दर्ज करें")}</Btn>}
      {d.lines.map((l) => {
        const rows = d.sorting.filter((x) => x.lot_line_id === l.lot_line_id);
        const pct = Number(l.factory_net_kg) ? (Number(l.sorted_kg) / Number(l.factory_net_kg)) * 100 : 0;
        return (
          <Section key={l.lot_line_id} title={`${nm(lang, { name: l.grade_name, name_hi: l.grade_name_hi })} · ${kg(l.factory_net_kg)}`}
                   right={<span className="muted small">{t("Taken out", "निकाला")} {kg(l.sorted_kg)} ({pct.toFixed(1)}%)</span>}>
            {rows.length === 0 ? <Empty>{t("Nothing entered yet.", "अभी कुछ दर्ज नहीं।")}</Empty> : (
              <ul className="rows">{rows.map((x) => (
                <li key={x.id} className={x.action === "return" ? "edge-bad" : "edge-wait"}>
                  <div className="row static">
                    <span className="row-main">
                      <strong>{catName(x.category)} · {kg(x.sorted_kg)}</strong>
                      <span className="muted small">{day(x.sorted_on)} · {x.action === "return" ? t("Return", "वापस") : `${t("Rate cut", "रेट कटौती")} ${inr(x.rate_cut)}/kg`}
                        {Number(x.dn_kg) !== Number(x.sorted_kg) ? ` · ${t("debit", "डेबिट")} ${kg(x.dn_kg)} (${x.change_reason})` : ""}</span>
                    </span>
                    {!closed && can("sorting_edit") && <button type="button" className="x" aria-label={t("Delete", "हटाएँ")}
                      onClick={() => { if (confirm(t("Delete this entry?", "यह एंट्री हटाएँ?"))) s.run(() => q(sb.from("sorting_lines").delete().eq("id", x.id)), reload, ["Deleted", "हटा दिया"]); }}>×</button>}
                  </div>
                </li>))}
              </ul>)}
          </Section>
        );
      })}
      {d.exc.length > 0 && <div className="warnbox"><strong>{t("Sorted but not fully debited", "छँटा पर पूरा डेबिट नहीं हुआ")}</strong>
        {d.exc.map((x, i) => <p key={i}>{x.grade} {x.category}: {kg(x.kg_not_debited)} · {inr(x.value_not_recovered)}</p>)}</div>}
      {can("lot_close") && (closed
        ? <div className="card"><p>{t("Sorting closed on", "छँटाई बंद हुई")} {day(d.lot.sorting_closed_at)}.</p>
            <Btn onClick={() => s.run(() => rpc("reopen_lot", { p_lot: d.lot.id }), reload)}>{t("Reopen sorting", "छँटाई फिर खोलें")}</Btn></div>
        : <Btn kind="primary" className="block" onClick={() => { if (confirm(t("Is sorting of this whole lot finished?", "क्या पूरे लॉट की छँटाई हो गई?"))) s.run(() => rpc("close_lot", { p_lot: d.lot.id }), reload); }}>
            ✓ {t("Sorting finished: close lot", "छँटाई पूरी: लॉट बंद करें")}</Btn>)}
      {add && <SortingSheet d={d} onClose={() => setAdd(false)} onSaved={reload} />}
    </>
  );
}

function SortingSheet({ d, onClose, onSaved }: { d: LotData; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const lang = useLang();
  const cats = d.cats.filter((c) => c.active);
  const [line, setLine] = useState<string>(d.lines.length === 1 ? d.lines[0].lot_line_id : "");
  const [cat, setCat] = useState("");
  const [kgv, setKg] = useState("");
  const [date, setDate] = useState(today());
  const [action, setAction] = useState("");
  const [cut, setCut] = useState("");
  const [diff, setDiff] = useState(false);
  const [dnKg, setDnKg] = useState("");
  const [why, setWhy] = useState("");
  const [saved, setSaved] = useState(0);
  const s = useSave();
  const pickCat = (c: string) => { setCat(c); setAction(cats.find((x) => x.code === c)?.default_action ?? "return"); };
  const save = (again: boolean) => s.run(async () => {
    if (!line) throw new Error(t("Choose the grade.", "ग्रेड चुनें।"));
    if (!cat) throw new Error(t("Choose what was found.", "क्या निकला, चुनें।"));
    if (!isNum(kgv) || Number(kgv) <= 0) throw new Error(t("Enter the weight.", "वज़न डालें।"));
    if (action === "rate_diff" && (!isNum(cut) || Number(cut) <= 0)) throw new Error(t("Enter the rate cut per kg.", "प्रति kg रेट कटौती डालें।"));
    if (diff && (!isNum(dnKg) || !why.trim())) throw new Error(t("Enter the debit weight and the reason.", "डेबिट वज़न और कारण डालें।"));
    await q(sb.from("sorting_lines").insert({ lot_line_id: line, category: cat, sorted_kg: Number(kgv), sorted_on: date, action,
      rate_cut: action === "rate_diff" ? Number(cut) : null, dn_kg: diff ? Number(dnKg) : Number(kgv), change_reason: diff ? why.trim() : null }));
  }, () => { onSaved(); if (again) { setCat(""); setKg(""); setCut(""); setDiff(false); setDnKg(""); setWhy(""); setSaved((x) => x + 1); } else onClose(); });
  return (
    <Sheet title={t("Add sorting result", "छँटाई दर्ज करें")} onClose={onClose}
      footer={<><Err error={s.error} />{saved > 0 && <p className="okline">✓ {saved} {t("saved", "सेव हुए")}</p>}
        <div className="actions"><Btn kind="primary" disabled={s.busy} onClick={() => save(true)}>{t("Save and add another", "सेव करें और अगला")}</Btn>
        <Btn disabled={s.busy} onClick={() => save(false)}>{t("Save and close", "सेव करें और बंद करें")}</Btn></div></>}>
      {d.lines.length > 1 && <Field label={t("Grade", "ग्रेड")}><Choice value={line} onChange={setLine} options={d.lines.map((l) => ({ value: l.lot_line_id, label: nm(lang, { name: l.grade_name, name_hi: l.grade_name_hi }) }))} /></Field>}
      <Field label={t("What was found", "क्या निकला")}>
        <Choice value={cat} onChange={pickCat} options={cats.map((c) => ({ value: c.code, label: nm(lang, c), sub: c.default_action === "return" ? t("return", "वापस") : t("rate cut", "रेट कटौती") }))} />
      </Field>
      <div className="grid2">
        <Field label={t("Weight", "वज़न")}><NumIn value={kgv} onChange={setKg} suffix="kg" /></Field>
        <Field label={t("Date", "तारीख")}><DateIn value={date} onChange={setDate} /></Field>
      </div>
      {cat && (
        <>
          <Field label={t("What happens to it", "इसका क्या होगा")}>
            <Choice value={action} onChange={setAction} cols={2} options={[{ value: "rate_diff", label: t("Keep at lower rate", "कम रेट पर रखें") }, { value: "return", label: t("Return to supplier", "सप्लायर को वापस") }]} />
          </Field>
          {action === "rate_diff" && <Field label={t("Rate cut", "रेट कटौती")}><NumIn value={cut} onChange={setCut} suffix="₹/kg" /></Field>}
          <button type="button" className="link" onClick={() => setDiff(!diff)}>{diff ? "−" : "+"} {t("Debit a different weight", "अलग वज़न डेबिट करें")}</button>
          {diff && <div className="grid2">
            <Field label={t("Weight to debit", "डेबिट वज़न")}><NumIn value={dnKg} onChange={setDnKg} suffix="kg" /></Field>
            <Field label={t("Why different", "अलग क्यों")}><TextIn value={why} onValue={setWhy} /></Field></div>}
        </>
      )}
    </Sheet>
  );
}

// ---------------- debit notes ----------------
function Notes({ d, reload }: { d: LotData; reload: () => void }) {
  const t = useT(); const can = useCan();
  const types = ["weight_short", "price_diff", "rate_diff", "return"].filter((x) => d.calc.some((c) => c.dn_type === x) || d.notes.some((n) => n.dn_type === x && n.status !== "cancelled"));
  const live = d.notes.filter((n) => n.status !== "cancelled");
  const returnKg = live.filter((n) => n.dn_type === "return").flatMap((n) => n.note_lines).reduce((a: number, l: Row) => a + Number(l.qty_kg), 0);
  const [ret, setRet] = useState(false);
  const s = useSave();
  return (
    <>
      {types.length === 0 && <Empty>{t("Nothing to debit on this lot.", "इस लॉट पर कुछ डेबिट नहीं।")}</Empty>}
      {types.map((ty) => <NoteCard key={ty} d={d} type={ty} reload={reload} />)}
      {live.length > 0 && <Btn onClick={() => exportTally(d)}>{isDomestic(d) ? t("Download debit notes for Tally (CSV)", "टैली के लिए डेबिट नोट (CSV)") : t("Download notes for Tally (CSV)", "टैली के लिए नोट (CSV)")}</Btn>}
      {(returnKg > 0 || d.returns.length > 0) && (
        <Section title={t("Material return", "माल वापसी")} right={can("inward_edit") ? <Btn small onClick={() => setRet(true)}>+ {t("Record dispatch", "वापसी भेजी")}</Btn> : undefined}>
          <Err error={s.error} />
          {d.returns.length === 0 ? <Empty>{t("Not sent back yet.", "अभी वापस नहीं भेजा।")} {kg(returnKg)} {t("to return.", "वापस करना है।")}</Empty> :
            d.returns.map((r) => (
              <div className="item" key={r.id}>
                <div className="item-head"><strong>{kg(r.kg)} · {r.packages ?? "—"} {t("packages", "पैकेज")}</strong>
                  {r.delivered_on ? <Chip tone="ok">{t("Delivered", "पहुँच गया")} {day(r.delivered_on)}</Chip> : <Chip tone="wait">{t("In transit", "रास्ते में")}</Chip>}</div>
                <p className="muted small">{day(r.dispatched_on)} · {r.transporter ?? ""} LR {r.lr_no ?? "—"} · e-way {r.eway_bill_no ?? "—"} · {t("freight", "भाड़ा")} {inr(r.freight)} {r.freight_paid_by ? `(${r.freight_paid_by === "rich_alloys" ? t("paid by us", "हमने दिया") : t("paid by supplier", "सप्लायर ने दिया")})` : ""}</p>
                {!r.delivered_on && can("inward_edit") && <Btn small onClick={() => s.run(() => q(sb.from("returns").update({ delivered_on: today() }).eq("id", r.id)), reload)}>{t("Mark delivered today", "आज पहुँचा")}</Btn>}
              </div>))}
        </Section>
      )}
      {ret && <ReturnSheet lotId={d.lot.id} kgDefault={returnKg} onClose={() => setRet(false)} onSaved={reload} />}
    </>
  );
}

function NoteCard({ d, type, reload }: { d: LotData; type: string; reload: () => void }) {
  const t = useT(); const can = useCan();
  const note = d.notes.find((n) => n.dn_type === type && n.status !== "cancelled");
  const calc = d.calc.find((c) => c.dn_type === type);
  const lines = note ? note.note_lines : d.calcLines.filter((l) => l.dn_type === type);
  const [round, setRound] = useState(true);
  const [no, setNo] = useState<string>(note?.tally_no ?? "");
  const [cancel, setCancel] = useState<string | null>(null);
  const s = useSave();
  const closed = !!d.lot.sorting_closed_at;
  const blocked = type !== "weight_short" && !closed;
  const taxable = note ? note.taxable : calc?.taxable;
  const gst = note ? note.gst_amount : calc?.gst_amount;
  const total = note ? note.total : round ? calc?.total_rounded : calc?.total_exact;
  const stale = note && calc && Math.abs(Number(calc.taxable) - Number(note.taxable)) > 0.005;
  const money = isDomestic(d);
  const kgTotal = lines.reduce((a: number, l: Row) => a + Number(l.qty_kg), 0);
  return (
    <div className={`card note-card ${note ? "approved" : ""}`}>
      <div className="item-head"><h3>{t(...DN_LABEL[type])}{!money && <span className="muted small"> · {noteWord(t, d.v.supplier_type)}</span>}</h3>{note ? <Chip tone="ok">{t("Approved", "मंज़ूर")}</Chip> : <Chip tone="bad">{t("To approve", "मंज़ूरी बाकी")}</Chip>}</div>
      {money ? (
        <>
          <table className="tbl compact">
            <thead><tr><th>{t("Item", "विवरण")}</th><th className="n">kg</th><th className="n">{t("Rate", "रेट")}</th><th className="n">{t("Amount", "रकम")}</th></tr></thead>
            <tbody>{lines.map((l: Row, i: number) => <tr key={i}><td>{l.grade} · {l.description}</td><td className="n">{Number(l.qty_kg).toFixed(3)}</td><td className="n">{Number(l.rate).toFixed(2)}</td><td className="n">{inr(l.amount)}</td></tr>)}</tbody>
          </table>
          <KV rows={[[t("Taxable", "कर योग्य"), inr(taxable)], [`GST ${d.lot.invoices?.gst_rate ?? ""}%`, inr(gst)], ...(note && Number(note.round_off) ? [[t("Round off", "राउंड ऑफ"), Number(note.round_off).toFixed(3)] as [string, string]] : []), [t("Total", "कुल"), <strong key="t">{inr(total)}</strong>]]} />
        </>
      ) : (
        <>
          <table className="tbl compact">
            <thead><tr><th>{t("Item", "विवरण")}</th><th className="n">kg</th></tr></thead>
            <tbody>{lines.map((l: Row, i: number) => <tr key={i}><td>{l.grade} · {l.description}</td><td className="n">{Number(l.qty_kg).toFixed(3)}</td></tr>)}</tbody>
          </table>
          <KV rows={[[t("Total", "कुल"), <strong key="t">{kg(kgTotal)}</strong>]]} />
          <p className="muted small">{t("Kilograms only: no money is owed for this material. It comes off stock when approved.", "सिर्फ किलो: इस माल का पैसा नहीं बनता। मंज़ूरी पर स्टॉक से घटेगा।")}</p>
        </>
      )}
      <Err error={s.error} />
      {stale && <p className="warn">{t("Sorting changed after approval. Cancel and approve again.", "मंज़ूरी के बाद छँटाई बदली। रद्द करके फिर मंज़ूर करें।")}</p>}
      {!note && can("dn_approve") && (
        <>
          <label className="check"><input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} /> {t("Round total to the rupee", "कुल रुपये में राउंड करें")}</label>
          {blocked && <p className="muted small">{t("Close sorting first.", "पहले छँटाई बंद करें।")}</p>}
          <Btn kind="primary" className="block" disabled={blocked || s.busy} onClick={() => s.run(() => rpc("approve_dn", { p_lot: d.lot.id, p_type: type, p_date: today(), p_round: round }), reload)}>
            ✓ {money ? `${t("Approve debit note", "डेबिट नोट मंज़ूर करें")} · ${inr(total)}` : `${t("Approve", "मंज़ूर करें")} ${noteWord(t, d.v.supplier_type)} · ${kg(kgTotal)}`}</Btn>
        </>
      )}
      {note && (
        <>
          <Field label={money ? t("Debit note number from Tally", "टैली से डेबिट नोट नंबर") : t("Note number from Tally", "टैली से नोट नंबर")}>
            <span className="inline"><TextIn value={no} onValue={setNo} placeholder="RAI/DN/…" />
              {(can("tally_factory") || can("tally_office") || can("dn_approve")) && no !== (note.tally_no ?? "") &&
                <Btn small kind="primary" onClick={() => s.run(() => rpc("set_note_tally_no", { p_id: note.id, p_no: no }), reload)}>{t("Save", "सेव")}</Btn>}</span>
          </Field>
          <div className="ticks"><TallyTick entity="note" id={note.id} book="factory" marks={d.marks} onDone={reload} />{money && <TallyTick entity="note" id={note.id} book="office" marks={d.marks} onDone={reload} />}</div>
          <div className="actions">
            <Btn onClick={() => printNote(d, note)}>{t("Print working for supplier", "सप्लायर के लिए प्रिंट")}</Btn>
            {can("dn_approve") && <Btn kind="danger" onClick={() => setCancel("")}>{t("Cancel", "रद्द करें")}</Btn>}
          </div>
          {cancel !== null && (
            <div className="stack">
              <Field label={t("Why cancel? If it is already in Tally, reverse it there too.", "क्यों रद्द? टैली में दर्ज है तो वहाँ भी उलटें।")}><textarea rows={2} value={cancel} onChange={(e) => setCancel(e.target.value)} autoFocus /></Field>
              <div className="actions"><Btn kind="danger" disabled={!cancel.trim()} onClick={() => s.run(() => rpc("cancel_note", { p_id: note.id, p_reason: cancel }), () => { setCancel(null); reload(); })}>{t("Cancel debit note", "डेबिट नोट रद्द करें")}</Btn>
                <Btn onClick={() => setCancel(null)}>{t("Keep", "रखें")}</Btn></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReturnSheet({ lotId, kgDefault, onClose, onSaved }: { lotId: string; kgDefault: number; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ date: today(), kg: kgDefault ? String(kgDefault) : "", pk: "", eway: "", tr: "", lr: "", fr: "", by: "rich_alloys" });
  const s = useSave();
  return (
    <Sheet title={t("Return sent back", "वापसी भेजी")} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(async () => {
        if (!isNum(f.kg)) throw new Error(t("Enter the weight sent back.", "वापस भेजा वज़न डालें।"));
        await q(sb.from("returns").insert({ lot_id: lotId, dispatched_on: f.date, kg: Number(f.kg), packages: f.pk ? Number(f.pk) : null, eway_bill_no: f.eway || null,
          transporter: f.tr || null, lr_no: f.lr || null, freight: f.fr ? Number(f.fr) : null, freight_paid_by: f.by }));
      }, () => { onSaved(); onClose(); })} />}>
      <div className="grid2">
        <Field label={t("Sent on", "भेजने की तारीख")}><DateIn value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label={t("Weight", "वज़न")}><NumIn value={f.kg} onChange={(v) => setF({ ...f, kg: v })} suffix="kg" /></Field>
        <Field label={t("Packages", "पैकेज")}><NumIn value={f.pk} onChange={(v) => setF({ ...f, pk: v })} /></Field>
        <Field label={t("E-way bill", "ई-वे बिल")}><TextIn value={f.eway} onValue={(v) => setF({ ...f, eway: v })} /></Field>
        <Field label={t("Transporter", "ट्रांसपोर्टर")}><TextIn value={f.tr} onValue={(v) => setF({ ...f, tr: v })} /></Field>
        <Field label="LR"><TextIn value={f.lr} onValue={(v) => setF({ ...f, lr: v })} /></Field>
        <Field label={t("Freight", "भाड़ा")}><NumIn value={f.fr} onChange={(v) => setF({ ...f, fr: v })} suffix="₹" /></Field>
      </div>
      <Field label={t("Freight paid by", "भाड़ा किसने दिया")}><Choice value={f.by} onChange={(v) => setF({ ...f, by: v })} cols={2} options={[{ value: "rich_alloys", label: t("Us", "हमने") }, { value: "supplier", label: t("Supplier", "सप्लायर") }]} /></Field>
    </Sheet>
  );
}

// ---------------- payment ----------------
function Pay({ d, reload }: { d: LotData; reload: () => void }) {
  const t = useT(); const can = useCan();
  const [pay, setPay] = useState(false);
  const [tds, setTds] = useState(false);
  const [terms, setTerms] = useState(false);
  const p = d.payable; const sup = d.lot.deals?.suppliers ?? {}; const deal = d.lot.deals ?? {};
  const s = useSave();
  if (!p) return <Empty>{t("No invoice on this lot.", "इस लॉट पर बिल नहीं।")}</Empty>;
  return (
    <>
      <KV rows={[
        [t("Invoice total", "बिल कुल"), inr(p.total)],
        [t("Less debit notes", "घटाएँ डेबिट नोट"), `− ${inr(p.notes)}`],
        [t("Less TDS", "घटाएँ TDS"), `− ${inr(p.tds)}`],
        [t("Less paid (reconciled)", "घटाएँ भुगतान (मिलान हुआ)"), `− ${inr(p.paid)}`],
        [t("Balance to pay", "देना बाकी"), <strong key="b">{inr(p.balance)}</strong>, "total"],
        ...(Number(p.pending) ? [[t("Paid, waiting for reconciliation", "भुगतान, मिलान बाकी"), inr(p.pending), "warn"] as [string, string, string]] : []),
      ]} />
      {d.hold && d.hold.status !== "cleared" && <HoldHint h={d.hold} />}
      <p className="muted small">{t("Terms", "शर्तें")}: <TermsLine pct={d.lot.provisional_pct ?? deal.provisional_pct ?? sup.provisional_pct} pdays={d.lot.provisional_days ?? deal.provisional_days ?? sup.provisional_days} bdays={d.lot.balance_days ?? deal.balance_days ?? sup.balance_days} />
        {can("deal_edit") && <> · <button type="button" className="link" onClick={() => setTerms(true)}>{t("Change for this lot", "इस लॉट के लिए बदलें")}</button></>}</p>
      <Section title={t("Payments", "भुगतान")} right={can("payment_enter") ? <Btn small kind="primary" onClick={() => setPay(true)}>+ {t("Record payment", "पेमेंट दर्ज करें")}</Btn> : undefined}>
        {d.payments.length === 0 ? <Empty>{t("No payments yet.", "अभी कोई भुगतान नहीं।")}</Empty> : d.payments.map((x) => <PaymentRow key={x.id} p={x} marks={d.marks} onChange={reload} />)}
      </Section>
      <Section title="TDS" right={can("tax_edit") ? <Btn small onClick={() => setTds(true)}>+ {t("Add TDS", "TDS जोड़ें")}</Btn> : undefined}>
        <Err error={s.error} />
        {d.tds.length === 0 ? <Empty>{t("No TDS recorded.", "कोई TDS दर्ज नहीं।")}</Empty> : d.tds.map((x) => (
          <div className="item" key={x.id}>
            <div className="item-head"><strong>{inr(x.amount)} · {x.kind === "gst" ? t("GST TDS", "GST TDS") : `${t("Income-tax TDS", "आयकर TDS")}${x.section ? ` ${x.section}` : ""}`}</strong><span className="muted small">{day(x.deducted_on)}</span></div>
            <div className="actions"><TallyTick entity="tds" id={x.id} book="office" marks={d.marks} onDone={reload} />
              {can("tax_edit") && <Btn small kind="ghost" onClick={() => { if (confirm(t("Remove this TDS entry?", "यह TDS हटाएँ?"))) s.run(() => q(sb.from("tds").delete().eq("id", x.id)), reload, ["Removed", "हटा दिया"]); }}>{t("Remove", "हटाएँ")}</Btn>}</div>
          </div>))}
      </Section>
      {pay && <PaymentSheet supplierId={d.lot.deals?.supplier_id} invoiceId={d.lot.invoice_id} onClose={() => setPay(false)} onSaved={reload} />}
      {tds && <TdsSheet invoice={d.lot.invoices} onClose={() => setTds(false)} onSaved={reload} />}
      {terms && <TermsSheet table="lots" id={d.lot.id} row={d.lot} onClose={() => setTerms(false)} onSaved={reload} />}
    </>
  );
}

export function TdsSheet({ invoice, onClose, onSaved }: { invoice: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ section: "194Q", amount: "", date: today(), kind: "it" });
  const s = useSave();
  return (
    <Sheet title={`TDS · ${invoice.invoice_no}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(async () => {
        if (!isNum(f.amount) || Number(f.amount) <= 0) throw new Error(t("Enter the TDS amount deducted.", "काटा गया TDS डालें।"));
        await q(sb.from("tds").insert({ invoice_id: invoice.id, kind: f.kind, section: (f.kind === "gst" ? "GST" : f.section.trim().toUpperCase()) || null, amount: Number(f.amount), deducted_on: f.date }));
      }, () => { onSaved(); onClose(); })} />}>
      <p className="muted small">{t("Usually entered with the payment. Use this only for TDS deducted separately.", "आम तौर पर पेमेंट के साथ डलता है। अलग से काटा हो तभी यहाँ डालें।")}</p>
      <div className="grid2">
        <Field label={t("Type", "प्रकार")}><Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[
          { value: "it", label: t("Income-tax TDS", "आयकर TDS") }, { value: "gst", label: t("GST TDS", "GST TDS") }]} /></Field>
        <Field label={t("TDS amount", "TDS रकम")}><NumIn value={f.amount} onChange={(v) => setF({ ...f, amount: v })} suffix="₹" autoFocus /></Field>
        {f.kind === "it" && <Field label={t("Section", "सेक्शन")}><TextIn value={f.section} onValue={(v) => setF({ ...f, section: v })} /></Field>}
        <Field label={t("Deducted on", "काटने की तारीख")}><DateIn value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
      </div>
    </Sheet>
  );
}

// ---------------- print and export ----------------
function exportTally(d: LotData) {
  q(sb.from("v_tally_dn_export").select("*").eq("lot_id", d.lot.id).order("dn_type")).then((rows) => {
    download(`${d.lot.lot_no}-debit-notes.csv`, csv(rows, [
      ["tally_no", "Tally DN no"], ["note_date", "Date"], ["dn_type", "Type"], ["party", "Party"], ["party_gstin", "Party GSTIN"],
      ["against_invoice", "Against invoice"], ["invoice_date", "Invoice date"], ["grade", "Grade"], ["description", "Description"],
      ["qty_kg", "Qty kg"], ["rate", "Rate"], ["amount", "Amount"], ["stock_kg", "Stock kg out"], ["taxable", "Note taxable"],
      ["gst_amount", "Note GST"], ["round_off", "Round off"], ["total", "Note total"], ["lot_no", "Lot"], ["deal_no", "Deal"]]));
  }).catch((e: Error) => alert(e.message));
}

function head(d: LotData, title: string) {
  const sup = d.lot.deals?.suppliers ?? {}; const inv = d.lot.invoices ?? {};
  return `<div class="box"><div><h1>${esc(title)}</h1><div class="muted">${esc(COMPANY.name)}<br>${esc(COMPANY.address)}<br>GSTIN ${COMPANY.gstin}</div></div>
    <div><b>${esc(sup.name)}</b><br>GSTIN ${esc(sup.gstin ?? "—")}<br>${esc(docWord((en) => en, d.v.doc_kind))} ${esc(inv.invoice_no ?? "—")} dated ${esc(day(inv.invoice_date))}<br>Lot ${esc(d.lot.lot_no)} · Deal ${esc(d.lot.deals?.deal_no)}</div></div>`;
}

function printNote(d: LotData, n: Row) {
  const label = DN_LABEL[n.dn_type][0];
  if (!isDomestic(d)) {
    const title = noteWord((en) => en, d.v.supplier_type);
    const kgRows = n.note_lines.map((l: Row) => `<tr><td>${esc(l.grade)} · ${esc(l.description)}</td><td class="n">${Number(l.qty_kg).toFixed(3)}</td></tr>`).join("");
    printHtml(`${title} ${n.tally_no ?? ""}`, `${head(d, `${title}: ${label}`)}
      <p>Note no. <b>${esc(n.tally_no ?? "—")}</b> · dated ${esc(day(n.note_date))}</p>
      <table><thead><tr><th>Description</th><th class="n">Qty kg</th></tr></thead><tbody>${kgRows}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="n"><b>${noteKg(n).toFixed(3)}</b></td></tr></tfoot></table>
      <p class="muted">Quantity only. Calculated from our weighbridge and sorting records.</p>`);
    return;
  }
  const rows = n.note_lines.map((l: Row) => `<tr><td>${esc(l.grade)} · ${esc(l.description)}</td><td class="n">${Number(l.qty_kg).toFixed(3)}</td><td class="n">${Number(l.rate).toFixed(2)}</td><td class="n">${esc(inr(l.amount))}</td></tr>`).join("");
  printHtml(`${label} ${n.tally_no ?? ""}`, `${head(d, `Debit note working: ${label}`)}
    <p>Debit note no. <b>${esc(n.tally_no ?? "(issued from Tally)")}</b> · dated ${esc(day(n.note_date))}</p>
    <table><thead><tr><th>Description</th><th class="n">Qty kg</th><th class="n">Rate ₹/kg</th><th class="n">Amount ₹</th></tr></thead><tbody>${rows}</tbody></table>
    <table><tbody><tr><td>Taxable</td><td class="n">${esc(inr(n.taxable))}</td></tr><tr><td>GST ${esc(d.lot.invoices?.gst_rate)}%</td><td class="n">${esc(inr(n.gst_amount))}</td></tr>
    <tr><td>Round off</td><td class="n">${Number(n.round_off).toFixed(3)}</td></tr><tr><td><b>Total</b></td><td class="n"><b>${esc(inr(n.total))}</b></td></tr></tbody></table>
    <p class="muted">Calculated from our weighbridge and sorting records. Photos are available on request.</p>`);
}

function printLot(d: LotData) {
  const w = d.lines.map((l) => `<tr><td>${esc(l.grade)}</td><td class="n">${esc(kg(l.billed_net_kg))}</td><td class="n">${esc(kg(l.factory_gross_kg))}</td><td class="n">${esc(kg(l.factory_bag_kg))}</td><td class="n">${esc(kg(l.factory_net_kg))}</td><td class="n">${esc(kg(l.weight_diff_kg))}</td></tr>`).join("");
  const srt = d.sorting.map((x) => `<tr><td>${esc(day(x.sorted_on))}</td><td>${esc(x.lot_lines?.grade)}</td><td>${esc(x.category)}</td><td class="n">${Number(x.sorted_kg).toFixed(3)}</td><td>${x.action === "return" ? "Return" : `Rate cut ₹${x.rate_cut}`}</td><td class="n">${Number(x.dn_kg).toFixed(3)}</td><td>${esc(x.change_reason ?? "")}</td></tr>`).join("");
  const nts = d.notes.filter((n) => n.status !== "cancelled").map((n) => `<tr><td>${esc(DN_LABEL[n.dn_type][0])}</td><td>${esc(n.tally_no ?? "")}</td><td>${esc(day(n.note_date))}</td><td class="n">${esc(inr(n.total))}</td></tr>`).join("");
  const p = d.payable;
  printHtml(`${d.lot.lot_no} summary`, `${head(d, `Lot summary ${d.lot.lot_no}`)}
    <p>Received ${esc(day(d.lot.received_on))} · vehicle ${esc(d.lot.vehicle_no ?? "—")}</p>
    <h2>Weights</h2><table><thead><tr><th>Grade</th><th class="n">Billed net</th><th class="n">Our gross</th><th class="n">Our bags</th><th class="n">Our net</th><th class="n">Short (+) / excess (−)</th></tr></thead><tbody>${w}</tbody></table>
    <h2>Sorting</h2><table><thead><tr><th>Date</th><th>Grade</th><th>Found</th><th class="n">kg</th><th>Action</th><th class="n">Debited kg</th><th>Reason</th></tr></thead><tbody>${srt || "<tr><td colspan=7>None</td></tr>"}</tbody></table>
    <h2>Debit notes</h2><table><thead><tr><th>Type</th><th>Tally no</th><th>Date</th><th class="n">Total</th></tr></thead><tbody>${nts || "<tr><td colspan=4>None</td></tr>"}</tbody></table>
    ${p ? `<h2>Payment</h2><table><tbody><tr><td>Invoice total</td><td class="n">${esc(inr(p.total))}</td></tr><tr><td>Debit notes</td><td class="n">${esc(inr(p.notes))}</td></tr><tr><td>TDS</td><td class="n">${esc(inr(p.tds))}</td></tr><tr><td>Paid (reconciled)</td><td class="n">${esc(inr(p.paid))}</td></tr><tr><td><b>Balance</b></td><td class="n"><b>${esc(inr(p.balance))}</b></td></tr></tbody></table>` : ""}`);
}
