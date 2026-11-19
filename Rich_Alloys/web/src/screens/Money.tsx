import { useState } from "react";
import { day, inr, isNum, q, rpc, sb, today, useCan, useLoad, useT, type Row } from "../lib";
import { Btn, Chip, Empty, Err, Field, KV, Loading, NumIn, Section, Sheet, SaveBar, Tabs, TextIn } from "../ui";
import { PaymentRow, PaymentSheet, TallyTick, useSave } from "../common";

export default function Money({ tab, openNew }: { tab?: string; openNew?: boolean }) {
  const t = useT();
  const cur = tab && tab !== "new" ? tab : "payments";
  const tabs = [{ id: "payments", label: t("Payments", "भुगतान") }, { id: "suppliers", label: t("Supplier ledgers", "सप्लायर लेजर") }, { id: "tax", label: t("GST and TDS", "GST और TDS") }];
  const setTab = (x: string) => { history.replaceState(null, "", `#/money/${x}`); window.dispatchEvent(new HashChangeEvent("hashchange")); };
  return (
    <>
      <h1>{t("Money", "पैसा")}</h1>
      <Tabs tabs={tabs} value={cur} onChange={setTab} />
      {cur === "payments" && <Payments openNew={openNew} />}
      {cur === "suppliers" && <Suppliers />}
      {cur === "tax" && <Tax />}
    </>
  );
}

function Payments({ openNew }: { openNew?: boolean }) {
  const t = useT(); const can = useCan();
  const [add, setAdd] = useState(!!openNew);
  const { data, error, reload } = useLoad(async () => {
    const pays = await q(sb.from("payments").select("*, suppliers(name), deals(deal_no)").order("paid_on", { ascending: false }).limit(200));
    const marks = pays.length ? await q(sb.from("tally_marks").select("*").in("entity_id", pays.map((p) => p.id))) : [];
    return { pays: pays.map((p) => ({ ...p, supplier: p.suppliers?.name }) as Row), marks };
  }, []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const waiting = data.pays.filter((p) => p.status === "entered");
  const back = data.pays.filter((p) => p.status === "rejected");
  const toTally = data.pays.filter((p) => p.status === "reconciled" && !data.marks.some((m) => m.entity_id === p.id && m.book === "office"));
  const done = data.pays.filter((p) => p.status === "reconciled" && !toTally.includes(p)).slice(0, 30);
  return (
    <>
      {can("payment_enter") && <Btn kind="primary" className="block" onClick={() => setAdd(true)}>+ {t("Record payment", "पेमेंट दर्ज करें")}</Btn>}
      <p className="muted small">{t("Anyone who pays a supplier records it here. Accounts checks it against the bank statement; only then does it count against the bill.", "जो भी सप्लायर को पैसा दे, यहाँ दर्ज करे। अकाउंट्स बैंक स्टेटमेंट से मिलाएगा; उसके बाद ही बिल से घटेगा।")}</p>
      <Section title={`${t("Waiting for reconciliation", "मिलान बाकी")} (${waiting.length})`}>
        {waiting.length ? waiting.map((p) => <PaymentRow key={p.id} p={p} marks={data.marks} onChange={reload} />) : <Empty>{t("None.", "कोई नहीं।")}</Empty>}
      </Section>
      {back.length > 0 && <Section title={`${t("Sent back for correction", "सुधार के लिए वापस")} (${back.length})`}>{back.map((p) => <PaymentRow key={p.id} p={p} marks={data.marks} onChange={reload} />)}</Section>}
      {toTally.length > 0 && <Section title={`${t("Reconciled, not yet in office Tally", "मिलान हुआ, ऑफिस टैली में बाकी")} (${toTally.length})`}>{toTally.map((p) => <PaymentRow key={p.id} p={p} marks={data.marks} onChange={reload} />)}</Section>}
      <Section title={t("Recently reconciled", "हाल में मिलान हुए")}>
        {done.length ? done.map((p) => <PaymentRow key={p.id} p={p} marks={data.marks} onChange={reload} />) : <Empty>{t("None.", "कोई नहीं।")}</Empty>}
      </Section>
      {add && <PaymentSheet onClose={() => setAdd(false)} onSaved={reload} />}
    </>
  );
}

function Suppliers() {
  const t = useT();
  const [open, setOpen] = useState<Row | null>(null);
  const { data, error, reload } = useLoad(() => q(sb.from("v_supplier_balance").select("*").order("balance", { ascending: false })), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  return (
    <>
      <ul className="rows">
        {data.filter((s) => Number(s.invoiced) || Number(s.paid) || Number(s.pending)).map((s) => (
          <li key={s.supplier_id}><button type="button" className="row" onClick={() => setOpen(s)}>
            <span className="row-main"><strong>{s.supplier}</strong>
              <span className="muted small">{s.last_confirmed_on ? `${t("Confirmed", "मिलाया")} ${day(s.last_confirmed_on)}` : t("Never confirmed", "कभी नहीं मिलाया")}
                {Number(s.pending) ? ` · ${inr(s.pending)} ${t("waiting for reconciliation", "मिलान बाकी")}` : ""}</span>
              {s.last_difference != null && Math.abs(Number(s.last_difference)) > 0.005 && <Chip tone="bad">{t("Difference", "अंतर")} {inr(s.last_difference)}</Chip>}
            </span>
            <span className="amt">{inr(s.balance)}</span>
          </button></li>))}
      </ul>
      {data.length === 0 && <Empty>{t("No suppliers yet.", "अभी कोई सप्लायर नहीं।")}</Empty>}
      {open && <LedgerSheet s={open} onClose={() => setOpen(null)} onSaved={reload} />}
    </>
  );
}

function LedgerSheet({ s, onClose, onSaved }: { s: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const can = useCan();
  const { data, error, reload } = useLoad(() => Promise.all([
    q(sb.from("v_ledger_lines").select("*").eq("supplier_id", s.supplier_id).order("entry_date")),
    q(sb.from("ledger_confirmations").select("*").eq("supplier_id", s.supplier_id).order("as_of", { ascending: false }).limit(5)),
  ]), [s.supplier_id]);
  const [asOf, setAsOf] = useState(today());
  const [bal, setBal] = useState("");
  const [result, setResult] = useState<number | null>(null);
  const sv = useSave();
  let run = 0;
  const kinds: Record<string, string> = { invoice: t("Invoice", "बिल"), debit_note: t("Debit note", "डेबिट नोट"), tds: "TDS", payment: t("Payment", "भुगतान") };
  return (
    <Sheet title={s.supplier} onClose={onClose}>
      <KV rows={[[t("Invoiced", "बिल"), inr(s.invoiced)], [t("Debit notes", "डेबिट नोट"), inr(s.notes)], ["TDS", inr(s.tds)], [t("Paid (reconciled)", "भुगतान (मिलान हुआ)"), inr(s.paid)], [t("Balance as per portal", "पोर्टल अनुसार बाकी"), <strong key="b">{inr(s.balance)}</strong>]]} />
      {can("ledger_confirm") && (
        <div className="card">
          <h3>{t("Check against the supplier's ledger", "सप्लायर के लेजर से मिलाएँ")}</h3>
          <div className="grid2">
            <Field label={t("As on", "तारीख तक")}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
            <Field label={t("Balance in their ledger", "उनके लेजर में बाकी")}><NumIn value={bal} onChange={setBal} suffix="₹" /></Field>
          </div>
          {result !== null && <p className={Math.abs(result) < 0.01 ? "okline" : "warn"}>{Math.abs(result) < 0.01 ? `✓ ${t("Matches", "मिलता है")}` : `${t("Difference", "अंतर")} ${inr(result)}`}</p>}
          <SaveBar busy={sv.busy} error={sv.error} label={t("Record check", "मिलान दर्ज करें")} onSave={() => sv.run(async () => {
            if (!isNum(bal)) throw new Error(t("Enter the balance from their ledger.", "उनके लेजर का बाकी डालें।"));
            setResult(await rpc<number>("confirm_ledger", { p_supplier: s.supplier_id, p_as_of: asOf, p_supplier_balance: Number(bal), p_note: null }));
          }, () => { reload(); onSaved(); })} />
        </div>
      )}
      {!data ? (error ? <Err error={error} /> : <Loading />) : (
        <>
          {data[1].length > 0 && <p className="muted small">{t("Last checks", "पिछले मिलान")}: {data[1].map((c) => `${day(c.as_of)} (${Math.abs(Number(c.difference)) < 0.01 ? "✓" : inr(c.difference)})`).join(", ")}</p>}
          <div className="tablewrap"><table className="tbl compact">
            <thead><tr><th>{t("Date", "तारीख")}</th><th>{t("Entry", "एंट्री")}</th><th className="n">{t("Bill", "बिल")}</th><th className="n">{t("Less", "घटा")}</th><th className="n">{t("Balance", "बाकी")}</th></tr></thead>
            <tbody>{data[0].map((l, i) => { if (l.status === "final") run += Number(l.credit) - Number(l.debit); return (
              <tr key={i} className={l.status === "pending" ? "pending" : ""}><td>{day(l.entry_date)}</td><td>{kinds[l.kind]} {l.ref}{l.status === "pending" ? ` (${t("not reconciled", "मिलान बाकी")})` : ""}</td>
                <td className="n">{Number(l.credit) ? inr(l.credit) : ""}</td><td className="n">{Number(l.debit) ? inr(l.debit) : ""}</td><td className="n">{inr(run)}</td></tr>); })}</tbody>
          </table></div>
        </>
      )}
    </Sheet>
  );
}

function Tax() {
  const t = useT(); const can = useCan();
  const { data, error, reload } = useLoad(async () => {
    const [tds, inv, gst] = await Promise.all([
      q(sb.from("tds").select("*, invoices(invoice_no, deals(deal_no, suppliers(name)))").order("deducted_on", { ascending: false }).limit(200)),
      q(sb.from("invoices").select("id, invoice_no, invoice_date, gst_amount, in_2b, gstr2b_period, deals(deal_no, suppliers(name))").eq("in_2b", false).order("invoice_date")),
      q(sb.from("v_gst_month").select("*").order("month", { ascending: false }).limit(12)),
    ]);
    const marks = tds.length ? await q(sb.from("tally_marks").select("*").in("entity_id", tds.map((x) => x.id))) : [];
    return { tds, inv, gst, marks };
  }, []);
  const [dep, setDep] = useState<Row | null>(null);
  const [b2, setB2] = useState<Row | null>(null);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const pending = data.tds.filter((x) => !x.deposited_on);
  return (
    <>
      <Section title={`${t("TDS deducted, not yet deposited", "TDS काटा, जमा बाकी")} (${pending.length})`}>
        {pending.length === 0 ? <Empty>{t("None.", "कोई नहीं।")}</Empty> : pending.map((x) => (
          <div className="item" key={x.id}>
            <div className="item-head"><strong>{inr(x.amount)} · {x.section}</strong><span className="muted small">{day(x.deducted_on)}</span></div>
            <p className="muted small">{x.invoices?.deals?.suppliers?.name} · {x.invoices?.invoice_no}</p>
            <div className="actions">{can("tax_edit") && <Btn small onClick={() => setDep(x)}>{t("Mark deposited", "जमा हुआ")}</Btn>}
              <TallyTick entity="tds" id={x.id} book="office" marks={data.marks} onDone={reload} /></div>
          </div>))}
      </Section>
      <Section title={`${t("Purchase invoices not yet seen in GSTR-2B", "GSTR-2B में नहीं दिखे बिल")} (${data.inv.length})`}>
        {data.inv.length === 0 ? <Empty>{t("None.", "कोई नहीं।")}</Empty> : (
          <ul className="rows">{data.inv.map((i) => (
            <li key={i.id}><div className="row static"><span className="row-main"><strong>{i.deals?.suppliers?.name}</strong>
              <span className="muted small">{i.invoice_no} · {day(i.invoice_date)} · GST {inr(i.gst_amount)}</span></span>
              {can("tax_edit") && <Btn small onClick={() => setB2(i)}>{t("Seen in 2B", "2B में दिखा")}</Btn>}</div></li>))}
          </ul>)}
      </Section>
      <Section title={t("Input GST by month", "महीनेवार इनपुट GST")}>
        <table className="tbl compact">
          <thead><tr><th>{t("Month", "महीना")}</th><th className="n">{t("On invoices", "बिलों पर")}</th><th className="n">{t("On debit notes", "डेबिट नोट पर")}</th><th className="n">{t("Net", "नेट")}</th><th className="n">{t("Not in 2B", "2B में नहीं")}</th></tr></thead>
          <tbody>{data.gst.map((g) => <tr key={g.month}><td>{g.month}</td><td className="n">{inr(g.invoice_gst)}</td><td className="n">{inr(g.dn_gst)}</td><td className="n">{inr(g.net_input_gst)}</td><td className="n">{g.invoices_not_in_2b}</td></tr>)}</tbody>
        </table>
      </Section>
      {dep && <DepositSheet tds={dep} onClose={() => setDep(null)} onSaved={reload} />}
      {b2 && <TwoBSheet inv={b2} onClose={() => setB2(null)} onSaved={reload} />}
    </>
  );
}

function DepositSheet({ tds, onClose, onSaved }: { tds: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [d, setD] = useState(today()); const [ch, setCh] = useState("");
  const s = useSave();
  return (
    <Sheet title={`${t("TDS deposited", "TDS जमा हुआ")} · ${inr(tds.amount)}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(() => q(sb.from("tds").update({ deposited_on: d, challan_ref: ch || null }).eq("id", tds.id)), () => { onSaved(); onClose(); })} />}>
      <Field label={t("Deposited on", "जमा तारीख")}><input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
      <Field label={t("Challan reference", "चालान रेफरेंस")}><TextIn value={ch} onValue={setCh} /></Field>
    </Sheet>
  );
}

function TwoBSheet({ inv, onClose, onSaved }: { inv: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [p, setP] = useState(today().slice(0, 7));
  const s = useSave();
  return (
    <Sheet title={`GSTR-2B · ${inv.invoice_no}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(() => rpc("set_invoice_2b", { p_id: inv.id, p_in: true, p_period: p }), () => { onSaved(); onClose(); })} />}>
      <Field label={t("2B period", "2B महीना")}><input type="month" value={p} onChange={(e) => setP(e.target.value)} /></Field>
    </Sheet>
  );
}
