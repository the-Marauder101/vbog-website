// Debit notes (PRD 7.5) and material returns (PRD 7.6).
// The three DNs are calculated by the database (v_dn_calc). Approving freezes lines and amounts;
// Tally issues the DN number, which is typed back here.
import { useState } from "react";
import {
  approveDn, cancelDn, debitNotes, deleteReturn, DN_TYPES, saveReturn, setTallyNo,
  type DealFull, type DebitNote, type DnCalc, type DnLine, type DnType, type ReturnRow,
} from "./data";
import { day, inr, kg, num, rate, str, today } from "./format";
import type { Key } from "./i18n";
import { Check, DateIn, Err, KV, NumIn, Ok, Sel, TxtIn, useLoad, useSaver } from "./ui";
import DnWorking from "./DnWorking";

type T = (k: Key) => string;
type Inv = { id: string; invoice_no: string; invoice_date: string; gst_rate: number };

export default function DebitNotes({ t, deal }: { t: T; deal: DealFull }) {
  const d = useLoad(() => debitNotes(deal.id), [deal.id]);
  const [working, setWorking] = useState<{ dn: DebitNote; inv: Inv } | null>(null);
  if (d.error) return <Err msg={d.error} />;
  if (!d.data) return <p className="muted">{t("loading")}</p>;
  if (working) return <DnWorking t={t} deal={deal} dn={working.dn} inv={working.inv} onBack={() => setWorking(null)} />;

  const { calc, calcLines, notes, returns, invoices } = d.data;
  return (
    <>
      {invoices.length === 0 && <p className="muted">{t("noInvoiceYet")}</p>}
      {invoices.map((inv) => (
        <div key={inv.id}>
          {invoices.length > 1 && <h2>{t("invoiceNo")} {inv.invoice_no}</h2>}
          {DN_TYPES.map((type) => (
            <DnCard key={type} t={t} type={type} inv={inv}
              live={notes.find((n) => n.invoice_id === inv.id && n.dn_type === type && n.status !== "cancelled")}
              cancelled={notes.filter((n) => n.invoice_id === inv.id && n.dn_type === type && n.status === "cancelled")}
              calc={calc.find((c) => c.invoice_id === inv.id && c.dn_type === type)}
              lines={calcLines.filter((l) => l.invoice_id === inv.id && l.dn_type === type)}
              onChanged={d.reload} onWorking={(dn) => setWorking({ dn, inv })} />
          ))}
        </div>
      ))}
      <Returns t={t} deal={deal} rows={returns} onChanged={d.reload} />
    </>
  );
}

function Lines({ t, lines }: { t: T; lines: DnLine[] }) {
  return (
    <table className="lines">
      <thead><tr><th>{t("item")} · {t("qty")} × {t("rateCol")}</th><th>{t("amount")}</th></tr></thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>{l.grade} · {l.description}<div className="muted small num-left">{kg(l.qty_kg)} × {rate(l.rate)}</div></td>
            <td className="num">{inr(l.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DnCard({ t, type, inv, live, cancelled, calc, lines, onChanged, onWorking }: {
  t: T; type: DnType; inv: Inv; live?: DebitNote; cancelled: DebitNote[]; calc?: DnCalc; lines: DnLine[];
  onChanged: () => void; onWorking: (dn: DebitNote) => void;
}) {
  const [round, setRound] = useState(type !== "rate_diff");   // as issued: 114 and 116 rounded, 115 not (PRD 6, open Q4)
  const [confirming, setConfirming] = useState(false);
  const [tallyNo, setTallyNoText] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [why, setWhy] = useState("");
  const s = useSaver();

  return (
    <section className={`card block dn ${live ? "dn-live" : ""}`}>
      <div className="block-head">
        <h2>{t(`dn_${type}` as Key)}</h2>
        {live && <span className={`chip ${live.status === "booked_in_tally" ? "approved" : "uploaded"}`}>{t(`dns_${live.status}` as Key)}</span>}
      </div>

      {live ? (
        <>
          <Lines t={t} lines={live.debit_note_lines} />
          <KV k={t("taxable")} v={inr(live.taxable)} />
          <KV k={`${t("gstAmount")} (${Number(inv.gst_rate)}%)`} v={inr(live.gst_amount)} />
          {Number(live.round_off) !== 0 && <KV k={t("roundOff")} v={inr(live.round_off)} />}
          <KV k={t("dnTotal")} v={inr(live.total)} strong />
          <p className="muted small">{t("approvedOn")} {day(live.approved_at)} · {t("frozenLines")}</p>
          {live.tally_dn_no
            ? <KV k={t("tallyDnNo")} v={live.tally_dn_no} tone="ok" />
            : (
              <div className="inline-form">
                <TxtIn label={t("tallyDnNo")} value={tallyNo} onChange={setTallyNoText} hint={t("tallyDnHint")} upper />
                <button className="btn primary" disabled={s.busy || !tallyNo.trim()}
                  onClick={async () => { if (await s.run(() => setTallyNo(live.id, tallyNo), t("saved"))) onChanged(); }}>{t("save")}</button>
              </div>
            )}
          <div className="actions">
            <button className="btn" onClick={() => onWorking(live)}>{t("dnWorking")}</button>
            {!cancelling && <button className="btn danger" onClick={() => setCancelling(true)}>{t("cancelDn")}</button>}
          </div>
          {cancelling && (
            <div className="confirm">
              {live.status === "booked_in_tally" && <p><strong>{t("cancelInTallyToo")}</strong></p>}
              <TxtIn label={t("cancelWhy")} value={why} onChange={setWhy} />
              <div className="actions">
                <button className="btn danger" disabled={s.busy || !why.trim()}
                  onClick={async () => { if (await s.run(() => cancelDn(live.id, why.trim()))) { setCancelling(false); setWhy(""); onChanged(); } }}>
                  {t("confirmCancelDn")}
                </button>
                <button className="btn" onClick={() => { setCancelling(false); setWhy(""); }}>{t("back")}</button>
              </div>
            </div>
          )}
        </>
      ) : calc ? (
        <>
          <p className="muted small">{t("calculatedNotApproved")}</p>
          <Lines t={t} lines={lines} />
          <KV k={t("taxable")} v={inr(calc.taxable)} />
          <KV k={`${t("gstAmount")} (${Number(inv.gst_rate)}%)`} v={inr(calc.gst_amount)} />
          <KV k={t("dnTotal")} v={inr(round ? calc.total_rounded : calc.total_exact)} strong />
          <Check label={t("roundRupee")} checked={round} onChange={setRound} />
          {confirming ? (
            <div className="confirm ok">
              <p>{t("approveConfirm")} <strong>{inr(round ? calc.total_rounded : calc.total_exact)}</strong>?</p>
              <div className="actions">
                <button className="btn primary" disabled={s.busy}
                  onClick={async () => { if (await s.run(() => approveDn(inv.id, type, round), t("dnApproved"))) { setConfirming(false); onChanged(); } }}>
                  {s.busy ? t("saving") : t("approveDn")}
                </button>
                <button className="btn" onClick={() => setConfirming(false)}>{t("cancel")}</button>
              </div>
            </div>
          ) : <div className="actions"><button className="btn primary" onClick={() => setConfirming(true)}>{t("approveDn")}</button></div>}
        </>
      ) : <p className="muted">{t("nothingToDebit")}</p>}

      {cancelled.map((c) => (
        <p key={c.id} className="muted small cancelled-dn">{t("cancelledDn")}: {inr(c.total)}{c.tally_dn_no ? ` · ${c.tally_dn_no}` : ""} · {c.cancel_reason}</p>
      ))}
      <Err msg={s.error} /><Ok msg={s.done} />
    </section>
  );
}

// ---------- material returns ----------
function Returns({ t, deal, rows, onChanged }: { t: T; deal: DealFull; rows: ReturnRow[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <section className="card block">
      <div className="block-head"><h2>{t("returnsTitle")}</h2></div>
      {rows.length === 0 && editing !== "new" && <p className="muted small">{t("noReturns")}</p>}
      {rows.map((r) => editing === r.id
        ? <ReturnForm key={r.id} t={t} deal={deal} row={r} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />
        : (
          <div key={r.id} className="ret">
            <KV k={t("dispatchedOn")} v={day(r.dispatched_on)} />
            <KV k={t("returnKg")} v={`${kg(r.kg)}${r.packages ? ` · ${r.packages} ${t("packagesShort")}` : ""}`} />
            <KV k={t("ewayBill")} v={r.eway_bill_no ?? "—"} />
            <KV k={t("transporterLr")} v={[r.transporter, r.lr_no].filter(Boolean).join(" · ") || "—"} />
            <KV k={t("freight")} v={r.freight == null ? "—" : `${inr(r.freight)} · ${r.freight_paid_by ? t(`paidBy_${r.freight_paid_by}` as Key) : "—"}${r.freight_paid_by === "rich_alloys" ? ` · ${r.freight_recovered ? t("recovered") : t("notRecoveredShort")}` : ""}`}
                tone={r.freight_paid_by === "rich_alloys" && !r.freight_recovered ? "wait" : undefined} />
            <KV k={t("deliveredOn")} v={r.delivered_on ? day(r.delivered_on) : t("notYet")} tone={r.delivered_on ? "ok" : "bad"} strong />
            <div className="actions"><button className="btn" onClick={() => setEditing(r.id)}>{t("edit")}</button></div>
          </div>
        ))}
      {editing === "new"
        ? <ReturnForm t={t} deal={deal} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />
        : <button className="btn" onClick={() => setEditing("new")}>+ {t("addReturn")}</button>}
    </section>
  );
}

function ReturnForm({ t, deal, row, onDone, onCancel }: { t: T; deal: DealFull; row?: ReturnRow; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    dispatched_on: row?.dispatched_on ?? today(), kg: str(row?.kg), packages: str(row?.packages), eway_bill_no: row?.eway_bill_no ?? "",
    transporter: row?.transporter ?? "", lr_no: row?.lr_no ?? "", freight: str(row?.freight), freight_paid_by: row?.freight_paid_by ?? "rich_alloys",
    freight_recovered: row?.freight_recovered ?? false, delivered_on: row?.delivered_on ?? "",
  });
  const [confirmDel, setConfirmDel] = useState(false);
  const s = useSaver();
  const set = (k: keyof typeof f) => (v: string | boolean) => setF({ ...f, [k]: v });
  return (
    <div className="card inset">
      <div className="grid2">
        <DateIn label={t("dispatchedOn")} value={f.dispatched_on} onChange={set("dispatched_on")} />
        <NumIn label={t("returnKg")} value={f.kg} onChange={set("kg")} suffix="kg" />
        <NumIn label={t("packages")} value={f.packages} onChange={set("packages")} />
        <TxtIn label={t("ewayBill")} value={f.eway_bill_no} onChange={set("eway_bill_no")} />
        <TxtIn label={t("transporter")} value={f.transporter} onChange={set("transporter")} />
        <TxtIn label={t("lrNo")} value={f.lr_no} onChange={set("lr_no")} />
        <NumIn label={t("freight")} value={f.freight} onChange={set("freight")} suffix="₹" />
        <Sel label={t("freightPaidBy")} value={f.freight_paid_by} onChange={set("freight_paid_by")}
             options={[["rich_alloys", t("paidBy_rich_alloys")], ["supplier", t("paidBy_supplier")]]} />
        <DateIn label={t("deliveredOn")} value={f.delivered_on} onChange={set("delivered_on")} />
      </div>
      {f.freight_paid_by === "rich_alloys" && <Check label={t("freightRecovered")} checked={f.freight_recovered} onChange={set("freight_recovered")} />}
      <div className="actions">
        <button className="btn primary" disabled={s.busy} onClick={async () => {
          const ok = await s.run(async () => {
            const k = num(f.kg), pk = num(f.packages), fr = num(f.freight);
            if (k === null || Number.isNaN(k) || k <= 0) throw new Error(`${t("checkNumbers")}: ${t("returnKg")}`);
            if (Number.isNaN(pk) || Number.isNaN(fr)) throw new Error(`${t("checkNumbers")}: ${t("packages")}, ${t("freight")}`);
            await saveReturn({
              id: row?.id, deal_id: deal.id, dispatched_on: f.dispatched_on || null, kg: k, packages: pk === null ? null : Math.round(pk),
              eway_bill_no: f.eway_bill_no.trim() || null, transporter: f.transporter.trim() || null, lr_no: f.lr_no.trim() || null,
              freight: fr, freight_paid_by: fr === null ? null : f.freight_paid_by as ReturnRow["freight_paid_by"],
              freight_recovered: f.freight_paid_by === "rich_alloys" && f.freight_recovered, delivered_on: f.delivered_on || null,
            });
          });
          if (ok) onDone();
        }}>{s.busy ? t("saving") : t("save")}</button>
        <button className="btn" onClick={onCancel}>{t("cancel")}</button>
        {row && !confirmDel && <button className="btn danger" onClick={() => setConfirmDel(true)}>{t("remove")}</button>}
      </div>
      {row && confirmDel && (
        <div className="confirm">
          <p>{t("confirmRemoveReturn")}</p>
          <div className="actions">
            <button className="btn danger" disabled={s.busy} onClick={async () => { if (await s.run(() => deleteReturn(row.id))) onDone(); }}>{t("remove")}</button>
            <button className="btn" onClick={() => setConfirmDel(false)}>{t("cancel")}</button>
          </div>
        </div>
      )}
      <Err msg={s.error} />
    </div>
  );
}
