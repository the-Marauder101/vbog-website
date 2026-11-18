// Payment tab (PRD 7.7): per bill, invoice − debit notes − deductions (TDS) − payments = balance (v_payable).
// TDS is entered, never assumed.
import { useState } from "react";
import {
  deleteDeduction, deletePayment, payment, saveDeduction, savePayment, setDeductionOnPortal, setPaymentInTally,
  type DealFull, type Payable, type Payment,
} from "./data";
import { day, inr, num, today } from "./format";
import type { Key } from "./i18n";
import { Check, DateIn, Err, KV, NumIn, Ok, Sel, TxtIn, useLoad, useSaver } from "./ui";

type T = (k: Key) => string;

export function BillSummary({ t, b }: { t: T; b: Payable }) {
  return (
    <>
      <KV k={t("invoiceTotal")} v={inr(b.invoice_total)} />
      <KV k={`− ${t("debitNotes")}`} v={inr(b.debit_notes)} />
      <KV k={`− ${t("deductions")}`} v={inr(b.deductions)} />
      <KV k={`− ${t("paid")}`} v={inr(b.paid)} />
      <KV k={t("balance")} v={inr(b.balance)} tone={Number(b.balance) < 0 ? "bad" : Number(b.balance) > 0 ? "wait" : "ok"} strong />
      <KV k={t("dueDate")} v={b.due_date ? day(b.due_date) : t("notSet")}
          tone={b.days_overdue > 0 ? "bad" : b.due_date ? undefined : "wait"} />
      {b.days_overdue > 0 && <p className="warn">{t("overdueBy")} {b.days_overdue} {t("days")}</p>}
      {Number(b.balance) < 0 && <p className="warn">{t("overpaidWarn")}</p>}
    </>
  );
}

export default function PaymentTab({ t, deal }: { t: T; deal: DealFull }) {
  const d = useLoad(() => payment(deal.id), [deal.id]);
  const s = useSaver();
  if (d.error) return <Err msg={d.error} />;
  if (!d.data) return <p className="muted">{t("loading")}</p>;
  const { bills, payments, deductions } = d.data;
  if (bills.length === 0) return <p className="muted">{t("noInvoiceYet")}</p>;

  return (
    <>
      {bills.map((b) => (
        <section key={b.invoice_id} className="card block">
          <div className="block-head"><h2>{t("bill")} {b.invoice_no}</h2><span className="muted small">{day(b.invoice_date)}</span></div>
          <BillSummary t={t} b={b} />
        </section>
      ))}

      <section className="card block">
        <h2>{t("payments")}</h2>
        {payments.length === 0 && <p className="muted small">{t("noPayments")}</p>}
        {payments.map((p) => (
          <div key={p.id} className="money-row">
            <div>
              <strong>{inr(p.amount)}</strong> <span className="chip role">{t(`pay_${p.kind}` as Key)}</span>
              <div className="muted small">{day(p.paid_on)}{p.bank_ref ? ` · ${p.bank_ref}` : ""}</div>
            </div>
            <div className="row-actions">
              <Check label={t("inTally")} checked={p.in_tally} disabled={s.busy}
                     onChange={(v) => s.run(() => setPaymentInTally(p.id, v)).then(d.reload)} />
              <Remove t={t} onYes={() => s.run(() => deletePayment(p.id)).then(d.reload)} />
            </div>
          </div>
        ))}
        <AddPayment t={t} deal={deal} bills={bills} onSaved={d.reload} />
      </section>

      <section className="card block">
        <h2>{t("deductions")}</h2>
        <p className="muted small">{t("tdsHint")}</p>
        {deductions.length === 0 && <p className="muted small">{t("noDeductions")}</p>}
        {deductions.map((x) => (
          <div key={x.id} className="money-row">
            <div>
              <strong>{inr(x.amount)}</strong> <span className="chip role">{x.kind.toUpperCase()}{x.section ? ` ${x.section}` : ""}</span>
            </div>
            <div className="row-actions">
              <Check label={t("onPortal")} checked={x.on_portal} disabled={s.busy}
                     onChange={(v) => s.run(() => setDeductionOnPortal(x.id, v)).then(d.reload)} />
              <Remove t={t} onYes={() => s.run(() => deleteDeduction(x.id)).then(d.reload)} />
            </div>
          </div>
        ))}
        <AddDeduction t={t} bills={bills} onSaved={d.reload} />
      </section>
      <Err msg={s.error} />
    </>
  );
}

function Remove({ t, onYes }: { t: T; onYes: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask
    ? <span className="inline-confirm"><button className="link danger" onClick={() => { setAsk(false); onYes(); }}>{t("yesRemove")}</button>
        <button className="link" onClick={() => setAsk(false)}>{t("cancel")}</button></span>
    : <button className="link danger" onClick={() => setAsk(true)}>{t("remove")}</button>;
}

function AddPayment({ t, deal, bills, onSaved }: { t: T; deal: DealFull; bills: Payable[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ invoice_id: bills[0]?.invoice_id ?? "", kind: "provisional", amount: "", paid_on: today(), bank_ref: "", in_tally: false });
  const s = useSaver();
  const set = (k: keyof typeof f) => (v: string | boolean) => setF({ ...f, [k]: v });
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>+ {t("addPayment")}</button>;
  return (
    <div className="card inset">
      <div className="grid2">
        {bills.length > 1 && <Sel label={t("bill")} value={f.invoice_id} onChange={set("invoice_id")} options={bills.map((b) => [b.invoice_id, b.invoice_no])} />}
        <Sel label={t("payKind")} value={f.kind} onChange={set("kind")}
             options={[["advance", t("pay_advance")], ["provisional", t("pay_provisional")], ["final", t("pay_final")]]} />
        <NumIn label={t("amount")} value={f.amount} onChange={set("amount")} suffix="₹" />
        <DateIn label={t("paidOn")} value={f.paid_on} onChange={set("paid_on")} />
        <TxtIn label={t("bankRef")} value={f.bank_ref} onChange={set("bank_ref")} upper />
      </div>
      <Check label={t("inTally")} checked={f.in_tally} onChange={set("in_tally")} />
      <div className="actions">
        <button className="btn primary" disabled={s.busy} onClick={async () => {
          const ok = await s.run(async () => {
            const a = num(f.amount);
            if (a === null || Number.isNaN(a) || a <= 0) throw new Error(`${t("checkNumbers")}: ${t("amount")}`);
            await savePayment({ deal_id: deal.id, invoice_id: f.invoice_id || null, kind: f.kind as Payment["kind"], amount: a,
              paid_on: f.paid_on || null, bank_ref: f.bank_ref.trim() || null, in_tally: f.in_tally });
          }, t("saved"));
          if (ok) { setOpen(false); setF({ ...f, amount: "", bank_ref: "" }); onSaved(); }
        }}>{s.busy ? t("saving") : t("save")}</button>
        <button className="btn" onClick={() => setOpen(false)}>{t("cancel")}</button>
      </div>
      <Err msg={s.error} /><Ok msg={s.done} />
    </div>
  );
}

function AddDeduction({ t, bills, onSaved }: { t: T; bills: Payable[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ invoice_id: bills[0]?.invoice_id ?? "", kind: "tds", section: "", amount: "", on_portal: false });
  const s = useSaver();
  const set = (k: keyof typeof f) => (v: string | boolean) => setF({ ...f, [k]: v });
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>+ {t("addDeduction")}</button>;
  return (
    <div className="card inset">
      <div className="grid2">
        {bills.length > 1 && <Sel label={t("bill")} value={f.invoice_id} onChange={set("invoice_id")} options={bills.map((b) => [b.invoice_id, b.invoice_no])} />}
        <Sel label={t("deductionKind")} value={f.kind} onChange={set("kind")} options={[["tds", "TDS"], ["other", t("other")]]} />
        <TxtIn label={t("section")} value={f.section} onChange={set("section")} hint={t("sectionHint")} upper />
        <NumIn label={t("amount")} value={f.amount} onChange={set("amount")} suffix="₹" />
      </div>
      <Check label={t("onPortal")} checked={f.on_portal} onChange={set("on_portal")} />
      <div className="actions">
        <button className="btn primary" disabled={s.busy} onClick={async () => {
          const ok = await s.run(async () => {
            const a = num(f.amount);
            if (a === null || Number.isNaN(a) || a <= 0) throw new Error(`${t("checkNumbers")}: ${t("amount")}`);
            await saveDeduction({ invoice_id: f.invoice_id, kind: f.kind, section: f.section.trim() || null, amount: a, on_portal: f.on_portal });
          }, t("saved"));
          if (ok) { setOpen(false); setF({ ...f, amount: "", section: "" }); onSaved(); }
        }}>{s.busy ? t("saving") : t("save")}</button>
        <button className="btn" onClick={() => setOpen(false)}>{t("cancel")}</button>
      </div>
      <Err msg={s.error} /><Ok msg={s.done} />
    </div>
  );
}
