// New deal (PRD 7.2): supplier, grades, quantity, rate. Under one minute.
// Deal number format is open question 3; the screen suggests the next RA-### and lets it be changed.
import { useState } from "react";
import { addSupplier, createDeal, dealNumbers, masters } from "./data";
import { num, today } from "./format";
import type { Key, Lang } from "./i18n";
import { DateIn, Err, NumIn, Sel, TxtIn, useLoad, useSaver } from "./ui";

type T = (k: Key) => string;
type Line = { grade: string; qty: string; rate: string };

function nextNo(existing: string[]): string {
  const nums = existing.map((n) => /^RA-(\d+)$/.exec(n)?.[1]).filter(Boolean).map(Number);
  return `RA-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
}

export default function NewDeal({ t, lang, userId, onCreated, onCancel }: {
  t: T; lang: Lang; userId: string; onCreated: (dealId: string) => void; onCancel: () => void;
}) {
  const m = useLoad(async () => ({ ...(await masters()), nos: await dealNumbers() }), []);
  const [supplier, setSupplier] = useState("");
  const [newSup, setNewSup] = useState({ name: "", gstin: "", state: "" });
  const [dealNo, setDealNo] = useState<string | null>(null);
  const [dealDate, setDealDate] = useState(today());
  const [po, setPo] = useState({ no: "", date: "" });
  const [lines, setLines] = useState<Line[]>([{ grade: "", qty: "", rate: "" }]);
  const [notes, setNotes] = useState("");
  const s = useSaver();

  if (m.error) return <Err msg={m.error} />;
  if (!m.data) return <p className="muted">{t("loading")}</p>;
  const { suppliers, grades, nos } = m.data;
  const no = dealNo ?? nextNo(nos);
  const sup = supplier || (suppliers[0]?.id ?? "__new");
  const gname = (code: string) => { const g = grades.find((x) => x.code === code); return g ? (lang === "hi" && g.name_hi ? g.name_hi : g.name) : code; };
  const setLine = (i: number, k: keyof Line) => (v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function submit() {
    const ok = await s.run(async () => {
      if (!no.trim()) throw new Error(t("needDealNo"));
      const parsed = lines.filter((l) => l.qty || l.rate || l.grade).map((l) => {
        const q = num(l.qty), r = num(l.rate);
        const grade = l.grade || grades[0]?.code;
        if (!grade || q === null || r === null || Number.isNaN(q) || Number.isNaN(r) || q <= 0 || r <= 0)
          throw new Error(`${t("checkNumbers")}: ${t("qtyKg")}, ${t("ratePerKg")}`);
        return { grade, qty_kg: q, rate_per_kg: r };
      });
      if (!parsed.length) throw new Error(t("needOneGrade"));
      if (new Set(parsed.map((p) => p.grade)).size !== parsed.length) throw new Error(t("gradeTwice"));
      let supplierId = sup;
      if (sup === "__new") {
        if (!newSup.name.trim()) throw new Error(t("needSupplierName"));
        supplierId = await addSupplier({ name: newSup.name.trim(), gstin: newSup.gstin.trim() || null, state: newSup.state.trim() || null,
          kyc_status: "pending", provisional_pct: null, credit_days: null });
      }
      const id = await createDeal({ deal_no: no.trim(), supplier_id: supplierId, deal_date: dealDate, po_no: po.no.trim() || null,
        po_date: po.date || null, notes: notes.trim() || null }, parsed, userId);
      onCreated(id);
    });
    if (!ok) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const blocked = suppliers.find((x) => x.id === sup)?.kyc_status === "blocked";
  return (
    <>
      <button className="link back" onClick={onCancel}>← {t("back")}</button>
      <h1>{t("newDeal")}</h1>
      <Err msg={s.error} />
      <section className="card block">
        <Sel label={t("supplierLabel")} value={sup} onChange={setSupplier}
             options={[...suppliers.map((x): [string, string] => [x.id, `${x.name}${x.kyc_status !== "verified" ? ` (${t(`kyc_${x.kyc_status}` as Key)})` : ""}`]), ["__new", `+ ${t("newSupplier")}`]]} />
        {blocked && <p className="warn">{t("supplierBlocked")}</p>}
        {sup === "__new" && (
          <div className="grid2">
            <TxtIn label={t("supplierName")} value={newSup.name} onChange={(v) => setNewSup({ ...newSup, name: v })} />
            <TxtIn label="GSTIN" value={newSup.gstin} onChange={(v) => setNewSup({ ...newSup, gstin: v })} upper />
            <TxtIn label={t("state")} value={newSup.state} onChange={(v) => setNewSup({ ...newSup, state: v })} />
            <p className="muted small hint span2">{t("kycPendingNote")}</p>
          </div>
        )}
        <div className="grid2">
          <TxtIn label={t("dealNo")} value={no} onChange={setDealNo} upper hint={t("dealNoHint")} />
          <DateIn label={t("dealDate")} value={dealDate} onChange={setDealDate} />
          <TxtIn label={t("poNo")} value={po.no} onChange={(v) => setPo({ ...po, no: v })} upper />
          <DateIn label={t("poDate")} value={po.date} onChange={(v) => setPo({ ...po, date: v })} />
        </div>
      </section>
      <section className="card block">
        <h2>{t("gradesAgreed")}</h2>
        {lines.map((l, i) => (
          <div key={i} className="grid3 deal-line">
            <Sel label={t("grade")} value={l.grade || grades[0]?.code || ""} onChange={setLine(i, "grade")} options={grades.map((g) => [g.code, gname(g.code)])} />
            <NumIn label={t("qtyKg")} value={l.qty} onChange={setLine(i, "qty")} suffix="kg" />
            <NumIn label={t("ratePerKg")} value={l.rate} onChange={setLine(i, "rate")} suffix="₹/kg" hint={t("plusGst")} />
            {lines.length > 1 && <button className="link danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>{t("remove")}</button>}
          </div>
        ))}
        <button className="btn" onClick={() => setLines([...lines, { grade: grades.find((g) => !lines.some((l) => l.grade === g.code))?.code ?? "", qty: "", rate: "" }])}>
          + {t("addGrade")}
        </button>
        <TxtIn label={t("notes")} value={notes} onChange={setNotes} />
      </section>
      <div className="actions">
        <button className="btn primary wide" disabled={s.busy} onClick={submit}>{s.busy ? t("saving") : t("createDeal")}</button>
      </div>
    </>
  );
}
