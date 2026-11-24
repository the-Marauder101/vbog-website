// Transport we arrange: a booking against a deal (transporter, truck, booked price). When the truck arrives the
// booking is attached to its lot and locked. The transporter's bill is compared with the booked price.
import { useState } from "react";
import { day, go, inr, isNum, q, rpc, sb, today, useCan, useLoad, useT, type Row } from "../lib";
import { Btn, Chip, DateIn, Empty, Err, Field, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
import { useSave } from "../common";

export function transportState(b: Row): [string, string, "wait" | "info" | "ok" | "bad"] {
  if (b.status === "cancelled") return ["Cancelled", "रद्द", "bad"];
  if (b.bill_differs) return ["Bill differs", "बिल अलग", "bad"];
  if (!b.lot_id) return ["Truck awaited", "ट्रक आना बाकी", "wait"];
  if (b.bill_amount == null) return ["Bill awaited", "बिल आना बाकी", "info"];
  if (Number(b.to_pay) > 0.005) return ["To pay", "देना है", "info"];
  return ["Done", "पूरा", "ok"];
}

function line(t: ReturnType<typeof useT>, b: Row) {
  return [b.transporter, b.vehicle_no?.toUpperCase(), b.from_place ? `${t("from", "से")} ${b.from_place}` : null,
          b.pickup_on ? `${t("pickup", "लोडिंग")} ${day(b.pickup_on)}` : null].filter(Boolean).join(" · ");
}

/** Deal page: bookings for this deal, and "+ Book transport" */
export function DealTransport({ deal, onChange }: { deal: Row; onChange?: () => void }) {
  const t = useT(); const can = useCan();
  const [edit, setEdit] = useState<Row | null>(null);
  const { data, error, reload } = useLoad(() => q(sb.from("v_transport").select("*").eq("deal_id", deal.id).order("booked_on")), [deal.id]);
  if (!data) return error ? <Err error={error} /> : null;
  if (!data.length && !can("transport_edit")) return null;
  return (
    <Section title={t("Transport (when we arrange the truck)", "ट्रांसपोर्ट (जब ट्रक हम लगाते हैं)")}
      right={can("transport_edit") && !deal.cancelled ? <Btn small onClick={() => setEdit({ deal_id: deal.id })}>+ {t("Book transport", "ट्रांसपोर्ट बुक करें")}</Btn> : undefined}>
      {data.length === 0 ? <p className="muted small">{t("None. Most deals are delivered at our gate; book a truck only when we pay for transport.", "कोई नहीं। ज़्यादातर माल हमारे गेट तक आता है; ट्रक तभी बुक करें जब भाड़ा हम दें।")}</p> : (
        <ul className="rows">{data.map((b) => { const st = transportState(b); return (
          <li key={b.id}><button type="button" className="row" onClick={() => (b.lot_id ? go(`lot/${b.lot_id}`) : can("transport_edit") ? setEdit(b) : undefined)}>
            <span className="row-main"><strong>{b.booking_no} · {inr(b.booked_price)}</strong>
              <span className="muted small">{line(t, b)}{b.lot_no ? ` · ${t("brought", "लाया")} ${b.invoice_no ?? b.lot_no}` : ""}</span></span>
            <Chip tone={st[2]}>{t(st[0], st[1])}</Chip></button></li>); })}</ul>)}
      {edit && <BookingSheet row={edit} onClose={() => setEdit(null)} onSaved={() => { reload(); onChange?.(); }} />}
    </Section>
  );
}

export function BookingSheet({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const str = (v: unknown) => (v == null ? "" : String(v));
  const [f, setF] = useState({ transporter: str(row.transporter), phone: str(row.transporter_phone), vehicle: str(row.vehicle_no), driver: str(row.driver_phone),
    from: str(row.from_place), pickup: str(row.pickup_on), price: str(row.booked_price), note: str(row.note) });
  const s = useSave();
  return (
    <Sheet title={row.id ? `${row.booking_no}` : t("Book transport", "ट्रांसपोर्ट बुक करें")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} label={t("Save booking", "बुकिंग सेव करें")} onSave={() => s.run(async () => {
      if (!f.transporter.trim()) throw new Error(t("Enter the transporter.", "ट्रांसपोर्टर डालें।"));
      if (!isNum(f.price)) throw new Error(t("Enter the booked freight.", "तय भाड़ा डालें।"));
      const rec = { deal_id: row.deal_id, transporter: f.transporter.trim(), transporter_phone: f.phone.trim() || null, vehicle_no: f.vehicle.trim().toUpperCase() || null,
        driver_phone: f.driver.trim() || null, from_place: f.from.trim() || null, pickup_on: f.pickup || null, booked_price: Number(f.price), note: f.note.trim() || null };
      await q(row.id ? sb.from("transport_bookings").update(rec).eq("id", row.id) : sb.from("transport_bookings").insert(rec));
    }, () => { onSaved(); onClose(); })} />}>
      <div className="grid2">
        <Field label={t("Transporter", "ट्रांसपोर्टर")}><TextIn value={f.transporter} onValue={(v) => setF({ ...f, transporter: v })} /></Field>
        <Field label={t("Transporter phone", "ट्रांसपोर्टर फ़ोन")}><TextIn value={f.phone} onValue={(v) => setF({ ...f, phone: v })} inputMode="tel" /></Field>
        <Field label={t("Vehicle number", "गाड़ी नंबर")}><TextIn value={f.vehicle} onValue={(v) => setF({ ...f, vehicle: v })} autoCapitalize="characters" /></Field>
        <Field label={t("Driver phone", "ड्राइवर फ़ोन")}><TextIn value={f.driver} onValue={(v) => setF({ ...f, driver: v })} inputMode="tel" /></Field>
        <Field label={t("Pickup from", "कहाँ से")}><TextIn value={f.from} onValue={(v) => setF({ ...f, from: v })} /></Field>
        <Field label={t("Pickup date", "लोडिंग की तारीख")}><input type="date" value={f.pickup} onChange={(e) => setF({ ...f, pickup: e.target.value })} /></Field>
        <Field label={t("Booked freight", "तय भाड़ा")}><NumIn value={f.price} onChange={(v) => setF({ ...f, price: v })} suffix="₹" /></Field>
      </div>
      <Field label={t("Note (optional)", "नोट (वैकल्पिक)")}><TextIn value={f.note} onValue={(v) => setF({ ...f, note: v })} /></Field>
      <p className="muted small">{t("When the truck arrives, the arrival form picks this booking and attaches it to the lot. The booked freight is then fixed.", "ट्रक आने पर माल-आया फ़ॉर्म यह बुकिंग चुनकर लॉट से जोड़ देगा। फिर तय भाड़ा बदला नहीं जा सकता।")}</p>
    </Sheet>
  );
}

/** Lot page: the truck that brought this lot, its bill and payment; or attach a waiting booking */
export function LotTransport({ lot, dealIds, onChange }: { lot: Row; dealIds: string[]; onChange: () => void }) {
  const t = useT(); const can = useCan(); const s = useSave();
  const [bill, setBill] = useState(false);
  const [pick, setPick] = useState("");
  const { data, error, reload } = useLoad(() => Promise.all([
    q(sb.from("v_transport").select("*").eq("lot_id", lot.id)),
    q(sb.from("v_transport").select("*").in("deal_id", dealIds).is("lot_id", null).eq("status", "booked")),
  ]), [lot.id]);
  if (!data) return error ? <Err error={error} /> : null;
  const [mine, waiting] = data;
  const b = mine[0];
  const done = () => { reload(); onChange(); };
  if (!b && !waiting.length) return null;
  return (
    <Section title={t("Transport", "ट्रांसपोर्ट")}>
      {b ? (<>
        <p><strong>{b.booking_no}</strong> · {line(t, b)} <Chip tone={transportState(b)[2]}>{t(transportState(b)[0], transportState(b)[1])}</Chip></p>
        <table className="tbl compact"><tbody>
          <tr><td>{t("Booked freight", "तय भाड़ा")} 🔒</td><td className="n">{inr(b.booked_price)}</td></tr>
          <tr><td>{t("Transporter bill", "ट्रांसपोर्टर बिल")}{b.bill_no ? ` ${b.bill_no}` : ""}{b.bill_date ? ` · ${day(b.bill_date)}` : ""}</td><td className="n">{b.bill_amount == null ? "—" : inr(b.bill_amount)}</td></tr>
          {b.bill_differs && <tr className="bad"><td>{Number(b.bill_diff) > 0 ? t("Billed more than booked", "बुकिंग से ज़्यादा बिल") : t("Billed less than booked", "बुकिंग से कम बिल")}</td><td className="n">{inr(Math.abs(Number(b.bill_diff)))}</td></tr>}
          <tr><td>{t("Paid", "दिया")}{b.paid_on ? ` · ${day(b.paid_on)}` : ""}</td><td className="n">{inr(b.paid_amount ?? 0)}</td></tr>
        </tbody></table>
        <Err error={s.error} />
        {can("transport_edit") && <div className="actions">
          <Btn small kind="primary" onClick={() => setBill(true)}>{b.bill_amount == null ? t("Enter transporter bill", "ट्रांसपोर्टर बिल डालें") : t("Bill and payment", "बिल और पेमेंट")}</Btn>
          <Btn small disabled={s.busy} onClick={() => { if (confirm(t("Detach this booking from the lot?", "यह बुकिंग लॉट से हटाएँ?"))) s.run(() => rpc("detach_transport", { p_booking: b.id }), done, ["Detached", "हटा दिया"]); }}>{t("Detach", "हटाएँ")}</Btn>
        </div>}
      </>) : (can("transport_edit") || can("inward_edit")) && (
        <div className="stack">
          <p className="muted small">{t("A truck was booked for this deal. Attach it if it brought this lot.", "इस सौदे के लिए ट्रक बुक था। अगर यही लॉट लाया तो जोड़ें।")}</p>
          <Select value={pick} onChange={setPick} placeholder={t("Choose booking…", "बुकिंग चुनें…")} options={waiting.map((w) => ({ value: w.id, label: `${w.booking_no} · ${line(t, w)} · ${inr(w.booked_price)}` }))} />
          <Err error={s.error} />
          <Btn small kind="primary" disabled={!pick || s.busy} onClick={() => s.run(() => rpc("attach_transport", { p_booking: pick, p_lot: lot.id }), done, ["Attached", "जोड़ दिया"])}>{t("Attach to this lot", "इस लॉट से जोड़ें")}</Btn>
        </div>)}
      {bill && b && <BillSheet b={b} onClose={() => setBill(false)} onSaved={done} />}
    </Section>
  );
}

function BillSheet({ b, onClose, onSaved }: { b: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const str = (v: unknown) => (v == null ? "" : String(v));
  const [f, setF] = useState({ no: str(b.bill_no), date: str(b.bill_date) || today(), amount: str(b.bill_amount), paid: str(b.paid_amount), paidOn: str(b.paid_on) });
  const s = useSave();
  const diff = isNum(f.amount) ? Number(f.amount) - Number(b.booked_price) : 0;
  return (
    <Sheet title={`${t("Transporter bill", "ट्रांसपोर्टर बिल")} · ${b.booking_no}`} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(async () => {
      if (f.amount && !isNum(f.amount)) throw new Error(t("Check the bill amount.", "बिल की रकम जाँचें।"));
      if (f.paid && !isNum(f.paid)) throw new Error(t("Check the amount paid.", "दी गई रकम जाँचें।"));
      await q(sb.from("transport_bookings").update({ bill_no: f.no.trim() || null, bill_date: f.date || null, bill_amount: f.amount ? Number(f.amount) : null,
        paid_amount: f.paid ? Number(f.paid) : null, paid_on: f.paidOn || null }).eq("id", b.id));
    }, () => { onSaved(); onClose(); })} />}>
      <p className="muted">{t("Booked freight", "तय भाड़ा")}: <strong>{inr(b.booked_price)}</strong></p>
      <div className="grid2">
        <Field label={t("Bill number", "बिल नंबर")}><TextIn value={f.no} onValue={(v) => setF({ ...f, no: v })} /></Field>
        <Field label={t("Bill date", "बिल तारीख")}><DateIn value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label={t("Bill amount", "बिल रकम")}><NumIn value={f.amount} onChange={(v) => setF({ ...f, amount: v })} suffix="₹" /></Field>
        <Field label={t("Paid to transporter", "ट्रांसपोर्टर को दिया")}><NumIn value={f.paid} onChange={(v) => setF({ ...f, paid: v })} suffix="₹" /></Field>
        <Field label={t("Paid on", "भुगतान तारीख")}><input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
      </div>
      {isNum(f.amount) && Math.abs(diff) > 0.005 && <p className="warnbox small">{diff > 0 ? t("Billed more than booked by", "बुकिंग से ज़्यादा:") : t("Billed less than booked by", "बुकिंग से कम:")} {inr(Math.abs(diff))}. {t("Himanshu will be alerted.", "हिमांशु को सूचना जाएगी।")}</p>}
    </Sheet>
  );
}

/** Lots > Transport: every booking with where it stands */
export function TransportList() {
  const t = useT();
  const { data, error } = useLoad(() => q(sb.from("v_transport").select("*").order("booked_on", { ascending: false })), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const live = data.filter((b) => b.status !== "cancelled");
  const sum = (k: string, rows: Row[]) => rows.reduce((a, b) => a + Number(b[k] ?? 0), 0);
  return (
    <>
      <p className="muted small">{t("Booked", "बुक")} {inr(sum("booked_price", live))} · {t("billed", "बिल")} {inr(sum("bill_amount", live))} · {t("to pay", "देना")} {inr(sum("to_pay", live.filter((b) => b.lot_id)))}</p>
      {data.length === 0 ? <Empty>{t("No transport booked yet. Book it from the deal.", "अभी कोई ट्रांसपोर्ट बुक नहीं। सौदे से बुक करें।")}</Empty> : (
        <ul className="rows">{data.map((b) => { const st = transportState(b); return (
          <li key={b.id} className={st[2] === "bad" ? "edge-bad" : ""}><button type="button" className="row" onClick={() => go(b.lot_id ? `lot/${b.lot_id}` : `deal/${b.deal_id}`)}>
            <span className="row-main"><strong>{b.booking_no} · {b.supplier ?? b.transporter}</strong>
              <span className="muted small">{line(t, b)}</span>
              <span className="muted small">{b.deal_no}{b.lot_id ? ` · ${t("brought", "लाया")} ${b.invoice_no ?? b.lot_no}` : ""} · {t("booked", "तय")} {inr(b.booked_price)}{b.bill_amount != null ? ` · ${t("bill", "बिल")} ${inr(b.bill_amount)}` : ""}</span></span>
            <Chip tone={st[2]}>{t(st[0], st[1])}</Chip></button></li>); })}</ul>)}
    </>
  );
}
