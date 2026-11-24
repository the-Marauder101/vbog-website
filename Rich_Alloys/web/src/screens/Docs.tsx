// Himanshu's documents desk: vendor compliance, every invoice's file pack, every debit note. One tap downloads a
// complete .zip (files, PO, debit notes as PDFs, index) for an invoice or a supplier.
import { useState } from "react";
import { day, go, inr, q, sb, today, useCan, useLoad, useT, type Row } from "../lib";
import { Btn, Chip, Empty, Err, Loading, Tabs } from "../ui";
import { DN_LABEL, StageChip } from "../common";

type Busy = { key: string; done: number; total: number } | null;

export default function Docs({ tab }: { tab?: string }) {
  const t = useT();
  const cur = tab ?? "compliance";
  const setTab = (x: string) => { history.replaceState(null, "", `#/docs/${x}`); window.dispatchEvent(new HashChangeEvent("hashchange")); };
  return (
    <>
      <h1>{t("Documents", "दस्तावेज़")}</h1>
      <Tabs value={cur} onChange={setTab} tabs={[{ id: "compliance", label: t("Vendor compliance", "वेंडर अनुपालन") },
        { id: "invoices", label: t("Invoices", "बिल") }, { id: "notes", label: t("Debit notes", "डेबिट नोट") }]} />
      {cur === "compliance" && <Compliance />}
      {cur === "invoices" && <Invoices />}
      {cur === "notes" && <Notes />}
    </>
  );
}

function useBusy() {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const run = async (key: string, fn: (p: (d: number, n: number) => void) => Promise<{ files: number; missing: number }>) => {
    setError(""); setBusy({ key, done: 0, total: 0 });
    try { const r = await fn((done, total) => setBusy({ key, done, total })); if (r.missing) setError(`${r.missing} file(s) could not be fetched; they are listed in index.csv.`); }
    catch (e) { setError((e as Error).message); }
    setBusy(null);
  };
  return { busy, error, run };
}
function DlButton({ k, b, label, onClick }: { k: string; b: Busy; label: string; onClick: () => void }) {
  const t = useT();
  return <Btn small kind="primary" disabled={!!b} onClick={onClick}>{b?.key === k ? (b.total ? `${b.done}/${b.total}` : t("Preparing…", "तैयार हो रहा है…")) : label}</Btn>;
}

const STATUS: Record<string, [string, string, "ok" | "wait" | "info"]> = {
  onboarded: ["Onboarded", "ऑनबोर्ड", "ok"], overridden: ["Overridden", "छूट दी", "info"], pending: ["Not onboarded", "ऑनबोर्ड नहीं", "wait"] };
export const complianceOf = (s: Row) => (s.supplier_type !== "domestic" ? null : s.onboarded_at ? "onboarded" : s.compliance_override_at ? "overridden" : "pending");

function Compliance() {
  const t = useT(); const can = useCan();
  const [f, setF] = useState("all");
  const dl = useBusy();
  const { data, error } = useLoad(() => Promise.all([
    q(sb.from("suppliers").select("id, name, gstin, supplier_type, onboarded_at, compliance_override_at, compliance_override_reason, active").order("name")),
    q(sb.from("onboarding_steps").select("code, required").eq("active", true)),
    q(sb.from("supplier_onboarding").select("supplier_id, step")),
    q(sb.from("v_doc_index").select("supplier_id, deal_id")),
  ]), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [sups, steps, done, docs] = data;
  const rows: Row[] = sups.filter((s) => s.active).map((s): Row => ({ ...s, state: complianceOf(s),
    stepsDone: done.filter((d) => d.supplier_id === s.id).length, files: docs.filter((d) => d.supplier_id === s.id && !d.deal_id).length,
    allFiles: docs.filter((d) => d.supplier_id === s.id).length }))
    .filter((s) => f === "all" || s.state === f)
    .sort((a, b) => (a.state === "pending" ? 0 : 1) - (b.state === "pending" ? 0 : 1));
  const pack = (s: Row) => dl.run(`s${s.id}`, async (p) => { const { packageSupplier } = await import("../pack"); return packageSupplier(s, p); });
  return (
    <>
      <div className="filters" role="tablist">
        {[["all", "All", "सब"], ["pending", "Not onboarded", "ऑनबोर्ड नहीं"], ["overridden", "Overridden", "छूट दी"], ["onboarded", "Onboarded", "ऑनबोर्ड"]].map(([id, en, hi]) =>
          <button key={id} type="button" className={f === id ? "on" : ""} onClick={() => setF(id)}>{t(en, hi)}</button>)}
      </div>
      <p className="muted small">{steps.length
        ? `${t("Onboarding steps", "ऑनबोर्डिंग कदम")}: ${steps.length}. ${t("Booking a deal needs the supplier onboarded, or Himanshu's override.", "सौदा बुक करने के लिए सप्लायर ऑनबोर्ड हो, या हिमांशु की छूट।")}`
        : t("The onboarding steps are not set yet. Booking a deal still needs the supplier marked onboarded, or Himanshu's override.", "ऑनबोर्डिंग के कदम अभी तय नहीं। फिर भी सौदा बुक करने के लिए सप्लायर ऑनबोर्ड हो, या हिमांशु की छूट।")}
        {can("admin") && <> <a href="#/admin/onboarding">{t("Edit steps", "कदम बदलें")}</a></>}</p>
      <Err error={dl.error} />
      {rows.length === 0 ? <Empty>{t("Nothing here.", "यहाँ कुछ नहीं है।")}</Empty> : (
        <ul className="rows">{rows.map((s) => {
          const st = s.state ? STATUS[s.state] : null;
          return (
            <li key={s.id} className={s.state === "pending" ? "edge-wait" : ""}><div className="row static">
              <button type="button" className="row-main linkish" onClick={() => go(`supplier/${s.id}`)}>
                <strong>{s.name}</strong>
                <span className="muted small">{[s.gstin, steps.length ? `${t("steps", "कदम")} ${s.stepsDone}/${steps.length}` : null,
                  `${s.files} ${t("compliance", "अनुपालन")} · ${s.allFiles} ${t("files in all", "कुल फ़ाइलें")}`].filter(Boolean).join(" · ")}</span>
                {st && <span><Chip tone={st[2]}>{t(st[0], st[1])}</Chip></span>}
              </button>
              <DlButton k={`s${s.id}`} b={dl.busy} label={t("Download all", "सब डाउनलोड")} onClick={() => pack(s)} />
            </div></li>);
        })}</ul>)}
    </>
  );
}

function Invoices() {
  const t = useT();
  const [text, setText] = useState("");
  const dl = useBusy();
  const { data, error } = useLoad(() => Promise.all([
    q(sb.from("v_lots").select("lot_id, lot_no, deal_id, deal_ids, deal_nos, supplier, invoice_no, invoice_date, received_on, stage, supplier_type").order("received_on", { ascending: false })),
    q(sb.from("v_doc_index").select("lot_id, deal_id, doc_type")),
    q(sb.from("notes").select("lot_id").neq("status", "cancelled")),
  ]), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [lots, docs, notes] = data;
  const m = (r: Row) => !text || [r.lot_no, r.deal_nos, r.supplier, r.invoice_no].some((x) => String(x ?? "").toLowerCase().includes(text.toLowerCase()));
  const pack = (l: Row) => dl.run(`l${l.lot_id}`, async (p) => { const { packageLot } = await import("../pack"); return packageLot(l, p); });
  return (
    <>
      <input className="search" type="search" placeholder={t("Search supplier, lot, deal, invoice", "सप्लायर, लॉट, सौदा, बिल खोजें")} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="muted small">{t("Download gives one .zip: the supplier's documents, our weighbridge, sorting and QA/QC reports, the PO and the debit notes as PDFs.", "डाउनलोड से एक .zip: सप्लायर के दस्तावेज़, हमारा धर्मकांटा, छँटाई और QA/QC रिपोर्ट, PO और डेबिट नोट PDF में।")}</p>
      <Err error={dl.error} />
      {lots.filter(m).length === 0 ? <Empty>{t("Nothing here.", "यहाँ कुछ नहीं है।")}</Empty> : (
        <ul className="rows">{lots.filter(m).map((l) => {
          const ids: string[] = l.deal_ids ?? [l.deal_id];
          const files = docs.filter((d) => d.lot_id === l.lot_id || (!d.lot_id && ids.includes(d.deal_id))).length;
          const qc = docs.some((d) => d.lot_id === l.lot_id && (d.doc_type === "QC_REPORT" || d.doc_type === "SORTING_REPORT"));
          const dns = notes.filter((n) => n.lot_id === l.lot_id).length;
          return (
            <li key={l.lot_id}><div className="row static">
              <button type="button" className="row-main linkish" onClick={() => go(`lot/${l.lot_id}/docs`)}>
                <strong>{l.lot_no} · {l.invoice_no ?? "—"}</strong>
                <span>{l.supplier}</span>
                <span className="muted small">{day(l.invoice_date ?? l.received_on)} · {l.deal_nos ?? ""} · {files} {t("files", "फ़ाइलें")} · {dns} DN{qc ? ` · ${t("QA/QC ✓", "QA/QC ✓")}` : ""}</span>
                <span><StageChip stage={l.stage} /></span>
              </button>
              <DlButton k={`l${l.lot_id}`} b={dl.busy} label={t("Download", "डाउनलोड")} onClick={() => pack(l)} />
            </div></li>);
        })}</ul>)}
    </>
  );
}

function Notes() {
  const t = useT();
  const [month, setMonth] = useState(today().slice(0, 7));
  const dl = useBusy();
  const { data, error } = useLoad(() => Promise.all([
    q(sb.from("notes").select("id, lot_id, dn_type, note_date, total, tally_no, status, lots(lot_no, deals(suppliers(name)))").order("note_date", { ascending: false })),
    q(sb.from("v_dn_calc").select("lot_id, dn_type, total_exact").eq("approved", false)),
    q(sb.from("v_lots").select("lot_id, lot_no, supplier, stage, price_open")),
    q(sb.from("v_doc_index").select("lot_id").eq("doc_type", "SUPPLIER_CN")),
  ]), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [notes, todo, lots, cns] = data;
  const raised = notes.filter((n) => n.status !== "cancelled" && String(n.note_date).startsWith(month));
  const lot = (id: string) => lots.find((l) => l.lot_id === id) ?? {};
  const one = (n: Row) => dl.run(`n${n.id}`, async (p) => { const { packageNotes } = await import("../pack"); return packageNotes([n], `Debit note ${n.lots?.lot_no ?? ""} ${n.dn_type}`, p); });
  return (
    <>
      <h3 className="sub">{t("To raise", "बनाने हैं")} <span className="count">{todo.length}</span></h3>
      {todo.length === 0 ? <Empty>{t("Nothing waiting.", "कुछ बाकी नहीं।")}</Empty> : (
        <ul className="rows">{todo.map((c, i) => (
          <li key={i} className="edge-wait"><button type="button" className="row" onClick={() => go(`lot/${c.lot_id}/dn`)}>
            <span className="row-main"><strong>{lot(c.lot_id).lot_no} · {t(...(DN_LABEL[c.dn_type] ?? [c.dn_type, c.dn_type]))}</strong>
              <span className="muted small">{lot(c.lot_id).supplier}{lot(c.lot_id).price_open ? ` · ${t("price still open", "रेट अभी खुला")}` : ""}</span></span>
            <span className="amt">{inr(c.total_exact)}</span></button></li>))}
        </ul>)}
      <div className="page-head gap-top"><h3 className="sub">{t("Raised", "बने हुए")} <span className="count">{raised.length}</span></h3>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("Month", "महीना")} /></div>
      <Err error={dl.error} />
      {raised.length > 0 && <div className="actions"><DlButton k="all" b={dl.busy} label={t("Download all for the month (.zip)", "महीने के सभी (.zip)")}
        onClick={() => dl.run("all", async (p) => { const { packageNotes } = await import("../pack"); return packageNotes(raised, `Debit notes ${month}`, p); })} /></div>}
      {raised.length === 0 ? <Empty>{t("None this month.", "इस महीने कोई नहीं।")}</Empty> : (
        <ul className="rows">{raised.map((n) => (
          <li key={n.id}><div className="row static">
            <button type="button" className="row-main linkish" onClick={() => go(`lot/${n.lot_id}/dn`)}>
              <strong>{n.lots?.lot_no} · {t(...(DN_LABEL[n.dn_type] ?? [n.dn_type, n.dn_type]))}</strong>
              <span className="muted small">{n.lots?.deals?.suppliers?.name} · {day(n.note_date)} · {n.tally_no ? `Tally ${n.tally_no}` : t("Tally no. not entered", "टैली नंबर नहीं")}
                {" · "}{cns.some((c) => c.lot_id === n.lot_id) ? t("credit note received ✓", "क्रेडिट नोट मिला ✓") : t("credit note awaited", "क्रेडिट नोट बाकी")}</span>
            </button>
            <span className="amt">{inr(n.total)}</span>
            <DlButton k={`n${n.id}`} b={dl.busy} label="PDF" onClick={() => one(n)} />
          </div></li>))}
        </ul>)}
      <p className="muted small">{t("Debit notes are PDFs in a basic layout until Rich Alloys' own DN and CN formats are added. Upload the supplier's credit note on the lot (Documents > Supplier credit note).", "डेबिट नोट अभी सामान्य PDF में हैं, जब तक Rich Alloys का अपना DN/CN फ़ॉर्मेट नहीं जुड़ता। सप्लायर का क्रेडिट नोट लॉट पर अपलोड करें (दस्तावेज़ > सप्लायर क्रेडिट नोट)।")}</p>
    </>
  );
}
