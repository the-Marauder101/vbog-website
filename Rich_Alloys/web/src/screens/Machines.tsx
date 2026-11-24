// Machine purchases (capital goods): what was ordered, the payment schedule, what is paid and what is still to pay by date.
import { useState } from "react";
import { addDays, day, inr, isNum, q, sb, today, useCan, useLoad, useT, type Row } from "../lib";
import { Btn, Chip, DateIn, Empty, Err, Field, KV, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
import { useSave } from "../common";

const STATUS: Record<string, [string, string, "wait" | "info" | "ok" | "bad"]> = {
  ordered: ["Ordered", "ऑर्डर हुआ", "wait"], delivered: ["Delivered", "डिलीवर हुई", "info"], installed: ["Installed", "लग गई", "ok"], cancelled: ["Cancelled", "रद्द", "bad"] };
const MODES = ["neft", "rtgs", "imps", "cheque", "cash", "other"];
const monthOf = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });

export default function Machines() {
  const t = useT(); const can = useCan();
  const [add, setAdd] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => Promise.all([
    q(sb.from("v_machine_orders").select("*").order("ordered_on", { ascending: false })),
    q(sb.from("v_machine_cash").select("*").order("due_on", { ascending: true, nullsFirst: false })),
  ]), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [orders, cash] = data;
  const live = orders.filter((o) => o.status !== "cancelled");
  const now = today(); const in30 = addDays(now, 30);
  const due = cash.filter((c) => Number(c.outstanding) > 0.005);
  const sum = (rows: Row[]) => rows.reduce((a, c) => a + Number(c.outstanding), 0);
  const overdue = sum(due.filter((c) => c.due_on && c.due_on < now));
  const next30 = sum(due.filter((c) => c.due_on && c.due_on >= now && c.due_on <= in30));
  const later = sum(due.filter((c) => c.due_on && c.due_on > in30));
  const unsched = sum(due.filter((c) => !c.due_on));
  const months = [...new Set(due.filter((c) => c.due_on && c.due_on >= now).map((c) => monthOf(c.due_on)))];
  return (
    <>
      <div className="page-head"><h2 className="sub">{t("Machines", "मशीनें")}</h2>
        {can("machine_edit") && <Btn kind="primary" onClick={() => setAdd(true)}>+ {t("Machine order", "मशीन ऑर्डर")}</Btn>}</div>
      <KV rows={[
        [t("Ordered (incl. GST)", "ऑर्डर (GST सहित)"), inr(live.reduce((a, o) => a + Number(o.total), 0))],
        [t("Paid", "दिया"), inr(live.reduce((a, o) => a + Number(o.paid), 0))],
        [t("Still to pay", "देना बाकी"), <strong key="b">{inr(sum(due))}</strong>],
        ...(overdue > 0.005 ? [[t("Overdue", "बकाया"), <strong key="o" className="bad">{inr(overdue)}</strong>] as [string, JSX.Element]] : []),
        [t("Due in the next 30 days", "अगले 30 दिन में"), inr(next30)],
        [t("Later", "बाद में"), inr(later)],
        ...(unsched > 0.005 ? [[t("Not scheduled yet", "तारीख तय नहीं"), inr(unsched)] as [string, string]] : []),
      ]} />
      {months.length > 0 && (
        <Section title={t("To pay by month", "महीने के हिसाब से देना")}>
          <table className="tbl compact"><tbody>
            {overdue > 0.005 && <tr className="bad"><td>{t("Overdue", "बकाया")}</td><td className="n">{inr(overdue)}</td></tr>}
            {months.map((m) => <tr key={m}><td>{m}</td><td className="n">{inr(sum(due.filter((c) => c.due_on && c.due_on >= now && monthOf(c.due_on) === m)))}</td></tr>)}
          </tbody></table>
        </Section>)}
      <Section title={t("Orders", "ऑर्डर")}>
        {orders.length === 0 ? <Empty>{t("No machine orders yet.", "अभी कोई मशीन ऑर्डर नहीं।")}</Empty> : (
          <ul className="rows">{orders.map((o) => {
            const next = due.find((c) => c.order_id === o.id && c.due_on);
            const st = STATUS[o.status];
            return (
              <li key={o.id} className={o.status === "cancelled" ? "off" : ""}><button type="button" className="row" onClick={() => setOpen(o.id)}>
                <span className="row-main"><strong>{o.description}</strong>
                  <span>{o.vendor}</span>
                  <span className="muted small">{o.order_no} · {day(o.ordered_on)} · {t("total", "कुल")} {inr(o.total)} · {t("paid", "दिया")} {inr(o.paid)}</span>
                  {next && <span className={`small ${next.due_on < now ? "bad" : ""}`}>{t("Next", "अगला")}: {next.label} {inr(next.outstanding)} · {day(next.due_on)}</span>}
                  <span><Chip tone={st[2]}>{t(st[0], st[1])}</Chip></span></span>
                <span className="amt">{inr(o.balance)}</span>
              </button></li>);
          })}</ul>)}
      </Section>
      {add && <NewMachine onClose={() => setAdd(false)} onSaved={reload} />}
      {open && <MachineSheet id={open} cash={cash.filter((c) => c.order_id === open)} onClose={() => setOpen(null)} onSaved={reload} />}
    </>
  );
}

type MS = { label: string; due: string; pct: string; amount: string };
function NewMachine({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ vendor: "", gstin: "", description: "", ref: "", ordered: today(), expected: "", value: "", gst: "18" });
  const [ms, setMs] = useState<MS[]>([{ label: "Advance", due: today(), pct: "30", amount: "" }, { label: "On dispatch", due: "", pct: "60", amount: "" }, { label: "After installation", due: "", pct: "10", amount: "" }]);
  const s = useSave();
  const total = isNum(f.value) ? Math.round(Number(f.value) * (1 + Number(f.gst || 0) / 100) * 100) / 100 : 0;
  const amt = (m: MS) => (isNum(m.amount) ? Number(m.amount) : isNum(m.pct) ? Math.round(total * Number(m.pct)) / 100 : 0);
  const scheduled = ms.reduce((a, m) => a + amt(m), 0);
  const setM = (i: number, k: keyof MS, v: string) => setMs(ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  return (
    <Sheet title={t("New machine order", "नया मशीन ऑर्डर")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} label={t("Save order", "ऑर्डर सेव करें")} onSave={() => s.run(async () => {
      if (!f.vendor.trim() || !f.description.trim()) throw new Error(t("Enter the machine and the vendor.", "मशीन और वेंडर डालें।"));
      if (!isNum(f.value)) throw new Error(t("Enter the order value (excl. GST).", "ऑर्डर की कीमत डालें (GST अलग)।"));
      const used = ms.filter((m) => amt(m) > 0);
      if (used.some((m) => !m.due || !m.label.trim())) throw new Error(t("Each payment step needs a name and a date.", "हर पेमेंट के लिए नाम और तारीख डालें।"));
      if (scheduled > total + 0.5) throw new Error(t("The schedule adds up to more than the order total.", "पेमेंट का जोड़ ऑर्डर से ज़्यादा है।"));
      const o = await q<Row>(sb.from("machine_orders").insert({ vendor: f.vendor.trim(), vendor_gstin: f.gstin.trim().toUpperCase() || null, description: f.description.trim(),
        ref_no: f.ref.trim() || null, ordered_on: f.ordered, expected_on: f.expected || null, value: Number(f.value), gst_rate: Number(f.gst || 0) }).select("id").single());
      if (used.length) await q(sb.from("machine_milestones").insert(used.map((m, i) => ({ order_id: o.id, label: m.label.trim(), due_on: m.due, amount: amt(m), sort: i + 1 }))));
    }, () => { onSaved(); onClose(); })} />}>
      <Field label={t("Machine", "मशीन")}><TextIn value={f.description} onValue={(v) => setF({ ...f, description: v })} placeholder={t("e.g. 500 kg induction furnace", "जैसे 500 kg इंडक्शन भट्टी")} /></Field>
      <div className="grid2">
        <Field label={t("Vendor", "वेंडर")}><TextIn value={f.vendor} onValue={(v) => setF({ ...f, vendor: v })} /></Field>
        <Field label={t("Vendor GSTIN (optional)", "वेंडर GSTIN (वैकल्पिक)")}><TextIn value={f.gstin} onValue={(v) => setF({ ...f, gstin: v })} /></Field>
        <Field label={t("Quotation / PO ref", "कोटेशन / PO नं.")}><TextIn value={f.ref} onValue={(v) => setF({ ...f, ref: v })} /></Field>
        <Field label={t("Ordered on", "ऑर्डर की तारीख")}><DateIn value={f.ordered} onChange={(v) => setF({ ...f, ordered: v })} /></Field>
        <Field label={t("Expected delivery", "डिलीवरी कब")}><input type="date" value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} /></Field>
        <Field label={t("Value excl. GST", "कीमत (GST अलग)")}><NumIn value={f.value} onChange={(v) => setF({ ...f, value: v })} suffix="₹" /></Field>
        <Field label="GST"><NumIn value={f.gst} onChange={(v) => setF({ ...f, gst: v })} suffix="%" /></Field>
      </div>
      <p className="notice small">{t("Total incl. GST", "कुल (GST सहित)")}: <strong>{inr(total)}</strong></p>
      <h3 className="sub">{t("Payment schedule (incl. GST)", "पेमेंट शेड्यूल (GST सहित)")}</h3>
      {ms.map((m, i) => (
        <div className="card milestone" key={i}>
          <div className="item-head"><strong>{i + 1}.</strong>
            {ms.length > 1 && <button type="button" className="x" aria-label={t("Remove", "हटाएँ")} onClick={() => setMs(ms.filter((_, j) => j !== i))}>×</button>}</div>
          <div className="grid2">
            <Field label={t("Step", "चरण")}><TextIn value={m.label} onValue={(v) => setM(i, "label", v)} /></Field>
            <Field label={t("Due on", "तारीख")}><input type="date" value={m.due} onChange={(e) => setM(i, "due", e.target.value)} /></Field>
            <Field label={t("% of total", "कुल का %")}><NumIn value={m.pct} onChange={(v) => setMs(ms.map((x, j) => (j === i ? { ...x, pct: v, amount: "" } : x)))} suffix="%" /></Field>
            <Field label={t("Or amount", "या रकम")}><NumIn value={m.amount} onChange={(v) => setM(i, "amount", v)} suffix="₹" placeholder={amt(m) ? String(amt(m)) : ""} /></Field>
          </div>
        </div>))}
      <Btn small onClick={() => setMs([...ms, { label: "", due: "", pct: "", amount: "" }])}>+ {t("Another payment", "और पेमेंट")}</Btn>
      <p className={`small ${Math.abs(total - scheduled) > 0.5 ? "warn" : "muted"}`}>{t("Scheduled", "शेड्यूल")} {inr(scheduled)} {t("of", "में से")} {inr(total)}{Math.abs(total - scheduled) > 0.5 ? ` · ${t("not scheduled", "तय नहीं")} ${inr(total - scheduled)}` : ""}</p>
    </Sheet>
  );
}

function MachineSheet({ id, cash, onClose, onSaved }: { id: string; cash: Row[]; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const can = useCan(); const s = useSave();
  const { data, error, reload } = useLoad(() => Promise.all([
    q<Row>(sb.from("v_machine_orders").select("*").eq("id", id).single()),
    q(sb.from("machine_payments").select("*").eq("order_id", id).order("paid_on")),
  ]), [id]);
  const [pay, setPay] = useState({ amount: "", date: today(), mode: "neft", ref: "" });
  const [adding, setAdding] = useState(false);
  if (!data) return <Sheet title="…" onClose={onClose}>{error ? <Err error={error} /> : <Loading />}</Sheet>;
  const [o, pays] = data;
  const done = () => { reload(); onSaved(); };
  const edit = can("machine_edit");
  return (
    <Sheet title={`${o.order_no} · ${o.description}`} onClose={onClose}>
      <KV rows={[
        [t("Vendor", "वेंडर"), `${o.vendor}${o.vendor_gstin ? ` · ${o.vendor_gstin}` : ""}`],
        [t("Ordered", "ऑर्डर"), `${day(o.ordered_on)}${o.ref_no ? ` · ${o.ref_no}` : ""}`],
        [t("Expected delivery", "डिलीवरी कब"), day(o.expected_on)],
        [t("Value excl. GST", "कीमत (GST अलग)"), inr(o.value)],
        [t("Total incl. GST", "कुल (GST सहित)"), inr(o.total)],
        [t("Paid", "दिया"), inr(o.paid)],
        [t("Still to pay", "देना बाकी"), <strong key="b">{inr(o.balance)}</strong>],
      ]} />
      {edit && <Field label={t("Status", "स्थिति")}><Select value={o.status} onChange={(v) => s.run(() => q(sb.from("machine_orders").update({ status: v, delivered_on: v === "delivered" && !o.delivered_on ? today() : o.delivered_on }).eq("id", id)), done)}
        options={Object.entries(STATUS).map(([v, l]) => ({ value: v, label: t(l[0], l[1]) }))} /></Field>}
      <h3 className="sub">{t("Payment schedule", "पेमेंट शेड्यूल")}</h3>
      {cash.length === 0 ? <Empty>{t("No schedule.", "शेड्यूल नहीं।")}</Empty> : (
        <table className="tbl compact"><tbody>{cash.map((c, i) => (
          <tr key={i} className={c.due_on && c.due_on < today() && Number(c.outstanding) > 0.005 ? "bad" : ""}>
            <td>{c.label}<br /><span className="muted small">{c.due_on ? day(c.due_on) : t("no date", "तारीख नहीं")}</span></td>
            <td className="n">{inr(c.amount)}<br /><span className="small">{Number(c.outstanding) > 0.005 ? `${t("to pay", "बाकी")} ${inr(c.outstanding)}` : t("paid ✓", "दिया ✓")}</span></td></tr>))}
        </tbody></table>)}
      <h3 className="sub">{t("Payments", "भुगतान")}</h3>
      {pays.length === 0 ? <Empty>{t("No payments yet.", "अभी कोई भुगतान नहीं।")}</Empty> : (
        <ul className="rows">{pays.map((p) => <li key={p.id}><div className="row static"><span className="row-main"><strong>{inr(p.amount)}</strong>
          <span className="muted small">{day(p.paid_on)} · {String(p.mode).toUpperCase()}{p.bank_ref ? ` · ${p.bank_ref}` : ""}</span></span></div></li>)}</ul>)}
      <Err error={s.error} />
      {edit && (adding ? (
        <div className="card stack">
          <div className="grid2">
            <Field label={t("Amount paid", "भुगतान रकम")}><NumIn value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} suffix="₹" autoFocus /></Field>
            <Field label={t("Paid on", "भुगतान तारीख")}><DateIn value={pay.date} onChange={(v) => setPay({ ...pay, date: v })} /></Field>
            <Field label={t("Mode", "माध्यम")}><Select value={pay.mode} onChange={(v) => setPay({ ...pay, mode: v })} options={MODES.map((m) => ({ value: m, label: m.toUpperCase() }))} /></Field>
            <Field label={t("Bank reference / UTR", "बैंक रेफरेंस / UTR")}><TextIn value={pay.ref} onValue={(v) => setPay({ ...pay, ref: v })} /></Field>
          </div>
          <div className="actions">
            <Btn kind="primary" disabled={s.busy} onClick={() => s.run(async () => {
              if (!isNum(pay.amount) || Number(pay.amount) <= 0) throw new Error(t("Enter the amount paid.", "भुगतान की रकम डालें।"));
              await q(sb.from("machine_payments").insert({ order_id: id, amount: Number(pay.amount), paid_on: pay.date, mode: pay.mode, bank_ref: pay.ref.trim() || null }));
            }, () => { setAdding(false); setPay({ amount: "", date: today(), mode: "neft", ref: "" }); done(); })}>{t("Save payment", "पेमेंट सेव करें")}</Btn>
            <Btn onClick={() => setAdding(false)}>{t("Cancel", "रद्द करें")}</Btn>
          </div>
        </div>)
        : <Btn kind="primary" onClick={() => setAdding(true)}>+ {t("Record payment", "पेमेंट दर्ज करें")}</Btn>)}
    </Sheet>
  );
}
