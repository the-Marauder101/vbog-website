import { useState } from "react";
import { day, go, inr, isNum, kg, q, rpc, sb, today, useCan, useLang, useLoad, useT, nm, type Row } from "../lib";
import { Btn, Chip, Empty, Err, Field, Loading, NumIn, Select, Sheet, SaveBar, TextIn } from "../ui";
import { StageChip, useSave } from "../common";

const FILTERS: [string, string, string][] = [
  ["open", "Open", "चालू"], ["incoming", "On the way", "रास्ते में"], ["sorting", "Sorting", "छँटाई"],
  ["dn_pending", "DN to approve", "डेबिट नोट"], ["tally_pending", "Tally pending", "टैली बाकी"],
  ["payment_pending", "Payment pending", "पेमेंट बाकी"], ["settled", "Settled", "पूरे"], ["all", "All", "सब"],
];

export default function Lots({ openNew }: { openNew?: boolean }) {
  const t = useT(); const can = useCan();
  const [f, setF] = useState("open");
  const [text, setText] = useState("");
  const [newDeal, setNewDeal] = useState(!!openNew);
  const { data, error, reload } = useLoad(() => Promise.all([
    q(sb.from("v_lots").select("*").order("received_on", { ascending: false })),
    q(sb.from("v_deals_incoming").select("*").order("expected_date", { ascending: true, nullsFirst: false })),
  ]), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [lots, incoming] = data;
  const match = (r: Row) => !text || [r.lot_no, r.deal_no, r.po_no, r.supplier, r.invoice_no].some((x) => String(x ?? "").toLowerCase().includes(text.toLowerCase()));
  const showIncoming = ["open", "incoming", "all"].includes(f);
  const lotRows = f === "incoming" ? [] : lots.filter((l) =>
    f === "all" ? true : f === "open" ? l.stage !== "settled" : f === "sorting" ? ["received", "sorting"].includes(l.stage) : l.stage === f).filter(match);
  const inRows = showIncoming ? incoming.filter(match) : [];
  return (
    <>
      <div className="page-head">
        <h1>{t("Lots", "लॉट")}</h1>
        {can("deal_edit") && <Btn kind="primary" onClick={() => setNewDeal(true)}>+ {t("New deal", "नया सौदा")}</Btn>}
      </div>
      <div className="filters" role="tablist">
        {FILTERS.map(([id, en, hi]) => <button key={id} type="button" className={f === id ? "on" : ""} onClick={() => setF(id)}>{t(en, hi)}</button>)}
      </div>
      <input className="search" type="search" placeholder={t("Search supplier, lot, PO, invoice", "सप्लायर, लॉट, PO, बिल खोजें")} value={text} onChange={(e) => setText(e.target.value)} />
      {inRows.length > 0 && (
        <>
          <h3 className="sub">{t("On the way", "रास्ते में")}</h3>
          <ul className="rows">
            {inRows.map((d) => (
              <li key={d.deal_id} className="edge-info">
                <button type="button" className="row" onClick={() => go(`deal/${d.deal_id}`)}>
                  <span className="row-main">
                    <strong>{d.deal_no}{d.po_no ? ` · ${d.po_no}` : ""}</strong>
                    <span>{d.supplier}</span>
                    <span className="muted small">{t("Still to come", "आना बाकी")}: {kg(d.remaining_kg)} · {t("expected", "अपेक्षित")} {day(d.expected_date)}</span>
                  </span>
                  <Chip tone="info">{d.lots ? t("Part received", "कुछ आया") : t("On the way", "रास्ते में")}</Chip>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {lotRows.length > 0 && (
        <>
          {inRows.length > 0 && <h3 className="sub">{t("Received lots", "आए हुए लॉट")}</h3>}
          <ul className="rows">
            {lotRows.map((l) => (
              <li key={l.lot_id}>
                <button type="button" className="row" onClick={() => go(`lot/${l.lot_id}`)}>
                  <span className="row-main">
                    <strong>{l.lot_no} · {l.deal_no}</strong>
                    <span>{l.supplier}</span>
                    <span className="muted small">{day(l.received_on)} · {l.days_open} {t("days", "दिन")}{l.doc_gaps ? ` · ${l.doc_gaps} ${t("docs pending", "दस्तावेज़ बाकी")}` : ""}</span>
                  </span>
                  <StageChip stage={l.stage} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!inRows.length && !lotRows.length && <Empty>{t("Nothing here.", "यहाँ कुछ नहीं है।")}</Empty>}
      {newDeal && <NewDealSheet onClose={() => setNewDeal(false)} onSaved={(id) => { reload(); go(`deal/${id}`); }} />}
    </>
  );
}

type Line = { grade: string; qty: string; rate: string };
export function NewDealSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT(); const lang = useLang();
  const m = useLoad(() => Promise.all([
    q(sb.from("suppliers").select("id,name,provisional_pct,provisional_days,balance_days").eq("active", true).order("name")),
    q(sb.from("grades").select("*").eq("active", true).order("sort")),
  ]), []);
  const [sup, setSup] = useState("");
  const [newSup, setNewSup] = useState({ name: "", gstin: "", state: "" });
  const [po, setPo] = useState("");
  const [dealDate, setDealDate] = useState(today());
  const [expected, setExpected] = useState("");
  const [gst, setGst] = useState("18");
  const [lines, setLines] = useState<Line[]>([{ grade: "", qty: "", rate: "" }]);
  const [terms, setTerms] = useState({ pct: "", pdays: "", bdays: "" });
  const [showTerms, setShowTerms] = useState(false);
  const s = useSave();
  if (!m.data) return null;
  const [sups, grades] = m.data;
  const supRow = sups.find((x) => x.id === sup);
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = () => s.run(async () => {
    const good = lines.filter((l) => l.grade || l.qty || l.rate);
    if (!good.length) throw new Error(t("Add at least one grade.", "कम से कम एक ग्रेड डालें।"));
    for (const l of good) if (!l.grade || !isNum(l.qty) || !isNum(l.rate)) throw new Error(t("Each grade needs quantity and rate.", "हर ग्रेड की मात्रा और रेट डालें।"));
    if (sup === "new" && !newSup.name.trim()) throw new Error(t("Enter the supplier's name.", "सप्लायर का नाम डालें।"));
    if (!sup) throw new Error(t("Choose the supplier.", "सप्लायर चुनें।"));
    const id = await rpc<string>("create_deal", { p: {
      supplier_id: sup === "new" ? null : sup, supplier_name: newSup.name, supplier_gstin: newSup.gstin, supplier_state: newSup.state,
      po_no: po, deal_date: dealDate, expected_date: expected || null, gst_rate: gst,
      provisional_pct: terms.pct, provisional_days: terms.pdays, balance_days: terms.bdays,
      lines: good.map((l) => ({ grade: l.grade, qty_kg: Number(l.qty), rate_per_kg: Number(l.rate) })) } });
    onClose(); onSaved(id);
  });
  return (
    <Sheet title={t("New deal", "नया सौदा")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save deal", "सौदा सेव करें")} />}>
      <Field label={t("Supplier", "सप्लायर")}>
        <Select value={sup} onChange={setSup} placeholder={t("Choose…", "चुनें…")}
                options={[...sups.map((x) => ({ value: x.id, label: x.name })), { value: "new", label: `+ ${t("New supplier", "नया सप्लायर")}` }]} />
      </Field>
      {sup === "new" && (
        <div className="grid2">
          <Field label={t("Supplier name", "सप्लायर का नाम")} wide><TextIn value={newSup.name} onValue={(v) => setNewSup({ ...newSup, name: v })} /></Field>
          <Field label="GSTIN"><TextIn value={newSup.gstin} onValue={(v) => setNewSup({ ...newSup, gstin: v })} /></Field>
          <Field label={t("State", "राज्य")}><TextIn value={newSup.state} onValue={(v) => setNewSup({ ...newSup, state: v })} /></Field>
        </div>
      )}
      <h3 className="sub">{t("What was agreed", "क्या तय हुआ")}</h3>
      {lines.map((l, i) => (
        <div className="line" key={i}>
          <Field label={t("Grade", "ग्रेड")}><Select value={l.grade} onChange={(v) => setLine(i, "grade", v)} placeholder="—" options={grades.map((g) => ({ value: g.code, label: nm(lang, g) }))} /></Field>
          <Field label={t("Quantity", "मात्रा")}><NumIn value={l.qty} onChange={(v) => setLine(i, "qty", v)} suffix="kg" /></Field>
          <Field label={t("Rate", "रेट")}><NumIn value={l.rate} onChange={(v) => setLine(i, "rate", v)} suffix="₹/kg" /></Field>
          {lines.length > 1 && <button type="button" className="x" aria-label={t("Remove", "हटाएँ")} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <Btn small onClick={() => setLines([...lines, { grade: "", qty: "", rate: "" }])}>+ {t("Another grade", "और ग्रेड")}</Btn>
      <div className="grid2 gap-top">
        <Field label={t("PO number", "PO नंबर")}><TextIn value={po} onValue={setPo} /></Field>
        <Field label={t("Deal date", "सौदे की तारीख")}><input type="date" value={dealDate} onChange={(e) => setDealDate(e.target.value)} /></Field>
        <Field label={t("Expected arrival", "माल कब आएगा")}><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        <Field label="GST"><NumIn value={gst} onChange={setGst} suffix="%" /></Field>
      </div>
      <button type="button" className="link" onClick={() => setShowTerms(!showTerms)}>{showTerms ? "−" : "+"} {t("Payment terms for this deal", "इस सौदे की पेमेंट शर्तें")}</button>
      {showTerms && (
        <>
          <p className="muted small">{supRow?.provisional_pct != null
            ? `${t("Supplier default", "सप्लायर की शर्त")}: ${supRow.provisional_pct}% ${t("after", "बाद")} ${supRow.provisional_days ?? 0} ${t("days, balance after", "दिन, बाकी")} ${supRow.balance_days ?? "—"} ${t("days", "दिन")}`
            : t("Leave empty to use the supplier's terms.", "खाली छोड़ें तो सप्लायर की शर्तें लगेंगी।")}</p>
          <div className="grid3">
            <Field label={t("Provisional", "प्रोविजनल")}><NumIn value={terms.pct} onChange={(v) => setTerms({ ...terms, pct: v })} suffix="%" /></Field>
            <Field label={t("Paid after", "कितने दिन बाद")}><NumIn value={terms.pdays} onChange={(v) => setTerms({ ...terms, pdays: v })} suffix={t("days", "दिन")} /></Field>
            <Field label={t("Balance after", "बाकी कितने दिन बाद")}><NumIn value={terms.bdays} onChange={(v) => setTerms({ ...terms, bdays: v })} suffix={t("days", "दिन")} /></Field>
          </div>
        </>
      )}
    </Sheet>
  );
}

export function TermsLine({ pct, pdays, bdays }: { pct: unknown; pdays: unknown; bdays: unknown }) {
  const f = (v: unknown) => (v == null ? "—" : String(v));
  const t = useT();
  if (pct == null && pdays == null && bdays == null) return <Chip tone="bad">{t("Payment terms not set", "पेमेंट शर्तें नहीं डाली")}</Chip>;
  return <span>{f(pct)}% {t("after", "बाद")} {f(pdays)} {t("days", "दिन")} · {t("balance after", "बाकी")} {f(bdays)} {t("days", "दिन")}</span>;
}
export const inrOrDash = (v: unknown) => (v == null ? "—" : inr(v));
