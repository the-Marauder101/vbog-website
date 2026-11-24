import { useState } from "react";
import { csv, download, gstinOk, normGstin, day, go, inr, isNum, kg, q, rpc, sb, today, useCan, useLang, useLoad, useMe, useT, nm, type Row } from "../lib";
import { Btn, Chip, DateIn, Empty, Err, Field, Loading, NumIn, Select, Sheet, SaveBar, TextIn } from "../ui";
import { StageChip, useSave } from "../common";
import { enqueue, refusal } from "../uploads";

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
  const [receipt, setReceipt] = useState(false);
  const [truck, setTruck] = useState(false);
  const [unbooked, setUnbooked] = useState(false);
  const [view, setView] = useState<"list" | "table">(() => { try { return localStorage.getItem("lotsView") === "table" ? "table" : "list"; } catch { return "list"; } });
  const pickView = (v: "list" | "table") => { setView(v); try { localStorage.setItem("lotsView", v); } catch { /* private mode */ } };
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
        <span className="actions tight">
          {can("inward_edit") && <Btn onClick={() => setTruck(true)}>+ {t("Truck arrived", "ट्रक आया")}</Btn>}
          {can("deal_edit") && <Btn kind="primary" onClick={() => setNewDeal(true)}>+ {t("New deal", "नया सौदा")}</Btn>}
        </span>
      </div>
      <div className="filters" role="tablist">
        {FILTERS.map(([id, en, hi]) => <button key={id} type="button" className={f === id ? "on" : ""} onClick={() => setF(id)}>{t(en, hi)}</button>)}
      </div>
      <div className="search-row">
        <input className="search" type="search" placeholder={t("Search supplier, lot, PO, invoice", "सप्लायर, लॉट, PO, बिल खोजें")} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="seg" role="group" aria-label={t("View", "देखें")}>
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => pickView("list")}>{t("List", "सूची")}</button>
          <button type="button" className={view === "table" ? "on" : ""} onClick={() => pickView("table")}>{t("Table", "टेबल")}</button>
        </span>
      </div>
      {view === "table" ? <LotRegister ids={new Set(lotRows.map((l) => l.lot_id))} /> : <>
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
                    <span className="muted small">{t("Still to come", "आना बाकी")}: {kg(d.remaining_kg)} · {t("expected", "अपेक्षित")} {day(d.expected_date)}{d.price_open ? ` · ${t("price open", "रेट खुला")}` : ""}</span>
                  </span>
                  {Number(d.days_late) > 0
                    ? <Chip tone="bad">{t("Late", "देरी")} {d.days_late} {t("days", "दिन")}</Chip>
                    : <Chip tone="info">{d.lots ? t("Part received", "कुछ आया") : t("On the way", "रास्ते में")}</Chip>}
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
                    <strong>{l.invoice_no ?? l.lot_no}</strong>
                    <span className="muted small">{t("Internal", "आंतरिक")} {l.lot_no} · {l.deal_nos ?? l.deal_no}</span>
                    <span>{l.supplier}{l.supplier_type && l.supplier_type !== "domestic" ? <span className="muted small"> · {t(...TYPE_WORD[l.supplier_type])}</span> : null}</span>
                    <span className="muted small">{day(l.received_on)} · {l.days_open} {t("days", "दिन")}{l.doc_gaps ? ` · ${l.doc_gaps} ${t("docs pending", "दस्तावेज़ बाकी")}` : ""}</span>
                    {l.unbooked && !l.rate_confirmed_at && <span><Chip tone="wait">{t("Not booked: rate to confirm", "बिना बुकिंग: रेट पक्का करना है")}</Chip></span>}
                    {l.price_open && <span><Chip tone={l.price_fix_by && l.price_fix_by <= today() ? "bad" : "info"}>{t("Price open", "रेट खुला")}{l.price_fix_by ? ` · ${t("fix by", "तय करें")} ${day(l.price_fix_by)}` : ""}</Chip></span>}
                  </span>
                  <StageChip stage={l.stage} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!inRows.length && !lotRows.length && <Empty>{t("Nothing here.", "यहाँ कुछ नहीं है।")}</Empty>}
      </>}
      {truck && <TruckSheet incoming={incoming} onClose={() => setTruck(false)}
        onPick={(k, dealId) => { setTruck(false); if (k === "booked" && dealId) go(`deal/${dealId}/arrive`); if (k === "unbooked") setUnbooked(true); if (k === "other") setReceipt(true); }} />}
      {unbooked && <UnbookedSheet onClose={() => setUnbooked(false)} onSaved={(id) => { reload(); go(`lot/${id}`); }} />}
      {receipt && <ReceiptSheet onClose={() => setReceipt(false)} onSaved={(id) => { reload(); go(`lot/${id}`); }} />}
      {newDeal && <NewDealSheet onClose={() => setNewDeal(false)} onSaved={(id) => { reload(); go(`deal/${id}`); }} />}
    </>
  );
}

// Every lot in one table: supplier, weights, rates, each debit note, GST, TDS, paid and pending.
const REG_COLS: { k: string; en: string; hi: string; kind?: "kg" | "inr" | "text" | "date" | "num"; money?: boolean }[] = [
  { k: "invoice_no", en: "Invoice", hi: "बिल" }, { k: "lot_no", en: "Internal no.", hi: "आंतरिक नं." }, { k: "deal_no", en: "Deal", hi: "सौदा" },
  { k: "received_on", en: "Received", hi: "आया", kind: "date" },
  { k: "supplier", en: "Supplier", hi: "सप्लायर" }, { k: "grades", en: "Grades", hi: "ग्रेड" },
  { k: "billed_kg", en: "Invoice kg", hi: "बिल वज़न", kind: "kg" }, { k: "factory_kg", en: "Our net kg", hi: "हमारा नेट", kind: "kg" },
  { k: "weight_short_kg", en: "Short kg", hi: "कम वज़न", kind: "kg" },
  { k: "bags", en: "Bags", hi: "बोरी", kind: "num" }, { k: "bag_kg", en: "Bag weight", hi: "बोरी वज़न", kind: "kg" },
  { k: "invoice_rates", en: "Invoice rate (excl. GST)", hi: "बिल रेट (GST अलग)", money: true }, { k: "our_rates", en: "Our rate (excl. GST)", hi: "हमारा रेट (GST अलग)", money: true },
  { k: "taxable", en: "Taxable", hi: "कर योग्य", kind: "inr", money: true }, { k: "gst", en: "GST", hi: "GST", kind: "inr", money: true },
  { k: "invoice_total", en: "Invoice total", hi: "बिल कुल", kind: "inr", money: true },
  { k: "dn_weight_short", en: "DN weight short", hi: "DN वज़न कम", kind: "inr", money: true },
  { k: "dn_quality", en: "DN quality (sorting)", hi: "DN छँटाई", kind: "inr", money: true },
  { k: "dn_return", en: "DN return", hi: "DN वापसी", kind: "inr", money: true },
  { k: "dn_price", en: "DN price", hi: "DN रेट", kind: "inr", money: true },
  { k: "dn_total", en: "DN total", hi: "DN कुल", kind: "inr", money: true },
  { k: "dn_to_approve", en: "DN to approve", hi: "DN बाकी", kind: "inr", money: true },
  { k: "tds_it", en: "TDS (income tax)", hi: "TDS (आयकर)", kind: "inr", money: true },
  { k: "tds_gst", en: "TDS (GST)", hi: "TDS (GST)", kind: "inr", money: true },
  { k: "paid", en: "Paid", hi: "दिया", kind: "inr", money: true },
  { k: "paid_unreconciled", en: "Paid, not reconciled", hi: "दिया, मिलान बाकी", kind: "inr", money: true },
  { k: "balance", en: "Pending", hi: "देना बाकी", kind: "inr", money: true },
];
function LotRegister({ ids }: { ids: Set<string> }) {
  const t = useT(); const can = useCan();
  const { data, error } = useLoad(() => q(sb.from("v_lot_register").select("*").order("received_on", { ascending: false })), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const rows = data.filter((r) => ids.has(r.lot_id));
  const cols = REG_COLS.filter((c) => !c.money || can("money_view"));
  const fmt = (c: typeof REG_COLS[number], v: unknown) => v == null ? "—" : c.kind === "kg" ? kg(v) : c.kind === "inr" ? inr(v) : c.kind === "date" ? day(v) : c.kind === "num" ? Number(v).toLocaleString("en-IN") : String(v);
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return (
    <>
      <div className="actions"><Btn small onClick={() => download(`lots_${today()}.csv`, csv(rows, cols.map((c): [string, string] => [c.k, c.en])))}>{t("Download (CSV)", "डाउनलोड (CSV)")}</Btn>
        <span className="muted small">{rows.length} {t("lots", "लॉट")}</span></div>
      {rows.length === 0 ? <Empty>{t("Nothing here.", "यहाँ कुछ नहीं है।")}</Empty> : (
        <div className="tablewrap register">
          <table className="tbl">
            <thead><tr>{cols.map((c) => <th key={c.k} className={c.kind === "kg" || c.kind === "inr" ? "n" : ""}>{t(c.en, c.hi)}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.lot_id} className="click" onClick={() => go(`lot/${r.lot_id}`)}>
              {cols.map((c) => <td key={c.k} className={c.kind === "kg" || c.kind === "inr" ? "n" : ""}>{c.k === "invoice_no" ? <strong>{r.invoice_no ?? "—"}</strong> : fmt(c, r[c.k])}</td>)}</tr>)}</tbody>
            <tfoot><tr>{cols.map((c, i) => <td key={c.k} className={c.kind === "kg" || c.kind === "inr" ? "n" : ""}>{i === 0 ? <strong>{t("Total", "कुल")}</strong> : c.kind === "kg" || c.kind === "inr" || c.kind === "num" ? <strong>{fmt(c, sum(c.k))}</strong> : ""}</td>)}</tr></tfoot>
          </table>
        </div>)}
    </>
  );
}

type Line = { grade: string; qty: string; rate: string };
export function NewDealSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT(); const lang = useLang();
  const m = useLoad(() => Promise.all([
    q(sb.from("suppliers").select("id,name,provisional_pct,provisional_days,balance_days,onboarded_at,compliance_override_at").eq("active", true).eq("supplier_type", "domestic").order("name")),
    q(sb.from("grades").select("*").eq("active", true).order("sort")),
  ]), []);
  const [sup, setSup] = useState("");
  const [newSup, setNewSup] = useState({ name: "", gstin: "", state: "" });
  const [dealDate, setDealDate] = useState(today());
  const [expected, setExpected] = useState("");
  const [gst, setGst] = useState("18");
  const [lines, setLines] = useState<Line[]>([{ grade: "", qty: "", rate: "" }]);
  const [terms, setTerms] = useState({ pct: "", pdays: "", bdays: "" });
  const [showTerms, setShowTerms] = useState(false);
  const [pricing, setPricing] = useState<"fixed" | "open">("fixed");
  const [basis, setBasis] = useState("");
  const [fixDays, setFixDays] = useState("7");
  const [blocked, setBlocked] = useState<string | null>(null);   // supplier not onboarded: Himanshu may override here
  const [ov, setOv] = useState({ reason: "", pw: "" });
  const can = useCan();
  const s = useSave();
  if (!m.data) return null;
  const [sups, grades] = m.data;
  const supRow = sups.find((x) => x.id === sup);
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = () => s.run(async () => {
    const good = lines.filter((l) => l.grade || l.qty || l.rate);
    if (!good.length) throw new Error(t("Add at least one grade.", "कम से कम एक ग्रेड डालें।"));
    for (const l of good) if (!l.grade || !isNum(l.qty) || (pricing === "fixed" && !isNum(l.rate)) || (l.rate && !isNum(l.rate)))
      throw new Error(pricing === "fixed" ? t("Each grade needs quantity and rate.", "हर ग्रेड की मात्रा और रेट डालें।") : t("Each grade needs a quantity.", "हर ग्रेड की मात्रा डालें।"));
    if (sup === "new" && !newSup.name.trim()) throw new Error(t("Enter the supplier's name.", "सप्लायर का नाम डालें।"));
    if (!sup) throw new Error(t("Choose the supplier.", "सप्लायर चुनें।"));
    if (sup === "new" && newSup.gstin.trim() && !gstinOk(newSup.gstin))
      throw new Error(t("The GSTIN does not look right (15 characters, e.g. 27AAMCR8303C1ZF). Check it on the supplier's invoice.", "GSTIN सही नहीं लग रहा (15 अक्षर, जैसे 27AAMCR8303C1ZF)। सप्लायर के बिल पर जाँचें।"));
    // a new supplier is saved first, so an override (if needed) has a supplier to point at
    let supId = sup;
    if (sup === "new") {
      const row = await q<Row>(sb.from("suppliers").insert({ name: newSup.name.trim(), gstin: normGstin(newSup.gstin) || null, state: newSup.state.trim() || null }).select("id").single());
      supId = row.id; setSup(row.id); m.reload();
    }
    if (blocked && ov.reason) {
      const { data: ss } = await sb.auth.getSession();
      const { error } = await sb.auth.signInWithPassword({ email: ss.session?.user.email ?? "", password: ov.pw });
      if (error) throw new Error(t("That password is not right.", "पासवर्ड सही नहीं है।"));
      await rpc("override_compliance", { p_supplier: supId, p_reason: ov.reason });
    }
    try {
      const id = await rpc<string>("create_deal", { p: {
        supplier_id: supId, deal_date: dealDate, expected_date: expected || null, gst_rate: gst,
        provisional_pct: terms.pct, provisional_days: terms.pdays, balance_days: terms.bdays,
        open_price: pricing === "open", price_basis: pricing === "open" ? basis : null, price_fix_days: pricing === "open" ? fixDays : null,
        lines: good.map((l) => ({ grade: l.grade, qty_kg: Number(l.qty), rate_per_kg: isNum(l.rate) ? Number(l.rate) : null })) } });
      onClose(); onSaved(id);
    } catch (e) {
      if (/is not onboarded/.test((e as Error).message)) setBlocked((e as Error).message);
      throw e;
    }
  });
  return (
    <Sheet title={t("New deal", "नया सौदा")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save deal", "सौदा सेव करें")} />}>
      <p className="muted small">{t("Book what was agreed. The PO is issued from the deal once it is booked.", "जो तय हुआ वो बुक करें। बुक होने के बाद सौदे से PO जारी होगा।")}</p>
      <Field label={t("Supplier", "सप्लायर")}>
        <Select value={sup} onChange={setSup} placeholder={t("Choose…", "चुनें…")}
                options={[...sups.map((x) => ({ value: x.id, label: x.onboarded_at || x.compliance_override_at ? x.name : `${x.name} · ${t("not onboarded", "ऑनबोर्ड नहीं")}` })), { value: "new", label: `+ ${t("New supplier", "नया सप्लायर")}` }]} />
      </Field>
      {sup === "new" && <p className="muted small">{t("A new supplier starts as not onboarded. Finish onboarding from the supplier's page.", "नया सप्लायर ऑनबोर्ड नहीं माना जाएगा। सप्लायर के पेज से ऑनबोर्डिंग पूरी करें।")}</p>}
      {sup === "new" && (
        <div className="grid2">
          <Field label={t("Supplier name", "सप्लायर का नाम")} wide><TextIn value={newSup.name} onValue={(v) => setNewSup({ ...newSup, name: v })} /></Field>
          <Field label="GSTIN"><TextIn value={newSup.gstin} onValue={(v) => setNewSup({ ...newSup, gstin: v })} /></Field>
          <Field label={t("State", "राज्य")}><TextIn value={newSup.state} onValue={(v) => setNewSup({ ...newSup, state: v })} /></Field>
        </div>
      )}
      <h3 className="sub">{t("What was agreed", "क्या तय हुआ")}</h3>
      <div className="seg wide" role="group" aria-label={t("Price", "रेट")}>
        <button type="button" className={pricing === "fixed" ? "on" : ""} onClick={() => setPricing("fixed")}>{t("Fixed price", "तय रेट")}</button>
        <button type="button" className={pricing === "open" ? "on" : ""} onClick={() => setPricing("open")}>{t("Open (LME, fix later)", "खुला (LME, बाद में तय)")}</button>
      </div>
      {pricing === "open" && (
        <div className="grid2">
          <Field label={t("Price basis", "रेट का आधार")} hint={t("How it will be fixed", "कैसे तय होगा")}><TextIn value={basis} onValue={setBasis} placeholder={t("e.g. LME copper cash − 6%", "जैसे LME कॉपर कैश − 6%")} /></Field>
          <Field label={t("Fix within", "कितने दिन में तय")} hint={t("after each truck arrives; you get an alert", "हर ट्रक आने के बाद; सूचना मिलेगी")}><NumIn value={fixDays} onChange={setFixDays} suffix={t("days", "दिन")} /></Field>
        </div>)}
      {lines.map((l, i) => (
        <div className="line" key={i}>
          <Field label={t("Grade", "ग्रेड")}><Select value={l.grade} onChange={(v) => setLine(i, "grade", v)} placeholder="—" options={grades.map((g) => ({ value: g.code, label: nm(lang, g) }))} /></Field>
          <Field label={t("Agreed weight", "तय वज़न")}><NumIn value={l.qty} onChange={(v) => setLine(i, "qty", v)} suffix="kg" /></Field>
          <Field label={pricing === "open" ? t("Rate (optional)", "रेट (वैकल्पिक)") : t("Rate excl. GST", "रेट (GST अलग)")}><NumIn value={l.rate} onChange={(v) => setLine(i, "rate", v)} suffix="₹/kg" placeholder={pricing === "open" ? t("open", "खुला") : undefined} /></Field>
          {lines.length > 1 && <button type="button" className="x" aria-label={t("Remove", "हटाएँ")} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <Btn small onClick={() => setLines([...lines, { grade: "", qty: "", rate: "" }])}>+ {t("Another grade", "और ग्रेड")}</Btn>
      <div className="grid2 gap-top">
        <Field label={t("Deal date", "सौदे की तारीख")}><input type="date" value={dealDate} onChange={(e) => setDealDate(e.target.value)} /></Field>
        <Field label={t("Expected arrival", "माल कब आएगा")}><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        <Field label="GST"><NumIn value={gst} onChange={setGst} suffix="%" /></Field>
      </div>
      {blocked && (
        <div className="warnbox">
          <strong>{blocked}</strong>
          {can("compliance_override") ? (
            <div className="stack">
              <p className="small">{t("To book anyway (long-standing supplier), give a reason and your password, then save again.", "फिर भी बुक करने के लिए (पुराना सप्लायर) कारण और अपना पासवर्ड डालें, फिर सेव करें।")}</p>
              <Field label={t("Reason", "कारण")}><TextIn value={ov.reason} onValue={(v) => setOv({ ...ov, reason: v })} /></Field>
              <Field label={t("Your password", "आपका पासवर्ड")}><input type="password" autoComplete="current-password" value={ov.pw} onChange={(e) => setOv({ ...ov, pw: e.target.value })} /></Field>
            </div>)
            : <p className="small">{t("Finish onboarding from the supplier's page, or ask Himanshu to override.", "सप्लायर के पेज से ऑनबोर्डिंग पूरी करें, या हिमांशु से छूट लें।")} <a href={`#/supplier/${sup}`}>{t("Open supplier", "सप्लायर खोलें")}</a></p>}
        </div>)}
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

// ---------- PRD 7b: material from the branch, an import seller or a job worker (no deal, no money) ----------
const TYPE_WORD: Record<string, [string, string]> = {
  branch: ["branch transfer", "ब्रांच ट्रांसफर"], import: ["import", "इम्पोर्ट"], job_work: ["job work", "जॉब वर्क"] };
const DOC: Record<string, { code: string; en: string; hi: string }> = {
  branch: { code: "DELIVERY_NOTE", en: "Delivery note", hi: "डिलीवरी नोट" },
  import: { code: "BILL_OF_ENTRY", en: "Bill of entry", hi: "बिल ऑफ एंट्री" },
  job_work: { code: "CHALLAN", en: "Challan", hi: "चालान" },
};
type RL = { grade: string; theirs: string; gross: string; bags: string; bagKg: string };

function ReceiptSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (lotId: string) => void }) {
  const t = useT(); const lang = useLang(); const me = useMe();
  const m = useLoad(() => Promise.all([
    q(sb.from("suppliers").select("id,name,supplier_type").eq("active", true).neq("supplier_type", "domestic").order("name")),
    q(sb.from("grades").select("*").eq("active", true).order("sort")),
  ]), []);
  const [sup, setSup] = useState("");
  const [docNo, setDocNo] = useState(""); const [docDate, setDocDate] = useState(today());
  const [rec, setRec] = useState(today()); const [veh, setVeh] = useState(""); const [sentBy, setSentBy] = useState("");
  const [lines, setLines] = useState<RL[]>([{ grade: "", theirs: "", gross: "", bags: "", bagKg: "" }]);
  const [photo, setPhoto] = useState<File | null>(null);
  const s = useSave();
  if (!m.data) return m.error ? <Sheet title="…" onClose={onClose}><Err error={m.error} /></Sheet> : null;
  const [sups, grades] = m.data;
  const type = sups.find((x) => x.id === sup)?.supplier_type as string | undefined;
  const doc = type ? DOC[type] : undefined;
  const set = (i: number, k: keyof RL, v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const n = (v: string) => (isNum(v) ? Number(v) : 0);
  const save = () => s.run(async () => {
    if (!sup) throw new Error(t("Choose who sent the material.", "माल किसने भेजा, चुनें।"));
    if (!docNo.trim()) throw new Error(t("Enter the document number.", "डॉक्यूमेंट नंबर डालें।"));
    const used = lines.filter((x) => x.grade || x.theirs || x.gross);
    if (!used.length) throw new Error(t("Enter the weights for at least one grade.", "कम से कम एक ग्रेड का वज़न डालें।"));
    for (const x of used) if (!x.grade || !isNum(x.theirs) || !isNum(x.gross))
      throw new Error(t("Each grade needs the weight on their document and our weighbridge gross.", "हर ग्रेड का उनके डॉक्यूमेंट का वज़न और हमारा कुल वज़न डालें।"));
    if (photo && refusal(photo)) throw new Error(t("The document must be a photo or PDF under 20 MB.", "डॉक्यूमेंट 20 MB से छोटी फोटो या PDF हो।"));
    const lotId = await rpc<string>("create_receipt", { p: {
      supplier_id: sup, invoice_no: docNo, invoice_date: docDate, received_on: rec, vehicle_no: veh, sent_by: sentBy,
      lines: used.map((x) => ({ grade: x.grade, billed_net_kg: x.theirs, factory_gross_kg: x.gross, bag_count: x.bags, factory_bag_kg: x.bagKg || "0" })) } });
    if (photo && doc) {
      const lot = await q<Row>(sb.from("lots").select("deal_id, deals(deal_no)").eq("id", lotId).single());
      await enqueue({ id: lot.deal_id, deal_no: lot.deals.deal_no }, doc.code, [photo], me.id, lotId);
    }
    onClose(); onSaved(lotId);
  });
  return (
    <Sheet title={t("Material from branch, import or job work", "ब्रांच, इम्पोर्ट या जॉब वर्क से माल")} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save arrival", "माल आया सेव करें")} />}>
      <Field label={t("Who sent it", "किसने भेजा")} hint={!sups.length ? t("Add the branch, import sellers and job workers in Admin > Suppliers first.", "पहले एडमिन > सप्लायर में ब्रांच, इम्पोर्ट विक्रेता और जॉब वर्कर जोड़ें।") : undefined}>
        <Select value={sup} onChange={setSup} placeholder="—" options={sups.map((x) => ({ value: x.id, label: `${x.name} · ${t(...TYPE_WORD[x.supplier_type])}` }))} /></Field>
      <div className="grid2">
        <Field label={doc ? `${t(doc.en, doc.hi)} ${t("number", "नंबर")}` : t("Document number", "डॉक्यूमेंट नंबर")}><TextIn value={docNo} onValue={setDocNo} /></Field>
        <Field label={t("Document date", "डॉक्यूमेंट की तारीख")}><DateIn value={docDate} onChange={setDocDate} futureOnly /></Field>
        <Field label={t("Received on", "माल आने की तारीख")}><DateIn value={rec} onChange={setRec} /></Field>
        <Field label={t("Vehicle number", "गाड़ी नंबर")}><TextIn value={veh} onValue={setVeh} autoCapitalize="characters" /></Field>
        {type === "branch" && <Field label={t("Sent by (at Mumbai)", "किसने भेजा (मुंबई में)")}><TextIn value={sentBy} onValue={setSentBy} /></Field>}
      </div>
      <label className={`upload ${photo ? "done" : ""}`}>
        {photo ? `✓ ${t("Document photo added", "डॉक्यूमेंट की फोटो जुड़ी")} · ${photo.name}` : `📷 ${t("Photo of the", "फोटो:")} ${doc ? t(doc.en, doc.hi) : t("document", "डॉक्यूमेंट")}`}
        <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {lines.map((x, i) => {
        const net = n(x.gross) - n(x.bagKg); const diff = n(x.theirs) - net; const ready = isNum(x.theirs) && isNum(x.gross);
        return (
          <div className="card grade-card" key={i}>
            <Field label={t("Grade", "ग्रेड")}><Select value={x.grade} onChange={(v) => set(i, "grade", v)} placeholder="—" options={grades.map((g) => ({ value: g.code, label: nm(lang, g) }))} /></Field>
            <div className="grid2">
              <Field label={type === "branch" ? t("Weight sent from Mumbai", "मुंबई से भेजा वज़न") : t("Weight on their document", "उनके डॉक्यूमेंट पर वज़न")}><NumIn value={x.theirs} onChange={(v) => set(i, "theirs", v)} suffix="kg" /></Field>
              <Field label={t("Gross incl. bags", "कुल वज़न (बोरी सहित)")}><NumIn value={x.gross} onChange={(v) => set(i, "gross", v)} suffix="kg" /></Field>
              <Field label={t("Number of bags", "बोरी गिनती")}><NumIn value={x.bags} onChange={(v) => set(i, "bags", v)} /></Field>
              <Field label={t("Weight of all bags", "सभी बोरियों का वज़न")}><NumIn value={x.bagKg} onChange={(v) => set(i, "bagKg", v)} suffix="kg" /></Field>
            </div>
            {ready && <p className={`result ${diff > 0.0005 ? "bad" : "okline"}`}>{t("Our net (gross − bags)", "हमारा नेट (कुल − बोरी)")} {kg(net)} · {diff > 0.0005 ? `${t("Short", "कम")} ${kg(diff)}` : diff < -0.0005 ? `${t("Excess", "ज़्यादा")} ${kg(-diff)}` : t("Matches", "बराबर")}</p>}
          </div>
        );
      })}
      <Btn small onClick={() => setLines([...lines, { grade: "", theirs: "", gross: "", bags: "", bagKg: "" }])}>+ {t("Another grade", "और ग्रेड")}</Btn>
      <p className="muted small">{t("No invoice, payment or debit note in rupees for this material. Shortages and rejections become notes in kg.", "इस माल का बिल, भुगतान या रुपये का डेबिट नोट नहीं। कमी और रिजेक्शन किलो के नोट बनेंगे।")}</p>
    </Sheet>
  );
}

// ---------- "+ Truck arrived": one button, three paths ----------
function TruckSheet({ incoming, onClose, onPick }: { incoming: Row[]; onClose: () => void; onPick: (k: "booked" | "unbooked" | "other", dealId?: string) => void }) {
  const t = useT();
  return (
    <Sheet title={t("Truck arrived", "ट्रक आया")} onClose={onClose}>
      <h3 className="sub">{t("Against a booked deal", "बुक किए सौदे का")}</h3>
      {incoming.length === 0 ? <Empty>{t("Nothing booked is on the way.", "कोई बुक माल रास्ते में नहीं है।")}</Empty> : (
        <ul className="rows">{incoming.map((d) => (
          <li key={d.deal_id} className={Number(d.days_late) > 0 ? "edge-bad" : "edge-info"}>
            <button type="button" className="row" onClick={() => onPick("booked", d.deal_id)}>
              <span className="row-main"><strong>{d.supplier}</strong>
                <span className="muted small">{d.deal_no}{d.po_no ? ` · ${d.po_no}` : ""} · {t("still to come", "आना बाकी")} {kg(d.remaining_kg)} · {t("expected", "अपेक्षित")} {day(d.expected_date)}</span></span>
            </button></li>))}
        </ul>)}
      <h3 className="sub">{t("Not booked", "बिना बुकिंग")}</h3>
      <ul className="rows"><li className="edge-wait"><button type="button" className="row" onClick={() => onPick("unbooked")}>
        <span className="row-main"><strong>{t("A supplier's truck nobody booked", "ऐसा ट्रक जिसका सौदा बुक नहीं था")}</strong>
          <span className="muted small">{t("Recorded and tallied in full. The rate comes from the invoice until Himanshu confirms it.", "पूरा दर्ज और हिसाब में। हिमांशु जी के पक्का करने तक रेट बिल से।")}</span></span>
      </button></li></ul>
      <h3 className="sub">{t("Not a purchase", "खरीद नहीं")}</h3>
      <ul className="rows"><li><button type="button" className="row" onClick={() => onPick("other")}>
        <span className="row-main"><strong>{t("From the Mumbai branch, an import seller or a job worker", "मुंबई ब्रांच, इम्पोर्ट विक्रेता या जॉब वर्कर से")}</strong>
          <span className="muted small">{t("Delivery note, bill of entry or challan; no money.", "डिलीवरी नोट, बिल ऑफ एंट्री या चालान; पैसा नहीं।")}</span></span>
      </button></li></ul>
    </Sheet>
  );
}

// ---------- a domestic truck that came without a booking: recorded and tallied like any purchase ----------
type UL = { grade: string; slipGross: string; slipBags: string; billed: string; rate: string; gross: string; bags: string; bagKg: string };
const emptyUL = (): UL => ({ grade: "", slipGross: "", slipBags: "", billed: "", rate: "", gross: "", bags: "", bagKg: "" });

function UnbookedSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (lotId: string) => void }) {
  const t = useT(); const lang = useLang(); const me = useMe();
  const m = useLoad(() => Promise.all([
    q(sb.from("suppliers").select("id,name").eq("active", true).eq("supplier_type", "domestic").order("name")),
    q(sb.from("grades").select("*").eq("active", true).order("sort")),
  ]), []);
  const [sup, setSup] = useState("");
  const [newSup, setNewSup] = useState({ name: "", gstin: "", state: "" });
  const [invNo, setInvNo] = useState(""); const [invDate, setInvDate] = useState(today());
  const [gst, setGst] = useState("18"); const [rec, setRec] = useState(today()); const [veh, setVeh] = useState("");
  const [lines, setLines] = useState<UL[]>([emptyUL()]);
  const [photo, setPhoto] = useState<File | null>(null);
  const s = useSave();
  if (!m.data) return m.error ? <Sheet title="…" onClose={onClose}><Err error={m.error} /></Sheet> : null;
  const [sups, grades] = m.data;
  const set = (i: number, k: keyof UL, v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const n = (v: string) => (isNum(v) ? Number(v) : 0);
  const save = () => s.run(async () => {
    if (!sup) throw new Error(t("Choose the supplier.", "सप्लायर चुनें।"));
    if (sup === "new" && !newSup.name.trim()) throw new Error(t("Enter the supplier's name.", "सप्लायर का नाम डालें।"));
    if (sup === "new" && newSup.gstin.trim() && !gstinOk(newSup.gstin))
      throw new Error(t("The GSTIN does not look right (15 characters, e.g. 27AAMCR8303C1ZF). Check it on the invoice.", "GSTIN सही नहीं लग रहा (15 अक्षर, जैसे 27AAMCR8303C1ZF)। बिल पर जाँचें।"));
    if (!invNo.trim()) throw new Error(t("Enter the invoice number.", "बिल नंबर डालें।"));
    const used = lines.filter((x) => x.grade || x.billed || x.gross);
    if (!used.length) throw new Error(t("Enter the weights for at least one grade.", "कम से कम एक ग्रेड का वज़न डालें।"));
    for (const x of used) {
      if (!x.grade || !isNum(x.billed) || !isNum(x.rate) || Number(x.rate) <= 0)
        throw new Error(t("Each grade needs the billed weight and rate from the invoice.", "हर ग्रेड का बिल वाला वज़न और रेट डालें।"));
      if (!isNum(x.gross)) throw new Error(t("Each grade needs our weighbridge gross weight.", "हर ग्रेड का हमारा कुल वज़न डालें।"));
    }
    if (photo && refusal(photo)) throw new Error(t("The invoice must be a photo or PDF under 20 MB.", "बिल 20 MB से छोटी फोटो या PDF हो।"));
    const lotId = await rpc<string>("create_unbooked_lot", { p: {
      supplier_id: sup === "new" ? null : sup, supplier_name: newSup.name, supplier_gstin: normGstin(newSup.gstin), supplier_state: newSup.state,
      gst_rate: gst, invoice_no: invNo, invoice_date: invDate, received_on: rec, vehicle_no: veh,
      lines: used.map((x) => ({ grade: x.grade, billed_net_kg: x.billed, billed_rate: x.rate,
                                factory_gross_kg: x.gross, bag_count: x.bags, factory_bag_kg: x.bagKg || "0" })) } });
    if (photo) {
      const lot = await q<Row>(sb.from("lots").select("deal_id, deals(deal_no)").eq("id", lotId).single());
      await enqueue({ id: lot.deal_id, deal_no: lot.deals.deal_no }, "TAX_INVOICE", [photo], me.id, lotId);
    }
    onClose(); onSaved(lotId);
  });
  return (
    <Sheet title={t("Truck arrived without a booking", "बिना बुकिंग ट्रक आया")} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save arrival", "माल आया सेव करें")} />}>
      <p className="muted small">{t("Everything is recorded as for a booked deal. The rate is taken from the invoice; Himanshu is asked to confirm it.", "सब कुछ बुक सौदे की तरह दर्ज होगा। रेट बिल से लिया जाएगा; हिमांशु जी से पक्का करवाया जाएगा।")}</p>
      <Field label={t("Supplier", "सप्लायर")}>
        <Select value={sup} onChange={setSup} placeholder="—" options={[...sups.map((x) => ({ value: x.id, label: x.name })), { value: "new", label: `+ ${t("New supplier", "नया सप्लायर")}` }]} /></Field>
      {sup === "new" && (
        <div className="grid2">
          <Field label={t("Supplier name", "सप्लायर का नाम")} wide><TextIn value={newSup.name} onValue={(v) => setNewSup({ ...newSup, name: v })} /></Field>
          <Field label="GSTIN"><TextIn value={newSup.gstin} onValue={(v) => setNewSup({ ...newSup, gstin: v })} /></Field>
          <Field label={t("State", "राज्य")}><TextIn value={newSup.state} onValue={(v) => setNewSup({ ...newSup, state: v })} /></Field>
        </div>)}
      <div className="grid2">
        <Field label={t("Supplier invoice number", "सप्लायर का बिल नंबर")}><TextIn value={invNo} onValue={setInvNo} /></Field>
        <Field label={t("Invoice date", "बिल की तारीख")}><DateIn value={invDate} onChange={setInvDate} futureOnly /></Field>
        <Field label="GST"><NumIn value={gst} onChange={setGst} suffix="%" /></Field>
        <Field label={t("Received on", "माल आने की तारीख")}><DateIn value={rec} onChange={setRec} /></Field>
        <Field label={t("Vehicle number", "गाड़ी नंबर")}><TextIn value={veh} onValue={setVeh} autoCapitalize="characters" /></Field>
      </div>
      <label className={`upload ${photo ? "done" : ""}`}>
        {photo ? `✓ ${t("Invoice photo added", "बिल की फोटो जुड़ी")} · ${photo.name}` : `📷 ${t("Photo of the supplier invoice", "सप्लायर बिल की फोटो")}`}
        <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {lines.map((x, i) => {
        const net = n(x.gross) - n(x.bagKg); const diff = n(x.billed) - net; const ready = isNum(x.billed) && isNum(x.gross);
        return (
          <div className="card grade-card" key={i}>
            <Field label={t("Grade", "ग्रेड")}><Select value={x.grade} onChange={(v) => set(i, "grade", v)} placeholder="—" options={grades.map((g) => ({ value: g.code, label: nm(lang, g) }))} /></Field>
            <p className="label-row">{t("As per the supplier's invoice", "सप्लायर के बिल के अनुसार")}</p>
            <div className="grid2">
              <Field label={t("Weight on invoice", "बिल पर वज़न")}><NumIn value={x.billed} onChange={(v) => set(i, "billed", v)} suffix="kg" /></Field>
              <Field label={t("Rate on invoice (excl. GST)", "बिल पर रेट (GST अलग)")}><NumIn value={x.rate} onChange={(v) => set(i, "rate", v)} suffix="₹/kg" /></Field>
            </div>
            <p className="label-row">{t("At our weighbridge (we count and weigh the bags)", "हमारे काँटे पर (बोरी हम गिनते और तौलते हैं)")}</p>
            <div className="grid3">
              <Field label={t("Gross incl. bags", "कुल वज़न (बोरी सहित)")}><NumIn value={x.gross} onChange={(v) => set(i, "gross", v)} suffix="kg" /></Field>
              <Field label={t("Number of bags", "बोरी गिनती")}><NumIn value={x.bags} onChange={(v) => set(i, "bags", v)} /></Field>
              <Field label={t("Weight of all bags", "सभी बोरियों का वज़न")}><NumIn value={x.bagKg} onChange={(v) => set(i, "bagKg", v)} suffix="kg" /></Field>
            </div>
            {ready && <p className={`result ${diff > 0.0005 ? "bad" : "okline"}`}>{t("Our net (gross − bags)", "हमारा नेट (कुल − बोरी)")} {kg(net)} · {diff > 0.0005 ? `${t("Short", "कम")} ${kg(diff)}` : diff < -0.0005 ? `${t("Excess", "ज़्यादा")} ${kg(-diff)}` : t("Matches", "बराबर")}</p>}
          </div>
        );
      })}
      <Btn small onClick={() => setLines([...lines, emptyUL()])}>+ {t("Another grade", "और ग्रेड")}</Btn>
    </Sheet>
  );
}
