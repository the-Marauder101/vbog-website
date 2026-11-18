// Weights and sorting (PRD 7.4): mirrors Sanjay's notebook page, one grade per card.
// Net and weight short are never typed. While a card is being edited the screen previews them;
// once saved, every figure shown comes from the database view v_inward.
import { useState } from "react";
import {
  deleteSortLine, masters, saveInvoice, saveInvoiceLine, saveReceipt, saveReceiptLine, saveSortLine, weights,
  type DealFull, type DealLine, type Inward, type Invoice, type InvoiceCheck, type Receipt, type SortCat, type SortException, type SortLine,
} from "./data";
import { addDays, day, inr, kg, num, rate, str, today } from "./format";
import type { Key, Lang } from "./i18n";
import { DateIn, Err, KV, NumIn, Ok, Sel, TxtIn, useLoad, useSaver } from "./ui";

type T = (k: Key) => string;
const nonZero = (n: number | string | null | undefined) => n !== null && n !== undefined && Math.abs(Number(n)) > 0.0005;

/** Parse required/optional numbers; collects the labels of anything that is not a number. */
function reader(t: T) {
  const bad: string[] = [];
  const need = (label: Key, s: string) => { const n = num(s); if (n === null || Number.isNaN(n)) { bad.push(t(label)); return 0; } return n; };
  const opt = (label: Key, s: string) => { const n = num(s); if (Number.isNaN(n)) { bad.push(t(label)); return null; } return n; };
  const check = () => { if (bad.length) throw new Error(`${t("checkNumbers")}: ${bad.join(", ")}`); };
  return { need, opt, check };
}

export default function Weights({ t, lang, deal }: { t: T; lang: Lang; deal: DealFull }) {
  const m = useLoad(masters, []);
  const w = useLoad(() => weights(deal.id, deal.deal_no), [deal.id, deal.deal_no]);
  if (m.error || w.error) return <Err msg={m.error || w.error} />;
  if (!m.data || !w.data) return <p className="muted">{t("loading")}</p>;

  const inv = w.data.invoices[0] ?? null;
  const rec = w.data.receipts[0] ?? null;
  const frozen = inv ? w.data.frozen.has(inv.id) : false;
  const gradeName = (code: string) => {
    const g = m.data!.grades.find((x) => x.code === code);
    return g ? (lang === "hi" && g.name_hi ? g.name_hi : g.name) : code;
  };

  return (
    <>
      {frozen && <p className="notice">{t("frozenNote")}</p>}
      <InvoiceCard t={t} deal={deal} inv={inv} check={w.data.checks.find((c) => c.invoice_id === inv?.id)} frozen={frozen} onSaved={w.reload} />
      <ReceiptCard t={t} deal={deal} rec={rec} inv={inv} onSaved={w.reload} />
      {deal.deal_lines.length === 0 && <p className="muted">{t("noGrades")}</p>}
      {deal.deal_lines.map((l) => (
        <GradeCard key={l.id} t={t} lang={lang} line={l} name={gradeName(l.grade)} inv={inv} rec={rec}
          v={w.data!.inward.find((x) => x.grade === l.grade)} cats={m.data!.cats} frozen={frozen} onSaved={w.reload} />
      ))}
      <Exceptions t={t} rows={w.data.exceptions} gradeName={gradeName} />
    </>
  );
}

// ---------- supplier invoice ----------
function InvoiceCard({ t, deal, inv, check, frozen, onSaved }: {
  t: T; deal: DealFull; inv: Invoice | null; check?: InvoiceCheck; frozen: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(!inv);
  const [f, setF] = useState(() => ({
    invoice_no: inv?.invoice_no ?? "", invoice_date: inv?.invoice_date ?? today(), gst_rate: str(inv?.gst_rate ?? 18),
    taxable_value: str(inv?.taxable_value), gst_amount: str(inv?.gst_amount), total: str(inv?.total), due_date: inv?.due_date ?? "",
  }));
  const s = useSaver();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const credit = deal.suppliers.credit_days;

  async function submit() {
    const ok = await s.run(async () => {
      const r = reader(t);
      if (!f.invoice_no.trim()) throw new Error(t("needInvoiceNo"));
      const row = {
        id: inv?.id, deal_id: deal.id, invoice_no: f.invoice_no.trim(), invoice_date: f.invoice_date,
        gst_rate: r.need("gstRate", f.gst_rate), taxable_value: r.need("taxable", f.taxable_value),
        gst_amount: r.need("gstAmount", f.gst_amount), total: r.need("invoiceTotal", f.total),
        due_date: f.due_date || (credit != null ? addDays(f.invoice_date, credit) : null),
      };
      r.check();
      await saveInvoice(row);
    }, t("saved"));
    if (ok) { setEditing(false); onSaved(); }
  }

  return (
    <section className="card block">
      <div className="block-head">
        <h2>{t("supplierInvoice")}</h2>
        {inv && !editing && !frozen && <button className="link" onClick={() => setEditing(true)}>{t("edit")}</button>}
      </div>
      {inv && !editing ? (
        <>
          <KV k={t("invoiceNo")} v={`${inv.invoice_no} · ${day(inv.invoice_date)}`} />
          <KV k={t("taxable")} v={inr(inv.taxable_value)} />
          <KV k={`${t("gstAmount")} (${Number(inv.gst_rate)}%)`} v={inr(inv.gst_amount)} />
          <KV k={t("invoiceTotal")} v={inr(inv.total)} strong />
          <KV k={t("dueDate")} v={inv.due_date ? day(inv.due_date) : t("notSet")} tone={inv.due_date ? undefined : "wait"} />
          {check && nonZero(check.taxable_gap) && <p className="warn">{t("taxableGap")}: {inr(check.lines_taxable)} ({inr(check.taxable_gap)})</p>}
          {check && nonZero(check.gst_gap) && <p className="warn">{t("gstGap")}: {inr(check.gst_gap)}</p>}
          {check && nonZero(check.total_gap) && <p className="warn">{t("totalGap")}: {inr(check.total_gap)}</p>}
        </>
      ) : (
        <div className="grid2">
          <TxtIn label={t("invoiceNo")} value={f.invoice_no} onChange={set("invoice_no")} upper />
          <DateIn label={t("invoiceDate")} value={f.invoice_date} onChange={set("invoice_date")} />
          <NumIn label={t("gstRate")} value={f.gst_rate} onChange={set("gst_rate")} suffix="%" disabled={frozen} />
          <NumIn label={t("taxable")} value={f.taxable_value} onChange={set("taxable_value")} suffix="₹" />
          <NumIn label={t("gstAmount")} value={f.gst_amount} onChange={set("gst_amount")} suffix="₹" />
          <NumIn label={t("invoiceTotal")} value={f.total} onChange={set("total")} suffix="₹" />
          <DateIn label={t("dueDate")} value={f.due_date} onChange={set("due_date")} />
          {!f.due_date && credit != null && <p className="muted small hint">{t("dueFromCredit")} ({credit})</p>}
          <div className="actions span2">
            <button className="btn primary" disabled={s.busy} onClick={submit}>{s.busy ? t("saving") : t("saveInvoice")}</button>
            {inv && <button className="btn" onClick={() => setEditing(false)}>{t("cancel")}</button>}
          </div>
        </div>
      )}
      <Err msg={s.error} /><Ok msg={s.done} />
    </section>
  );
}

// ---------- receipt at the factory ----------
function ReceiptCard({ t, deal, rec, inv, onSaved }: { t: T; deal: DealFull; rec: Receipt | null; inv: Invoice | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(!rec);
  const [on, setOn] = useState(rec?.received_on ?? today());
  const [veh, setVeh] = useState(rec?.vehicle_no ?? "");
  const s = useSaver();
  if (!inv) return <section className="card block"><h2>{t("receipt")}</h2><p className="muted">{t("invoiceFirst")}</p></section>;
  return (
    <section className="card block">
      <div className="block-head">
        <h2>{t("receipt")}</h2>
        {rec && !editing && <button className="link" onClick={() => setEditing(true)}>{t("edit")}</button>}
      </div>
      {rec && !editing ? (
        <KV k={t("receivedOn")} v={`${day(rec.received_on)}${rec.vehicle_no ? ` · ${rec.vehicle_no}` : ""}`} />
      ) : (
        <div className="grid2">
          <DateIn label={t("receivedOn")} value={on} onChange={setOn} />
          <TxtIn label={t("vehicleNo")} value={veh} onChange={setVeh} upper />
          <div className="actions span2">
            <button className="btn primary" disabled={s.busy} onClick={async () => {
              if (await s.run(() => saveReceipt({ id: rec?.id, deal_id: deal.id, invoice_id: inv.id, received_on: on, vehicle_no: veh.trim() || null }), t("saved"))) {
                setEditing(false); onSaved();
              }
            }}>{s.busy ? t("saving") : t("saveReceipt")}</button>
            {rec && <button className="btn" onClick={() => setEditing(false)}>{t("cancel")}</button>}
          </div>
        </div>
      )}
      <Err msg={s.error} /><Ok msg={s.done} />
    </section>
  );
}

// ---------- one grade: the notebook lines ----------
function GradeCard({ t, lang, line, name, inv, rec, v, cats, frozen, onSaved }: {
  t: T; lang: Lang; line: DealLine; name: string; inv: Invoice | null; rec: Receipt | null; v?: Inward;
  cats: SortCat[]; frozen: boolean; onSaved: () => void;
}) {
  const il = inv?.invoice_lines.find((x) => x.grade === line.grade);
  const rl = rec?.receipt_lines.find((x) => x.grade === line.grade);
  const initial = {
    slip_gross: str(il?.slip_gross_kg), slip_bags: str(il?.slip_bag_kg), billed_net: str(il?.billed_net_kg),
    billed_rate: str(il?.billed_rate ?? line.rate_per_kg), gross: str(rl?.factory_gross_kg), bag_count: str(rl?.bag_count), bags: str(rl?.factory_bag_kg),
  };
  const [f, setF] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const s = useSaver();
  const set = (k: keyof typeof f) => (val: string) => { setF({ ...f, [k]: val }); setDirty(true); };
  const ready = !!inv && !!rec;

  // Preview while typing (display only; the saved figures come from v_inward).
  const p = (a: string, b: string) => { const x = num(a), y = num(b); return x === null || y === null || Number.isNaN(x) || Number.isNaN(y) ? null : x - y; };
  const facNet = dirty || !v ? p(f.gross, f.bags || "0") : Number(v.factory_net_kg);
  const slipNet = dirty || !v ? p(f.slip_gross, f.slip_bags || "0") : v.slip_net_kg;
  const short = dirty || !v ? (facNet === null ? null : p(f.billed_net, String(facNet))) : Number(v.weight_short_kg);

  async function submit() {
    const ok = await s.run(async () => {
      const r = reader(t);
      const invLine = {
        invoice_id: inv!.id, grade: line.grade, billed_net_kg: r.need("billedNet", f.billed_net), billed_rate: r.need("billedRate", f.billed_rate),
        slip_gross_kg: r.opt("slipGross", f.slip_gross), slip_bag_kg: r.opt("slipBags", f.slip_bags),
      };
      const bc = r.opt("bagCount", f.bag_count);
      const recLine = {
        receipt_id: rec!.id, grade: line.grade, factory_gross_kg: r.need("factoryGross", f.gross),
        bag_count: bc === null ? null : Math.round(bc), factory_bag_kg: r.opt("factoryBags", f.bags) ?? 0,
      };
      r.check();
      await saveInvoiceLine(invLine);
      await saveReceiptLine(recLine);
      setDirty(false);
    }, t("saved"));
    if (ok) onSaved();
  }

  return (
    <section className="card block grade">
      <div className="block-head">
        <h2>{name}</h2>
        <span className="muted small">{t("agreed")}: {kg(line.qty_kg)} @ {rate(line.rate_per_kg)}</span>
      </div>
      {!ready && <p className="muted">{t("invoiceReceiptFirst")}</p>}
      {ready && (
        <>
          <h3>{t("supplierSide")}</h3>
          <div className="grid2">
            <NumIn label={t("slipGross")} value={f.slip_gross} onChange={set("slip_gross")} suffix="kg" disabled={frozen} />
            <NumIn label={t("slipBags")} value={f.slip_bags} onChange={set("slip_bags")} suffix="kg" disabled={frozen} />
            <NumIn label={t("billedNet")} value={f.billed_net} onChange={set("billed_net")} suffix="kg" disabled={frozen} />
            <NumIn label={t("billedRate")} value={f.billed_rate} onChange={set("billed_rate")} suffix="₹/kg" disabled={frozen} />
          </div>
          <KV k={t("slipNet")} v={kg(slipNet)} />
          <h3>{t("factorySide")}</h3>
          <div className="grid3">
            <NumIn label={t("factoryGross")} value={f.gross} onChange={set("gross")} suffix="kg" disabled={frozen} />
            <NumIn label={t("bagCount")} value={f.bag_count} onChange={set("bag_count")} disabled={frozen} />
            <NumIn label={t("factoryBags")} value={f.bags} onChange={set("bags")} suffix="kg" disabled={frozen} />
          </div>
          <KV k={t("factoryNet")} v={kg(facNet)} />
          <KV k={<strong>{t("weightShort")}{dirty && <span className="muted small"> · {t("preview")}</span>}</strong>}
              v={short === null ? "—" : kg(Math.max(short, 0))} tone={short !== null && short > 0 ? "bad" : "ok"} strong />
          {!dirty && v && nonZero(v.slip_vs_invoice_kg) && <p className="warn">{t("slipGap")}: {kg(v.slip_net_kg)} → {kg(v.billed_net_kg)} ({kg(v.slip_vs_invoice_kg)})</p>}
          {!dirty && v && nonZero(v.rate_vs_deal) && <p className="warn">{t("rateGap")}: {rate(v.billed_rate)} ≠ {rate(v.deal_rate)}</p>}
          {!frozen && (
            <div className="actions">
              <button className="btn primary" disabled={s.busy || !dirty} onClick={submit}>{s.busy ? t("saving") : t("saveWeights")}</button>
            </div>
          )}
          <Err msg={s.error} /><Ok msg={s.done} />
          {rl && <Sorting t={t} lang={lang} rl={rl} cats={cats} frozen={frozen} onSaved={onSaved} />}
        </>
      )}
    </section>
  );
}

// ---------- sorting lines for one grade ----------
function Sorting({ t, lang, rl, cats, frozen, onSaved }: {
  t: T; lang: Lang; rl: NonNullable<Receipt["receipt_lines"][number]>; cats: SortCat[]; frozen: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const s = useSaver();
  const catName = (code: string) => { const c = cats.find((x) => x.code === code); return c ? (lang === "hi" && c.name_hi ? c.name_hi : c.name) : code; };
  return (
    <div className="sorting">
      <h3>{t("sorting")}</h3>
      {rl.sorting_lines.length === 0 && editing !== "new" && <p className="muted small">{t("noSorting")}</p>}
      <ul className="plain">
        {rl.sorting_lines.map((sl) => editing === sl.id
          ? <li key={sl.id}><SortForm t={t} lang={lang} rlId={rl.id} cats={cats} line={sl} onDone={() => { setEditing(null); onSaved(); }} onCancel={() => setEditing(null)} /></li>
          : (
            <li key={sl.id} className="sline">
              <div>
                <strong>{catName(sl.category)}</strong> · {kg(sl.sorted_kg)}
                <div className="muted small">
                  {sl.action === "rate_diff" ? `${t("act_rate_diff")} ${rate(sl.rate_cut)}` : t("act_return")} · {t("debit")} {kg(sl.dn_kg)}
                </div>
                {Number(sl.dn_kg) !== Number(sl.sorted_kg) && <div className="warn small">{t("reason")}: {sl.change_reason}</div>}
              </div>
              {!frozen && (
                <div className="row-actions">
                  <button className="link" onClick={() => setEditing(sl.id)}>{t("edit")}</button>
                  <button className="link danger" disabled={s.busy}
                    onClick={async () => { if (await s.run(() => deleteSortLine(sl.id))) onSaved(); }}>{t("remove")}</button>
                </div>
              )}
            </li>
          ))}
      </ul>
      <Err msg={s.error} />
      {editing === "new"
        ? <SortForm t={t} lang={lang} rlId={rl.id} cats={cats} onDone={() => { setEditing(null); onSaved(); }} onCancel={() => setEditing(null)} />
        : !frozen && <button className="btn" onClick={() => setEditing("new")}>+ {t("addSorting")}</button>}
    </div>
  );
}

function SortForm({ t, lang, rlId, cats, line, onDone, onCancel }: {
  t: T; lang: Lang; rlId: string; cats: SortCat[]; line?: SortLine; onDone: () => void; onCancel: () => void;
}) {
  const first = cats[0];
  const [cat, setCat] = useState(line?.category ?? first?.code ?? "");
  const [action, setAction] = useState<"rate_diff" | "return">(line?.action ?? first?.default_action ?? "return");
  const [kgs, setKgs] = useState(str(line?.sorted_kg));
  const [cut, setCut] = useState(str(line?.rate_cut));
  const [dn, setDn] = useState(str(line?.dn_kg));
  const [dnTouched, setDnTouched] = useState(!!line && Number(line.dn_kg) !== Number(line.sorted_kg));
  const [why, setWhy] = useState(line?.change_reason ?? "");
  const s = useSaver();
  const dnShown = dnTouched ? dn : kgs;
  const differs = num(dnShown) !== null && num(kgs) !== null && num(dnShown) !== num(kgs);

  return (
    <div className="card inset">
      <div className="grid2">
        <Sel label={t("category")} value={cat} onChange={(c) => { setCat(c); const d = cats.find((x) => x.code === c); if (d) setAction(d.default_action); }}
             options={cats.map((c) => [c.code, lang === "hi" && c.name_hi ? c.name_hi : c.name])} />
        <NumIn label={t("sortedKg")} value={kgs} onChange={setKgs} suffix="kg" />
        <Sel label={t("action")} value={action} onChange={(a) => setAction(a as "rate_diff" | "return")}
             options={[["rate_diff", t("act_rate_diff")], ["return", t("act_return")]]} />
        {action === "rate_diff" && <NumIn label={t("rateCut")} value={cut} onChange={setCut} suffix="₹/kg" />}
        <NumIn label={t("dnKg")} value={dnShown} onChange={(v) => { setDn(v); setDnTouched(true); }} suffix="kg" hint={t("dnKgHint")} />
      </div>
      {differs && <TxtIn label={t("reasonRequired")} value={why} onChange={setWhy} />}
      <div className="actions">
        <button className="btn primary" disabled={s.busy} onClick={async () => {
          const ok = await s.run(async () => {
            const r = reader(t);
            const sorted = r.need("sortedKg", kgs);
            const debit = r.need("dnKg", dnShown);
            const rc = action === "rate_diff" ? r.need("rateCut", cut) : null;
            r.check();
            if (sorted <= 0) throw new Error(t("sortedPositive"));
            if (debit !== sorted && !why.trim()) throw new Error(t("reasonRequired"));
            await saveSortLine({ id: line?.id, receipt_line_id: rlId, category: cat, sorted_kg: sorted, action, rate_cut: rc,
              dn_kg: debit, change_reason: debit !== sorted ? why.trim() : null });
          });
          if (ok) onDone();
        }}>{s.busy ? t("saving") : t("save")}</button>
        <button className="btn" onClick={onCancel}>{t("cancel")}</button>
      </div>
      <Err msg={s.error} />
    </div>
  );
}

// ---------- sorted but not debited (PRD 6: the mitti finding) ----------
function Exceptions({ t, rows, gradeName }: { t: T; rows: SortException[]; gradeName: (c: string) => string }) {
  if (!rows.length) return null;
  return (
    <section className="card block exceptions">
      <h2>{t("exceptions")}</h2>
      <p className="muted small">{t("exceptionsHint")}</p>
      {rows.map((r, i) => (
        <div key={i} className="exc">
          <strong>{gradeName(r.grade)} · {r.category}</strong>
          <KV k={t("sortedKg")} v={kg(r.sorted_kg)} />
          <KV k={t("dnKg")} v={kg(r.dn_kg)} />
          <KV k={t("notRecovered")} v={`${kg(r.kg_not_debited)} · ${inr(r.value_not_recovered)}`} tone="bad" strong />
          <p className="small">{t("reason")}: {r.change_reason ?? "—"}</p>
        </div>
      ))}
    </section>
  );
}
