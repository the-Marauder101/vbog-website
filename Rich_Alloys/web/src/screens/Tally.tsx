import { useState } from "react";
import { BUCKET, COMPANY, csv, day, download, go, inr, kg, q, rpc, sb, today, useCan, useLoad, useT, type Row } from "../lib";
import { Btn, Chip, Empty, Err, KV, Loading, Section, Tabs, TextIn } from "../ui";
import { DN_LABEL, useSave } from "../common";

// The two Tallys' to-do lists. Each item shows what to type into Tally; ticking it records the voucher
// number and the amount, so a later change in the portal comes back here as "correct in Tally".
const ENTITY: Record<string, [string, string]> = {
  invoice: ["Purchase invoice", "खरीद बिल"], note: ["Debit note", "डेबिट नोट"], payment: ["Payment", "भुगतान"],
  tds: ["TDS", "TDS"], production: ["Production", "उत्पादन"],
};

export default function Tally({ tab }: { tab?: string }) {
  const t = useT(); const can = useCan();
  const tabs = [
    ...(can("tally_factory") || can("admin") ? [{ id: "factory", label: t("Factory Tally", "फैक्ट्री टैली") }] : []),
    ...(can("tally_office") || can("admin") ? [{ id: "office", label: t("Office Tally", "ऑफिस टैली") }] : []),
    { id: "register", label: t("Invoice register", "बिल रजिस्टर") },
  ];
  const cur = tabs.some((x) => x.id === tab) ? tab! : tabs[0].id;
  const setTab = (x: string) => { history.replaceState(null, "", `#/tally/${x}`); window.dispatchEvent(new HashChangeEvent("hashchange")); };
  return (
    <>
      <h1>{t("Tally", "टैली")}</h1>
      <Tabs tabs={tabs} value={cur} onChange={setTab} />
      {cur === "register" ? <Register /> : <Queue book={cur as "factory" | "office"} key={cur} />}
    </>
  );
}

function Queue({ book }: { book: "factory" | "office" }) {
  const t = useT();
  const { data, error, reload } = useLoad(() => q(sb.from("v_tally_queue").select("*").eq("book", book).order("entry_date", { ascending: true })), [book]);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const changed = data.filter((r) => r.state === "changed");
  const pending = data.filter((r) => r.state === "pending");
  const exportCsv = () => download(`${book}-tally-to-enter-${today()}.csv`, csv(pending, [
    ["entry_date", "Date"], ["entity", "Entry"], ["dn_type", "DN type"], ["supplier", "Party"], ["gstin", "GSTIN"],
    ["ref", "Reference"], ["lot_no", "Lot"], ["amount", "Amount"]]));
  const row = (r: Row) => {
    const k = `${r.state}-${r.entity}-${r.entity_id}`; const isOpen = open === k;
    return (
      <li key={k} className={r.state === "changed" ? "edge-bad" : "edge-info"}>
        <button type="button" className="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k)}>
          <span className="row-main">
            <strong>{t(...ENTITY[r.entity])}{r.dn_type ? ` · ${t(...DN_LABEL[r.dn_type])}` : ""}</strong>
            <span className="muted small">{[r.supplier, r.entity === "note" && r.ref === r.dn_type ? t("no DN number yet", "DN नंबर अभी नहीं") : r.ref, r.lot_no, day(r.entry_date)].filter(Boolean).join(" · ")}</span>
            {r.state === "changed" && <Chip tone="bad">{r.amount == null ? t("Cancelled or deleted: reverse it in Tally", "रद्द/हटाया: टैली में उलटें") : `${t("Was", "था")} ${inr(r.amount_at_mark)} · ${t("now", "अब")} ${inr(r.amount)}`}</Chip>}
          </span>
          <span className="amt">{r.entity === "production" ? kg(r.amount) : inr(r.amount)}</span>
        </button>
        {isOpen && <div className="detail"><Voucher r={r} book={book} onDone={() => { setOpen(null); reload(); }} /></div>}
      </li>
    );
  };
  return (
    <>
      <p className="muted small">{book === "factory"
        ? t("Arrivals, debit notes and production waiting to be entered in the factory Tally. Open one, enter it in Tally, then save the voucher number.", "फैक्ट्री टैली में दर्ज करने बाकी: माल आवक, डेबिट नोट, उत्पादन। खोलें, टैली में दर्ज करें, फिर वाउचर नंबर सेव करें।")
        : t("Invoices, debit notes, payments and TDS waiting to be entered in the office Tally. This replaces the emails and the shared invoice sheet.", "ऑफिस टैली में दर्ज करने बाकी: बिल, डेबिट नोट, भुगतान, TDS। यह ईमेल और साझा बिल शीट की जगह है।")}</p>
      {changed.length > 0 && (
        <Section title={`${t("Changed after entry: correct in Tally", "दर्ज होने के बाद बदला: टैली में सुधारें")} (${changed.length})`}>
          <ul className="rows">{changed.map(row)}</ul>
        </Section>
      )}
      <Section title={`${t("To enter", "दर्ज करना है")} (${pending.length})`} right={pending.length ? <Btn small onClick={exportCsv}>{t("Download list", "सूची डाउनलोड")}</Btn> : undefined}>
        {pending.length === 0 ? <Empty>{t("Everything is entered.", "सब दर्ज है।")}</Empty> : <ul className="rows">{pending.map(row)}</ul>}
      </Section>
    </>
  );
}

const interstate = (gstin?: string | null) => !!gstin && gstin.slice(0, 2) !== COMPANY.gstin.slice(0, 2);
function taxRows(t: (en: string, hi?: string) => string, gstin: string | null, rate: number, tax: number): [string, string][] {
  if (interstate(gstin)) return [[`IGST ${rate}%`, inr(tax)]];
  const half = Math.round((tax / 2) * 100) / 100;
  return [[`CGST ${rate / 2}%`, inr(half)], [`SGST ${rate / 2}%`, inr(Math.round((tax - half) * 100) / 100)]];
}

// Opens the tab inside the tap (phone browsers block tabs opened after a wait), then points it at the file.
async function openScan(lotId: string | null, dealId: string | null) {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try { await openScanInto(tab, lotId, dealId); } catch (e) { tab?.close(); throw e; }
}
async function openScanInto(tab: Window | null, lotId: string | null, dealId: string | null) {
  let qq = sb.from("documents").select("storage_path, lot_id").eq("doc_type", "TAX_INVOICE").neq("status", "rejected").order("uploaded_at", { ascending: false });
  qq = lotId ? qq.or(`lot_id.eq.${lotId},and(lot_id.is.null,deal_id.eq.${dealId})`) : qq.eq("deal_id", dealId!);
  const docs = await q(qq.limit(1));
  if (!docs.length || docs[0].storage_path.endsWith("/seed")) throw new Error("No invoice photo uploaded for this lot.");
  const r = await sb.storage.from(BUCKET).createSignedUrl(docs[0].storage_path, 120);
  if (r.error) throw new Error(r.error.message);
  if (tab) tab.location.href = r.data.signedUrl; else window.location.href = r.data.signedUrl;
}

function Voucher({ r, book, onDone }: { r: Row; book: string; onDone: () => void }) {
  const t = useT(); const can = useCan();
  const [ref, setRef] = useState<string>(r.voucher_ref ?? "");
  const s = useSave();
  const { data, error } = useLoad(async () => {
    if (r.entity === "invoice") return q<Row>(sb.from("invoices").select("*, invoice_lines(*, grades(name, items(name)))").eq("id", r.entity_id).maybeSingle());
    if (r.entity === "note") return q<Row>(sb.from("notes").select("*, note_lines(*), invoices(invoice_no, invoice_date, gst_rate, deal_id)").eq("id", r.entity_id).maybeSingle());
    if (r.entity === "payment") return q<Row>(sb.from("payments").select("*, invoices(invoice_no), tds(amount, section)").eq("id", r.entity_id).maybeSingle());
    if (r.entity === "tds") return q<Row>(sb.from("tds").select("*, invoices(invoice_no)").eq("id", r.entity_id).maybeSingle());
    return q<Row>(sb.from("production_runs").select("*, production_lines(*, items(name))").eq("id", r.entity_id).maybeSingle());
  }, [r.entity, r.entity_id]);
  const allowed = can(book === "factory" ? "tally_factory" : "tally_office");
  if (!data) return error ? <Err error={error} /> : r.state === "changed" && r.amount == null ? null : <Loading />;
  const d = data;
  return (
    <div className="voucher">
      {r.entity === "invoice" && (<>
        <KV rows={[[t("Party", "पार्टी"), r.supplier], ["GSTIN", r.gstin ?? "—"], [t("Supplier invoice", "सप्लायर बिल"), `${d.invoice_no} · ${day(d.invoice_date)}`], [t("Lot", "लॉट"), r.lot_no ?? "—"]]} />
        <div className="tablewrap"><table className="tbl compact"><thead><tr><th>{t("Stock item", "स्टॉक आइटम")}</th><th className="n">kg</th><th className="n">{t("Rate", "रेट")}</th><th className="n">{t("Amount", "रकम")}</th></tr></thead>
          <tbody>{d.invoice_lines.map((l: Row) => <tr key={l.id}><td>{l.grades?.items?.name} · {l.grades?.name}</td><td className="n">{Number(l.billed_net_kg).toFixed(3)}</td><td className="n">{Number(l.billed_rate).toFixed(2)}</td><td className="n">{inr(Number(l.billed_net_kg) * Number(l.billed_rate))}</td></tr>)}</tbody></table></div>
        <KV rows={[[t("Taxable", "कर योग्य"), inr(d.taxable_value)], ...taxRows(t, r.gstin, Number(d.gst_rate), Number(d.gst_amount)), [t("Total", "कुल"), <strong key="t">{inr(d.total)}</strong>]]} />
        <Btn small onClick={() => s.run(() => openScan(r.lot_id, d.deal_id))}>{t("View invoice photo", "बिल की फोटो देखें")}</Btn>
      </>)}
      {r.entity === "note" && (<>
        <KV rows={[[t("Party", "पार्टी"), r.supplier], ["GSTIN", r.gstin ?? "—"], [t("Against invoice", "किस बिल पर"), `${d.invoices?.invoice_no} · ${day(d.invoices?.invoice_date)}`], [t("Date", "तारीख"), day(d.note_date)], [t("Tally DN number", "टैली DN नंबर"), d.tally_no ?? t("not set yet", "अभी नहीं")]]} />
        <div className="tablewrap"><table className="tbl compact"><thead><tr><th>{t("Item", "विवरण")}</th><th className="n">kg</th><th className="n">{t("Rate", "रेट")}</th><th className="n">{t("Amount", "रकम")}</th><th className="n">{t("Stock out", "स्टॉक घटा")}</th></tr></thead>
          <tbody>{d.note_lines.map((l: Row) => <tr key={l.id}><td>{l.grade} · {l.description}</td><td className="n">{Number(l.qty_kg).toFixed(3)}</td><td className="n">{Number(l.rate).toFixed(2)}</td><td className="n">{inr(l.amount)}</td><td className="n">{Number(l.stock_kg) ? Number(l.stock_kg).toFixed(3) : "—"}</td></tr>)}</tbody></table></div>
        <KV rows={[[t("Taxable", "कर योग्य"), inr(d.taxable)], ...taxRows(t, r.gstin, Number(d.invoices?.gst_rate ?? 18), Number(d.gst_amount)), ...(Number(d.round_off) ? [[t("Round off", "राउंड ऑफ"), Number(d.round_off).toFixed(3)] as [string, string]] : []), [t("Total", "कुल"), <strong key="t">{inr(d.total)}</strong>]]} />
      </>)}
      {r.entity === "payment" && <KV rows={[[t("Party", "पार्टी"), r.supplier], [t("Paid on", "तारीख"), day(d.paid_on)], [t("Amount", "रकम"), inr(d.amount)], [t("Mode", "माध्यम"), String(d.mode).toUpperCase()], ["UTR", d.bank_ref ?? "—"], [t("Against bill", "बिल"), d.invoices?.invoice_no ?? t("Advance", "एडवांस")], ...(d.tds?.length ? [["TDS", d.tds.map((x: Row) => `${inr(x.amount)} ${x.section ?? ""}`).join(", ")] as [string, string]] : [])]} />}
      {r.entity === "tds" && <KV rows={[[t("Party", "पार्टी"), r.supplier], [t("Against bill", "बिल"), d.invoices?.invoice_no], [t("Section", "सेक्शन"), d.section ?? "—"], [t("Amount", "रकम"), inr(d.amount)], [t("Deducted on", "काटा"), day(d.deducted_on)]]} />}
      {r.entity === "production" && (<>
        <p>{day(d.run_date)}{d.notes ? ` · ${d.notes}` : ""}</p>
        <div className="tablewrap"><table className="tbl compact"><thead><tr><th>{t("Item", "आइटम")}</th><th>{t("Used / made", "खपत / बना")}</th><th className="n">kg</th></tr></thead>
          <tbody>{d.production_lines.map((l: Row) => <tr key={l.id}><td>{l.items?.name}</td><td>{l.direction === "consumed" ? t("Consumed", "खपत") : t("Produced", "उत्पादन")}</td><td className="n">{Number(l.kg).toFixed(3)}</td></tr>)}</tbody></table></div>
      </>)}
      <Err error={s.error} />
      {allowed && (r.state === "changed" ? (
        <div className="actions"><Btn kind="primary" disabled={s.busy} onClick={() => s.run(() => rpc("clear_tally_change", { p_mark: r.mark_id }), onDone)}>{t("Corrected in Tally", "टैली में सुधार किया")}</Btn></div>
      ) : (
        <div className="inline gap-top">
          <TextIn value={ref} onValue={setRef} placeholder={t("Voucher number in Tally", "टैली वाउचर नंबर")} aria-label={t("Voucher number in Tally", "टैली वाउचर नंबर")} />
          <Btn kind="primary" disabled={s.busy} onClick={() => s.run(() => rpc("mark_tally", { p_entity: r.entity, p_id: r.entity_id, p_book: book, p_ref: ref }), onDone)}>✓ {t("Entered", "दर्ज किया")}</Btn>
        </div>
      ))}
      {r.lot_id && <button type="button" className="link" onClick={() => go(`lot/${r.lot_id}`)}>{t("Open lot", "लॉट खोलें")} {r.lot_no}</button>}
    </div>
  );
}

function Register() {
  const t = useT();
  const [month, setMonth] = useState(today().slice(0, 7));
  const { data, error } = useLoad(() => {
    const [y, m] = month.split("-").map(Number); const end = new Date(y, m, 0).getDate();
    return q(sb.from("v_invoice_register").select("*").gte("invoice_date", `${month}-01`).lte("invoice_date", `${month}-${String(end).padStart(2, "0")}`).order("invoice_date"));
  }, [month]);
  const rows = data ?? [];
  const tick = (b: boolean, ref?: string | null) => b ? <span className="okline">✓{ref ? ` ${ref}` : ""}</span> : <span className="bad">✗</span>;
  return (
    <>
      <div className="page-head"><p className="muted small">{t("Every purchase invoice, with its photo and whether each Tally has it. Nothing is missed for TDS or GST if every row has ✓ ✓ ✓.", "हर खरीद बिल, उसकी फोटो और दोनों टैली में दर्ज है या नहीं। हर लाइन पर ✓ ✓ ✓ हो तो TDS/GST में कुछ नहीं छूटा।")}</p>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("Month", "महीना")} /></div>
      {error && <Err error={error} />}
      {!data ? <Loading /> : rows.length === 0 ? <Empty>{t("No invoices this month.", "इस महीने कोई बिल नहीं।")}</Empty> : (
        <>
          <div className="tablewrap"><table className="tbl compact">
            <thead><tr><th>{t("Date", "तारीख")}</th><th>{t("Supplier", "सप्लायर")}</th><th>{t("Invoice", "बिल")}</th><th className="n">{t("Total", "कुल")}</th><th className="c">{t("Photo", "फोटो")}</th><th className="c">{t("Factory", "फैक्ट्री")}</th><th className="c">{t("Office", "ऑफिस")}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.invoice_id} className="click" onClick={() => r.lot_id && go(`lot/${r.lot_id}`)}>
              <td>{day(r.invoice_date)}</td><td>{r.supplier}</td><td>{r.invoice_no}<br /><span className="muted small">{r.lot_no}</span></td>
              <td className="n">{inr(r.total)}</td><td className="c">{tick(r.has_scan)}</td><td className="c">{tick(r.in_factory, r.factory_ref)}</td><td className="c">{tick(r.in_office, r.office_ref)}</td></tr>)}</tbody>
          </table></div>
          <Btn small onClick={() => download(`invoice-register-${month}.csv`, csv(rows, [["invoice_date", "Date"], ["supplier", "Supplier"], ["gstin", "GSTIN"], ["invoice_no", "Invoice"], ["lot_no", "Lot"],
            ["taxable_value", "Taxable"], ["gst_amount", "GST"], ["total", "Total"], ["has_scan", "Photo"], ["in_factory", "Factory Tally"], ["factory_ref", "Factory voucher"], ["in_office", "Office Tally"], ["office_ref", "Office voucher"]]))}>{t("Download", "डाउनलोड")}</Btn>
        </>
      )}
    </>
  );
}
