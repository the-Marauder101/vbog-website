import { enqueue, refusal } from "../uploads";
import { useMemo, useState } from "react";
import { day, go, inr, isNum, kg, q, rpc, sb, today, useCan, useLang, useLoad, useMe, useT, nm, type Row } from "../lib";
import { DateIn, Btn, Chip, Empty, Err, Field, KV, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
import { DealDocs, PriceDecisions, RateCell, RateHistory, StageChip, useSave } from "../common";
import { TermsLine } from "./Lots";

export default function Deal({ id, openArrival }: { id: string; openArrival?: boolean }) {
  const t = useT(); const lang = useLang(); const can = useCan();
  const [arrival, setArrival] = useState(!!openArrival);
  const [rates, setRates] = useState<Record<string, string> | null>(null);
  const [terms, setTerms] = useState(false);
  const s = useSave();
  const { data, error, reload } = useLoad(() => Promise.all([
    q<Row>(sb.from("deals").select("*, suppliers(*)").eq("id", id).single()),
    q(sb.from("deal_lines").select("*, grades(name, name_hi)").eq("deal_id", id)),
    q(sb.from("v_lots").select("*").contains("deal_ids", [id]).order("received_on")),
    q(sb.from("v_deals_incoming").select("*").eq("deal_id", id)),
    q(sb.from("deal_rate_history").select("*, profiles(full_name), lots(lot_no)").eq("deal_id", id).order("changed_at", { ascending: false })),
  ]), [id]);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [deal, lines, lots, inc, rateHistory] = data;
  const incoming = inc[0];
  const sup = deal.suppliers ?? {};
  return (
    <>
      <button type="button" className="link back" onClick={() => history.back()}>← {t("Back", "वापस")}</button>
      <div className="page-head">
        <div><h1>{deal.deal_no}</h1><p className="muted"><a href={`#/supplier/${deal.supplier_id}`}>{sup.name}</a>{deal.po_no ? ` · ${deal.po_no}` : ""}
          {sup.supplier_type === "domestic" && !sup.onboarded_at && <> <Chip tone="wait">{t("Not onboarded", "ऑनबोर्ड नहीं")}</Chip></>}</p></div>
        {deal.cancelled ? <Chip tone="bad">{t("Cancelled", "रद्द")}</Chip> : incoming ? <Chip tone="info">{t("On the way", "रास्ते में")}</Chip> : <Chip tone="ok">{t("All received", "सब आ गया")}</Chip>}
      </div>
      <Err error={s.error} />
      {deal.unbooked && (
        <div className={deal.rate_confirmed_at ? "notice ok-notice" : "warnbox"}>
          <strong>{t("Arrived without a booking.", "बिना बुकिंग के आया।")}</strong>{" "}
          {deal.rate_confirmed_at
            ? `${t("Rate confirmed on", "रेट पक्का किया")} ${day(deal.rate_confirmed_at)}.`
            : t("The rate is taken from the supplier's invoice until Himanshu confirms it.", "हिमांशु जी के पक्का करने तक रेट सप्लायर के बिल से लिया गया है।")}
          {!deal.rate_confirmed_at && can("rate_confirm") && !rates &&
            <div className="actions"><Btn kind="primary" onClick={() => setRates(Object.fromEntries(lines.map((l) => [l.grade, String(l.rate_per_kg)])))}>{t("Confirm the rate", "रेट पक्का करें")}</Btn></div>}
          {rates && (
            <div className="stack">
              <p className="small">{t("Change a rate only if the phone deal was different. Debit notes use the confirmed rate.", "रेट तभी बदलें जब फोन पर अलग तय हुआ हो। डेबिट नोट पक्के रेट से बनेंगे।")}</p>
              {lines.map((l) => (
                <Field key={l.grade} label={`${nm(lang, l.grades) || l.grade} · ${t("agreed rate", "तय रेट")}`}>
                  <NumIn value={rates[l.grade] ?? ""} onChange={(v) => setRates({ ...rates, [l.grade]: v })} suffix="₹/kg" /></Field>))}
              <div className="actions">
                <Btn kind="primary" disabled={s.busy} onClick={() => s.run(async () => {
                  const changed = Object.fromEntries(lines.filter((l) => Number(rates[l.grade]) !== Number(l.rate_per_kg)).map((l) => [l.grade, Number(rates[l.grade])]));
                  if (Object.values(changed).some((v) => !(Number(v) > 0))) throw new Error(t("Enter each agreed rate.", "हर तय रेट डालें।"));
                  await rpc("confirm_deal_rate", { p_deal: id, p_rates: Object.keys(changed).length ? changed : null });
                }, () => { setRates(null); reload(); })}>{t("Confirm", "पक्का करें")}</Btn>
                <Btn onClick={() => setRates(null)}>{t("Cancel", "रद्द करें")}</Btn>
              </div>
            </div>
          )}
        </div>
      )}
      {!deal.cancelled && incoming && Number(incoming.days_late) > 0 &&
        <p className="error">{t("Late by", "देरी")} {incoming.days_late} {t("days: expected", "दिन: आना था")} {day(deal.expected_date)}.</p>}
      {!deal.cancelled && sup.supplier_type === "domestic" && <PoBlock deal={deal} lines={lines} history={rateHistory} reload={reload} />}
      {!deal.cancelled && incoming && can("inward_edit") &&
        <Btn kind="primary" className="block big" onClick={() => setArrival(true)}>+ {t("Material arrived: record it", "माल आया: दर्ज करें")}</Btn>}

      <Section title={t("What was agreed", "क्या तय हुआ")}>
        <table className="tbl">
          <thead><tr><th>{t("Grade", "ग्रेड")}</th><th className="n">{t("Quantity", "मात्रा")}</th><th className="n">{t("Rate excl. GST", "रेट (GST अलग)")}</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{nm(lang, l.grades) || l.grade}</td><td className="n">{kg(l.qty_kg)}</td>
            <td className="n"><RateCell rate={l.rate_per_kg} label={l.grade} editable={can("deal_edit") && !deal.cancelled} save={(v) => rpc("set_deal_rate", { p_deal: id, p_grade: l.grade, p_rate: v })} onSaved={reload} /></td></tr>)}</tbody>
        </table>
        {lines.some((l) => l.rate_per_kg == null) && (
          <p className="notice small"><strong>{t("Open price", "खुला रेट")}</strong>{deal.price_basis ? `: ${deal.price_basis}` : ""}{deal.price_fix_days != null ? ` · ${t("fix within", "तय करें")} ${deal.price_fix_days} ${t("days of each truck", "दिन में (हर ट्रक के बाद)")}` : ""}.
            {" "}{t("Each truck's price is fixed on the lot by Himanshu; fixing it here fixes every open truck too.", "हर ट्रक का रेट हिमांशु लॉट पर तय करते हैं; यहाँ तय करने से सभी खुले ट्रक भी तय हो जाते हैं।")}</p>)}
        {can("deal_edit") && !deal.cancelled && <p className="muted small">{t("Tap a rate to change it for trucks still to come. A truck's price is fixed when it enters the factory; after that only Himanshu changes it, on the lot.", "आगे आने वाले ट्रकों का रेट बदलने के लिए टैप करें। ट्रक फ़ैक्टरी में आते ही उसका रेट तय हो जाता है; उसके बाद सिर्फ़ हिमांशु लॉट पर बदल सकते हैं।")}</p>}
        {rateHistory.length > 1 && <RateHistory rows={rateHistory} names={Object.fromEntries(lines.map((l) => [l.grade, nm(lang, l.grades) || l.grade]))} />}
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

      <PriceDecisions dealId={id} title onDone={reload} />
      <Section title={t("Lots (trucks) received", "आए हुए लॉट (ट्रक)")}>
        {lots.length === 0 ? <Empty>{t("No material received yet.", "अभी कोई माल नहीं आया।")}</Empty> : (
          <ul className="rows">{lots.map((l) => (
            <li key={l.lot_id}><button type="button" className="row" onClick={() => go(`lot/${l.lot_id}`)}>
              <span className="row-main"><strong>{l.lot_no}</strong><span className="muted small">{day(l.received_on)} · {l.invoice_no}{l.deal_ids?.length > 1 ? ` · ${t("same truck as", "इसी ट्रक में")} ${l.deal_nos}` : ""}{l.price_open ? ` · ${t("price open", "रेट खुला")}` : ""}</span></span>
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
  const [hp, setHp] = useState(str(row.hold_pct));
  const [hd, setHd] = useState(str(row.hold_days));
  const [scope, setScope] = useState(String(row.hold_scope ?? "lot"));
  const s = useSave();
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <Sheet title={t("Payment terms", "पेमेंट शर्तें")} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(async () => {
        if (pct && (Number(pct) < 0 || Number(pct) > 100)) throw new Error(t("Provisional share must be 0 to 100%.", "प्रोविजनल 0 से 100% के बीच हो।"));
        if (hp && (Number(hp) < 0 || Number(hp) > 100)) throw new Error(t("Hold must be 0 to 100%.", "रोकना 0 से 100% के बीच हो।"));
        await q(sb.from(table).update({ provisional_pct: n(pct), provisional_days: n(pd), balance_days: n(bd), hold_pct: n(hp), hold_days: n(hd),
                                        ...(table === "suppliers" ? { hold_scope: scope } : {}) }).eq("id", id));
      }, () => { onSaved(); onClose(); })} />}>
      <p className="muted">{table === "suppliers" ? t("Used for every deal with this supplier unless a deal or lot says otherwise.", "इस सप्लायर के हर सौदे पर लगेगा, जब तक सौदा या लॉट अलग न कहे।")
        : t("Leave empty to use the supplier's terms.", "खाली छोड़ें तो सप्लायर की शर्तें लगेंगी।")}</p>
      <Field label={t("Share paid provisionally", "प्रोविजनल कितना")}><NumIn value={pct} onChange={setPct} suffix="%" /></Field>
      <Field label={t("Provisional paid how many days after the invoice", "बिल के कितने दिन बाद प्रोविजनल")}><NumIn value={pd} onChange={setPd} suffix={t("days", "दिन")} /></Field>
      <Field label={t("Balance paid how many days after the invoice", "बिल के कितने दिन बाद बाकी")}><NumIn value={bd} onChange={setBd} suffix={t("days", "दिन")} /></Field>
      <h3 className="sub">{t("Hold back", "रोक कर रखें")}</h3>
      <p className="muted small">{t("Pay up to 100% minus the hold. You are alerted when that is reached, and again when the held amount is due.", "रोकी रकम छोड़कर बाकी पेमेंट करें। सीमा पहुँचने पर और रोकी रकम देने के दिन, दोनों बार सूचना मिलेगी।")}</p>
      <div className="grid2">
        <Field label={t("Hold", "रोकें")}><NumIn value={hp} onChange={setHp} suffix="%" /></Field>
        <Field label={t("Release after", "कितने दिन बाद दें")}><NumIn value={hd} onChange={setHd} suffix={t("days", "दिन")} /></Field>
      </div>
      {table === "suppliers" && <Field label={t("Count it", "हिसाब")}><Select value={scope} onChange={setScope} options={[
        { value: "lot", label: t("For each lot", "हर लॉट का अलग") }, { value: "supplier", label: t("Across all this supplier's bills", "इस सप्लायर के सभी बिल मिलाकर") }]} /></Field>}
    </Sheet>
  );
}

// A PO is issued after the deal is booked, then sent to the supplier as a PDF.
function PoBlock({ deal, lines, history, reload }: { deal: Row; lines: Row[]; history: Row[]; reload: () => void }) {
  const t = useT(); const can = useCan();
  const [no, setNo] = useState<string | null>(null);
  const s = useSave();
  const changed = deal.po_issued_at && history.some((h) => h.source !== "booked" && !h.lot_id && h.changed_at > deal.po_issued_at);
  const pdf = () => s.run(async () => { const { downloadPo } = await import("../po"); await downloadPo(deal, lines); }, undefined, ["PO downloaded", "PO डाउनलोड हुआ"]);
  const open = () => s.run(async () => setNo(deal.po_no ?? await rpc<string>("suggest_po_no", {})), undefined, null);
  if (no !== null) return (
    <div className="card stack">
      <Field label={t("PO number", "PO नंबर")} hint={t("Suggested from the last PO. Change it if you need to.", "पिछले PO से सुझाया गया। ज़रूरत हो तो बदलें।")}><TextIn value={no} onValue={setNo} /></Field>
      <Err error={s.error} />
      <div className="actions">
        <Btn kind="primary" disabled={s.busy} onClick={() => s.run(async () => {
          const v = await rpc<string>("issue_po", { p_deal: deal.id, p_po_no: no });
          const { downloadPo } = await import("../po");
          await downloadPo({ ...deal, po_no: v, po_date: new Date().toISOString().slice(0, 10), po_revision: Number(deal.po_revision ?? 0) + 1 }, lines);
        }, () => { setNo(null); reload(); }, ["PO issued and downloaded", "PO जारी हुआ, डाउनलोड हुआ"])}>{t("Issue PO and download PDF", "PO जारी करें, PDF डाउनलोड करें")}</Btn>
        <Btn onClick={() => setNo(null)}>{t("Cancel", "रद्द करें")}</Btn>
      </div>
    </div>);
  if (!deal.po_issued_at) return (
    <div className={deal.unbooked ? "notice" : "warnbox"}>
      <strong>{t("PO not issued yet.", "PO अभी जारी नहीं हुआ।")}</strong> {t("Issue it and send the PDF to the supplier.", "जारी करें और PDF सप्लायर को भेजें।")}
      <Err error={s.error} />
      {can("deal_edit") && <div className="actions"><Btn kind="primary" disabled={s.busy} onClick={open}>{t("Issue PO", "PO जारी करें")}</Btn></div>}
    </div>);
  return (
    <div className={changed ? "warnbox" : "notice ok-notice"}>
      <strong>PO {deal.po_no}</strong> · {t("issued", "जारी")} {day(deal.po_date)}{Number(deal.po_revision) > 1 ? ` · Rev ${deal.po_revision}` : ""}
      {changed && <p className="small">{t("Rates changed after this PO was issued. Re-issue it so the supplier has the new rates.", "PO के बाद रेट बदले। सप्लायर को नए रेट देने के लिए दोबारा जारी करें।")}</p>}
      <Err error={s.error} />
      <div className="actions">
        <Btn disabled={s.busy} onClick={pdf}>{t("Download PO (PDF)", "PO डाउनलोड (PDF)")}</Btn>
        {can("deal_edit") && <Btn kind={changed ? "primary" : ""} disabled={s.busy} onClick={open}>{t("Re-issue PO", "PO दोबारा जारी करें")}</Btn>}
      </div>
    </div>);
}

type GL = { grade: string; slipGross: string; slipBags: string; billed: string; rate: string; gross: string; bags: string; bagKg: string;
             dealId: string; dealNo: string; agreed: number | null };
function ArrivalSheet({ deal, lines, onClose, onSaved }: { deal: Row; lines: Row[]; onClose: () => void; onSaved: (lot: string) => void }) {
  const t = useT(); const lang = useLang();
  const grades = useLoad(() => q(sb.from("grades").select("*").eq("active", true).order("sort")), []);
  const [rec, setRec] = useState(today());
  const [veh, setVeh] = useState("");
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState(today());
  const [printed, setPrinted] = useState("");
  const [complete, setComplete] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const me = useMe();
  // The invoice rate is typed from the invoice, never pre-filled: a pre-filled agreed rate would hide a difference.
  const blank = (l: Row, d: Row): GL => ({ grade: l.grade, slipGross: "", slipBags: "", billed: "", rate: "", gross: "", bags: "", bagKg: "",
                                         dealId: d.id, dealNo: d.deal_no, agreed: l.rate_per_kg == null ? null : Number(l.rate_per_kg) });
  const [gl, setGl] = useState<GL[]>(lines.map((l) => blank(l, deal)));
  // the same truck can carry material booked on another open deal of this supplier
  const others = useLoad(() => q(sb.from("deals").select("id, deal_no, deal_lines(grade, rate_per_kg)").eq("supplier_id", deal.supplier_id)
    .eq("cancelled", false).eq("receiving_complete", false).neq("id", deal.id).order("deal_date")), [deal.id]);
  const [pickDeal, setPickDeal] = useState(false);
  const s = useSave();
  const set = (i: number, k: keyof GL, v: string) => setGl(gl.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const num = (v: string) => (isNum(v) ? Number(v) : 0);
  const taxable = useMemo(() => Math.round(gl.reduce((a, x) => a + num(x.billed) * num(x.rate), 0) * 100) / 100, [gl]);
  const gst = Math.round(taxable * Number(deal.gst_rate) / 100 * 100) / 100;
  const total = Math.round((taxable + gst) * 100) / 100;
  const save = () => s.run(async () => {
    if (!invNo.trim()) throw new Error(t("Enter the invoice number.", "बिल नंबर डालें।"));
    if (photo && refusal(photo)) throw new Error(refusal(photo) === "tooBig"
      ? t("The invoice file is larger than 20 MB. Take a photo instead.", "बिल की फाइल 20 MB से बड़ी है। फोटो लें।")
      : t("The invoice must be a photo or PDF.", "बिल फोटो या PDF होना चाहिए।"));
    const used = gl.filter((x) => x.billed || x.gross);
    if (!used.length) throw new Error(t("Enter the weights for at least one grade.", "कम से कम एक ग्रेड का वज़न डालें।"));
    for (const x of used) {
      if (!isNum(x.billed) || !isNum(x.rate)) throw new Error(t("Each grade needs the billed weight and rate from the invoice.", "हर ग्रेड का बिल वाला वज़न और रेट डालें।"));
      if (!isNum(x.gross)) throw new Error(t("Each grade needs our weighbridge gross weight.", "हर ग्रेड का हमारा कुल वज़न डालें।"));
    }
    const id = await rpc<string>("create_lot", { p: {
      deal_id: deal.id, received_on: rec, vehicle_no: veh, invoice_no: invNo, invoice_date: invDate,
      total: printed || null, completes_deal: complete,
      lines: used.map((x) => ({ grade: x.grade, deal_id: x.dealId, billed_net_kg: x.billed, billed_rate: x.rate, slip_gross_kg: x.slipGross, slip_bag_kg: x.slipBags,
                                factory_gross_kg: x.gross, bag_count: x.bags, factory_bag_kg: x.bagKg || "0" })) } });
    // Through the upload queue: saved on the phone, retried until it is up, never dropped silently.
    if (photo) await enqueue({ id: deal.id, deal_no: deal.deal_no }, "TAX_INVOICE", [photo], me.id, id);
    onClose(); onSaved(id);
  });
  const gName = (code: string) => nm(lang, grades.data?.find((g) => g.code === code)) || code;
  return (
    <Sheet title={`${t("Material arrived", "माल आया")} · ${deal.deal_no}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save arrival", "माल आया सेव करें")} />}>
      <div className="grid2">
        <Field label={t("Received on", "माल आने की तारीख")}><DateIn value={rec} onChange={setRec} /></Field>
        <Field label={t("Vehicle number", "गाड़ी नंबर")}><TextIn value={veh} onValue={setVeh} autoCapitalize="characters" /></Field>
        <Field label={t("Supplier invoice number", "सप्लायर का बिल नंबर")}><TextIn value={invNo} onValue={setInvNo} /></Field>
        <Field label={t("Invoice date", "बिल की तारीख")}><DateIn value={invDate} onChange={setInvDate} futureOnly /></Field>
      </div>
      <label className={`upload ${photo ? "done" : ""}`}>
        {photo ? `✓ ${t("Invoice photo added", "बिल की फोटो जुड़ी")} · ${photo.name}` : `📷 ${t("Photo of the supplier invoice", "सप्लायर बिल की फोटो")}`}
        <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {gl.map((x, i) => {
        const fNet = num(x.gross) - num(x.bagKg); const diff = num(x.billed) - fNet; const ready = isNum(x.billed) && isNum(x.gross);
        return (
          <div className="card grade-card" key={i}>
            <h3>{gName(x.grade)}{x.dealId !== deal.id ? <span className="muted small"> · {x.dealNo}</span> : null}</h3>
            <p className="label-row">{t("As per supplier (packing slip and invoice)", "सप्लायर के अनुसार (पैकिंग स्लिप और बिल)")}</p>
            <div className="grid3">
              <Field label={t("Slip gross", "स्लिप कुल")}><NumIn value={x.slipGross} onChange={(v) => set(i, "slipGross", v)} suffix="kg" /></Field>
              <Field label={t("Slip bags", "स्लिप बोरी")}><NumIn value={x.slipBags} onChange={(v) => set(i, "slipBags", v)} suffix="kg" /></Field>
              <Field label={t("Billed net", "बिल नेट")}><NumIn value={x.billed} onChange={(v) => set(i, "billed", v)} suffix="kg" /></Field>
              <Field label={t("Rate on invoice (excl. GST)", "बिल पर रेट (GST अलग)")} hint={(() => {
                const agreed = x.agreed;
                if (agreed == null) return t("price open: fixed later", "रेट खुला: बाद में तय");
                if (!isNum(x.rate) || Number(x.rate) === agreed) return `${t("agreed", "तय")} ${inr(agreed)}`;
                return <span className="bad">{t("Differs from agreed", "तय रेट से अलग")} {inr(agreed)}: {t("it will be flagged", "इसे फ्लैग किया जाएगा")}</span>;
              })()}><NumIn value={x.rate} onChange={(v) => set(i, "rate", v)} suffix="₹/kg" placeholder={x.agreed == null ? "" : String(x.agreed)} /></Field>
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
      {(others.data ?? []).length > 0 && (pickDeal ? (
        <Field label={t("Material from which other deal?", "किस दूसरे सौदे का माल?")}>
          <Select value="" placeholder={t("Choose…", "चुनें…")} onChange={(v) => {
            const d = others.data?.find((x) => x.id === v); if (!d) return;
            const add = (d.deal_lines ?? []).filter((l: Row) => !gl.some((x) => x.grade === l.grade)).map((l: Row) => blank(l, d));
            setGl([...gl, ...add]); setPickDeal(false);
          }} options={(others.data ?? []).map((d) => ({ value: d.id, label: `${d.deal_no} · ${(d.deal_lines ?? []).map((l: Row) => gName(l.grade)).join(", ")}` }))} />
        </Field>)
        : <Btn small onClick={() => setPickDeal(true)}>+ {t("Material from another deal on this truck", "इसी ट्रक में दूसरे सौदे का माल")}</Btn>)}
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

