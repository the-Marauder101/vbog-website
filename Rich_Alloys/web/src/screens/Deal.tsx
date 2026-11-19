import { useMemo, useState } from "react";
import { day, go, inr, isNum, kg, q, rpc, sb, today, useCan, useLang, useLoad, useT, nm, type Row } from "../lib";
import { Btn, Chip, Empty, Err, Field, KV, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
import { DealDocs, StageChip, useSave } from "../common";
import { TermsLine } from "./Lots";

export default function Deal({ id }: { id: string }) {
  const t = useT(); const lang = useLang(); const can = useCan();
  const [arrival, setArrival] = useState(false);
  const [terms, setTerms] = useState(false);
  const s = useSave();
  const { data, error, reload } = useLoad(() => Promise.all([
    q<Row>(sb.from("deals").select("*, suppliers(name, provisional_pct, provisional_days, balance_days)").eq("id", id).single()),
    q(sb.from("deal_lines").select("*, grades(name, name_hi)").eq("deal_id", id)),
    q(sb.from("v_lots").select("*").eq("deal_id", id).order("received_on")),
    q(sb.from("v_deals_incoming").select("*").eq("deal_id", id)),
  ]), [id]);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [deal, lines, lots, inc] = data;
  const incoming = inc[0];
  const sup = deal.suppliers ?? {};
  return (
    <>
      <button type="button" className="link back" onClick={() => history.back()}>← {t("Back", "वापस")}</button>
      <div className="page-head">
        <div><h1>{deal.deal_no}</h1><p className="muted">{sup.name}{deal.po_no ? ` · ${deal.po_no}` : ""}</p></div>
        {deal.cancelled ? <Chip tone="bad">{t("Cancelled", "रद्द")}</Chip> : incoming ? <Chip tone="info">{t("On the way", "रास्ते में")}</Chip> : <Chip tone="ok">{t("All received", "सब आ गया")}</Chip>}
      </div>
      <Err error={s.error} />
      {!deal.cancelled && incoming && can("inward_edit") &&
        <Btn kind="primary" className="block big" onClick={() => setArrival(true)}>+ {t("Material arrived: record it", "माल आया: दर्ज करें")}</Btn>}

      <Section title={t("What was agreed", "क्या तय हुआ")}>
        <table className="tbl">
          <thead><tr><th>{t("Grade", "ग्रेड")}</th><th className="n">{t("Quantity", "मात्रा")}</th><th className="n">{t("Rate", "रेट")}</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{nm(lang, l.grades) || l.grade}</td><td className="n">{kg(l.qty_kg)}</td><td className="n">{inr(l.rate_per_kg)}/kg</td></tr>)}</tbody>
        </table>
        <KV rows={[
          [t("Deal date", "सौदे की तारीख"), day(deal.deal_date)],
          [t("Expected arrival", "माल कब आएगा"), day(deal.expected_date)],
          ["GST", `${deal.gst_rate}%`],
          ...(incoming ? [[t("Still to come", "आना बाकी"), kg(incoming.remaining_kg)] as [string, string]] : []),
          ...(incoming && can("money_view") ? [[t("Value still to come (with GST)", "आने वाले माल की कीमत (GST सहित)"), inr(incoming.remaining_value)] as [string, string]] : []),
          ...(can("money_view") ? [[t("Payment terms", "पेमेंट शर्तें"), <TermsLine key="t" pct={deal.provisional_pct ?? sup.provisional_pct} pdays={deal.provisional_days ?? sup.provisional_days} bdays={deal.balance_days ?? sup.balance_days} />] as [string, JSX.Element]] : []),
        ]} />
        <div className="actions">
          {can("deal_edit") && !deal.cancelled && <Btn onClick={() => setTerms(true)}>{t("Payment terms for this deal", "इस सौदे की पेमेंट शर्तें")}</Btn>}
          {can("deal_edit") && !deal.cancelled && incoming && lots.length > 0 &&
            <Btn onClick={() => s.run(() => q(sb.from("deals").update({ receiving_complete: true }).eq("id", id)), reload)}>{t("No more material coming", "अब और माल नहीं आएगा")}</Btn>}
          {can("deal_edit") && !deal.cancelled && !incoming &&
            <Btn onClick={() => s.run(() => q(sb.from("deals").update({ receiving_complete: false }).eq("id", id)), reload)}>{t("More material is coming", "और माल आएगा")}</Btn>}
          {can("deal_edit") && !deal.cancelled && lots.length === 0 &&
            <Btn kind="danger" onClick={() => { if (confirm(t("Cancel this deal?", "यह सौदा रद्द करें?"))) s.run(() => q(sb.from("deals").update({ cancelled: true }).eq("id", id)), reload); }}>{t("Cancel deal", "सौदा रद्द करें")}</Btn>}
        </div>
      </Section>

      <Section title={t("Lots received", "आए हुए लॉट")}>
        {lots.length === 0 ? <Empty>{t("No material received yet.", "अभी कोई माल नहीं आया।")}</Empty> : (
          <ul className="rows">{lots.map((l) => (
            <li key={l.lot_id}><button type="button" className="row" onClick={() => go(`lot/${l.lot_id}`)}>
              <span className="row-main"><strong>{l.lot_no}</strong><span className="muted small">{day(l.received_on)} · {l.invoice_no}</span></span>
              <StageChip stage={l.stage} /></button></li>))}
          </ul>)}
      </Section>

      <Section title={t("Documents", "दस्तावेज़")}>
        <DealDocs dealId={id} dealNo={deal.deal_no} hasReturn={lots.some((l) => Number(l.returns_open) > 0) || false} />
      </Section>

      {arrival && <ArrivalSheet deal={deal} lines={lines} onClose={() => setArrival(false)} onSaved={(lot) => go(`lot/${lot}`)} />}
      {terms && <TermsSheet table="deals" id={id} row={deal} onClose={() => setTerms(false)} onSaved={reload} />}
    </>
  );
}

export function TermsSheet({ table, id, row, onClose, onSaved }: { table: "deals" | "lots" | "suppliers"; id: string; row: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const str = (v: unknown) => (v == null ? "" : String(v));
  const [pct, setPct] = useState(str(row.provisional_pct));
  const [pd, setPd] = useState(str(row.provisional_days));
  const [bd, setBd] = useState(str(row.balance_days));
  const s = useSave();
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <Sheet title={t("Payment terms", "पेमेंट शर्तें")} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(async () => {
        if (pct && (Number(pct) < 0 || Number(pct) > 100)) throw new Error(t("Provisional share must be 0 to 100%.", "प्रोविजनल 0 से 100% के बीच हो।"));
        await q(sb.from(table).update({ provisional_pct: n(pct), provisional_days: n(pd), balance_days: n(bd) }).eq("id", id));
      }, () => { onSaved(); onClose(); })} />}>
      <p className="muted">{table === "suppliers" ? t("Used for every deal with this supplier unless a deal or lot says otherwise.", "इस सप्लायर के हर सौदे पर लगेगा, जब तक सौदा या लॉट अलग न कहे।")
        : t("Leave empty to use the supplier's terms.", "खाली छोड़ें तो सप्लायर की शर्तें लगेंगी।")}</p>
      <Field label={t("Share paid provisionally", "प्रोविजनल कितना")}><NumIn value={pct} onChange={setPct} suffix="%" /></Field>
      <Field label={t("Provisional paid how many days after the invoice", "बिल के कितने दिन बाद प्रोविजनल")}><NumIn value={pd} onChange={setPd} suffix={t("days", "दिन")} /></Field>
      <Field label={t("Balance paid how many days after the invoice", "बिल के कितने दिन बाद बाकी")}><NumIn value={bd} onChange={setBd} suffix={t("days", "दिन")} /></Field>
    </Sheet>
  );
}

type GL = { grade: string; slipGross: string; slipBags: string; billed: string; rate: string; gross: string; bags: string; bagKg: string };
function ArrivalSheet({ deal, lines, onClose, onSaved }: { deal: Row; lines: Row[]; onClose: () => void; onSaved: (lot: string) => void }) {
  const t = useT(); const lang = useLang();
  const grades = useLoad(() => q(sb.from("grades").select("*").eq("active", true).order("sort")), []);
  const [rec, setRec] = useState(today());
  const [veh, setVeh] = useState("");
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState(today());
  const [printed, setPrinted] = useState("");
  const [complete, setComplete] = useState(true);
  const [gl, setGl] = useState<GL[]>(lines.map((l) => ({ grade: l.grade, slipGross: "", slipBags: "", billed: "", rate: String(l.rate_per_kg), gross: "", bags: "", bagKg: "" })));
  const s = useSave();
  const set = (i: number, k: keyof GL, v: string) => setGl(gl.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const num = (v: string) => (isNum(v) ? Number(v) : 0);
  const taxable = useMemo(() => Math.round(gl.reduce((a, x) => a + num(x.billed) * num(x.rate), 0) * 100) / 100, [gl]);
  const gst = Math.round(taxable * Number(deal.gst_rate) / 100 * 100) / 100;
  const total = Math.round((taxable + gst) * 100) / 100;
  const save = () => s.run(async () => {
    if (!invNo.trim()) throw new Error(t("Enter the invoice number.", "बिल नंबर डालें।"));
    const used = gl.filter((x) => x.billed || x.gross);
    if (!used.length) throw new Error(t("Enter the weights for at least one grade.", "कम से कम एक ग्रेड का वज़न डालें।"));
    for (const x of used) {
      if (!isNum(x.billed) || !isNum(x.rate)) throw new Error(t("Each grade needs the billed weight and rate from the invoice.", "हर ग्रेड का बिल वाला वज़न और रेट डालें।"));
      if (!isNum(x.gross)) throw new Error(t("Each grade needs our weighbridge gross weight.", "हर ग्रेड का हमारा कुल वज़न डालें।"));
    }
    const id = await rpc<string>("create_lot", { p: {
      deal_id: deal.id, received_on: rec, vehicle_no: veh, invoice_no: invNo, invoice_date: invDate,
      total: printed || null, completes_deal: complete,
      lines: used.map((x) => ({ grade: x.grade, billed_net_kg: x.billed, billed_rate: x.rate, slip_gross_kg: x.slipGross, slip_bag_kg: x.slipBags,
                                factory_gross_kg: x.gross, bag_count: x.bags, factory_bag_kg: x.bagKg || "0" })) } });
    onClose(); onSaved(id);
  });
  const gName = (code: string) => nm(lang, grades.data?.find((g) => g.code === code)) || code;
  return (
    <Sheet title={`${t("Material arrived", "माल आया")} · ${deal.deal_no}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save arrival", "माल आया सेव करें")} />}>
      <div className="grid2">
        <Field label={t("Received on", "माल आने की तारीख")}><input type="date" value={rec} onChange={(e) => setRec(e.target.value)} /></Field>
        <Field label={t("Vehicle number", "गाड़ी नंबर")}><TextIn value={veh} onValue={setVeh} autoCapitalize="characters" /></Field>
        <Field label={t("Supplier invoice number", "सप्लायर का बिल नंबर")}><TextIn value={invNo} onValue={setInvNo} /></Field>
        <Field label={t("Invoice date", "बिल की तारीख")}><input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></Field>
      </div>
      {gl.map((x, i) => {
        const fNet = num(x.gross) - num(x.bagKg); const diff = num(x.billed) - fNet; const ready = isNum(x.billed) && isNum(x.gross);
        return (
          <div className="card grade-card" key={i}>
            <h3>{gName(x.grade)}</h3>
            <p className="label-row">{t("As per supplier (packing slip and invoice)", "सप्लायर के अनुसार (पैकिंग स्लिप और बिल)")}</p>
            <div className="grid3">
              <Field label={t("Slip gross", "स्लिप कुल")}><NumIn value={x.slipGross} onChange={(v) => set(i, "slipGross", v)} suffix="kg" /></Field>
              <Field label={t("Slip bags", "स्लिप बोरी")}><NumIn value={x.slipBags} onChange={(v) => set(i, "slipBags", v)} suffix="kg" /></Field>
              <Field label={t("Billed net", "बिल नेट")}><NumIn value={x.billed} onChange={(v) => set(i, "billed", v)} suffix="kg" /></Field>
              <Field label={t("Billed rate", "बिल रेट")}><NumIn value={x.rate} onChange={(v) => set(i, "rate", v)} suffix="₹/kg" /></Field>
            </div>
            <p className="label-row">{t("At our weighbridge", "हमारे काँटे पर")}</p>
            <div className="grid3">
              <Field label={t("Gross", "कुल वज़न")}><NumIn value={x.gross} onChange={(v) => set(i, "gross", v)} suffix="kg" /></Field>
              <Field label={t("Number of bags", "बोरी गिनती")}><NumIn value={x.bags} onChange={(v) => set(i, "bags", v)} /></Field>
              <Field label={t("Bag weight", "बोरी वज़न")}><NumIn value={x.bagKg} onChange={(v) => set(i, "bagKg", v)} suffix="kg" /></Field>
            </div>
            {ready && (
              <p className={`result ${diff > 0.0005 ? "bad" : diff < -0.0005 ? "wait" : "ok"}`}>
                {t("Our net", "हमारा नेट")} {kg(fNet)} · {diff > 0.0005 ? `${t("Short", "कम")} ${kg(diff)}` : diff < -0.0005 ? `${t("Excess", "ज़्यादा")} ${kg(-diff)}` : t("Matches", "बराबर")}
              </p>
            )}
          </div>
        );
      })}
      <div className="card">
        <KV rows={[
          [t("Taxable (weights × rate)", "कर योग्य (वज़न × रेट)"), inr(taxable)],
          [`GST ${deal.gst_rate}%`, inr(gst)],
          [t("Invoice total", "बिल कुल"), <strong key="t">{inr(total)}</strong>],
        ]} />
        <Field label={t("Total printed on the invoice, if different", "बिल पर छपा कुल, अगर अलग हो")} hint={printed && Math.abs(Number(printed) - total) > 1 ? t("Differs from the weights × rate. Check the invoice.", "वज़न × रेट से अलग है। बिल जाँचें।") : undefined}>
          <NumIn value={printed} onChange={setPrinted} suffix="₹" />
        </Field>
      </div>
      <label className="check"><input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} /> {t("All material for this deal has arrived", "इस सौदे का सारा माल आ गया")}</label>
    </Sheet>
  );
}
