import { useState } from "react";
import { day, isNum, kg, q, rpc, sb, today, useCan, useLang, useLoad, useT, nm, type Row } from "../lib";
import { Btn, Choice, Empty, Err, Field, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
import { TallyTick, useSave } from "../common";

const monthStart = (m: string) => `${m}-01`;
const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo, 0); return `${m}-${String(d.getDate()).padStart(2, "0")}`; };

export default function Stock({ openProduction }: { openProduction?: boolean }) {
  const t = useT(); const can = useCan(); const lang = useLang();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [prod, setProd] = useState(!!openProduction);
  const [move, setMove] = useState(false);
  const [check, setCheck] = useState<Row | null>(null);
  const [item, setItem] = useState<Row | null>(null);
  const from = monthStart(month); const to = monthEnd(month);
  const { data, error, reload } = useLoad(async () => {
    const [sum, items, runs] = await Promise.all([
      rpc<Row[]>("stock_summary", { p_from: from, p_to: to }),
      q(sb.from("items").select("*").eq("active", true).order("sort")),
      q(sb.from("production_runs").select("*, production_lines(*)").order("run_date", { ascending: false }).limit(15)),
    ]);
    const marks = runs.length ? await q(sb.from("tally_marks").select("*").in("entity_id", runs.map((r) => r.id))) : [];
    return { sum, items, runs, marks };
  }, [month]);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const iname = (code: string) => nm(lang, data.items.find((i) => i.code === code)) || code;
  return (
    <>
      <div className="page-head"><h1>{t("Stock", "स्टॉक")}</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("Month", "महीना")} /></div>
      <div className="quick">
        {can("production_edit") && <Btn kind="primary" onClick={() => setProd(true)}>+ {t("Production", "उत्पादन")}</Btn>}
        {can("stock_edit") && <Btn onClick={() => setMove(true)}>+ {t("Other stock entry", "अन्य स्टॉक एंट्री")}</Btn>}
      </div>
      <div className="tablewrap">
        <table className="tbl stock">
          <thead><tr><th>{t("Item", "आइटम")}</th><th className="n">{t("Opening", "शुरुआती")}</th><th className="n">{t("In", "आया")}</th><th className="n">{t("Out", "गया")}</th><th className="n">{t("Closing", "बचा")}</th><th className="n">{t("Tally", "टैली")}</th></tr></thead>
          <tbody>{data.sum.map((r) => {
            const inn = Number(r.inward) + Number(r.produced) + Math.max(Number(r.other), 0);
            const out = Number(r.notes_out) + Number(r.consumed) + Number(r.dispatched) + Math.max(-Number(r.other), 0);
            const diff = r.difference == null ? null : Number(r.difference);
            return (
              <tr key={r.item} onClick={() => setItem(r)} className="click">
                <td>{nm(lang, r)}</td><td className="n">{kg(r.opening)}</td><td className="n">{kg(inn)}</td><td className="n">{kg(out)}</td>
                <td className="n"><strong>{kg(r.closing)}</strong></td>
                <td className="n">{r.tally_closing == null
                  ? (can("stock_edit") ? <button type="button" className="link" onClick={(e) => { e.stopPropagation(); setCheck(r); }}>{t("Enter", "डालें")}</button> : "—")
                  : <span className={Math.abs(diff ?? 0) < 0.001 ? "okline" : "bad"}>{Math.abs(diff ?? 0) < 0.001 ? "✓" : `${t("off by", "अंतर")} ${kg(diff)}`}</span>}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <p className="muted small">{t("In = arrivals at billed weight + production + other. Out = weight-short and return debit notes + consumption + dispatch. Tally column compares the closing on", "आया = बिल वज़न पर माल + उत्पादन + अन्य। गया = वज़न कम और वापसी डेबिट नोट + खपत + डिस्पैच। टैली कॉलम इस तारीख की क्लोज़िंग मिलाता है:")} {day(to)}.</p>
      <Section title={t("Production entries", "उत्पादन एंट्री")}>
        {data.runs.length === 0 ? <Empty>{t("None yet.", "अभी कोई नहीं।")}</Empty> : data.runs.map((r) => (
          <div className="item" key={r.id}>
            <div className="item-head"><strong>{day(r.run_date)}</strong><TallyTick entity="production" id={r.id} book="factory" marks={data.marks} onDone={reload} /></div>
            <p className="small">{t("Used", "खपत")}: {r.production_lines.filter((l: Row) => l.direction === "consumed").map((l: Row) => `${iname(l.item)} ${kg(l.kg)}`).join(", ") || "—"}</p>
            <p className="small">{t("Made", "बना")}: {r.production_lines.filter((l: Row) => l.direction === "produced").map((l: Row) => `${iname(l.item)} ${kg(l.kg)}`).join(", ") || "—"}</p>
            {r.notes && <p className="muted small">{r.notes}</p>}
          </div>))}
      </Section>
      {prod && <ProductionSheet items={data.items} onClose={() => setProd(false)} onSaved={reload} />}
      {move && <MoveSheet items={data.items} onClose={() => setMove(false)} onSaved={reload} />}
      {check && <TallyCheckSheet row={check} asOf={to} onClose={() => setCheck(null)} onSaved={reload} />}
      {item && <MovesSheet row={item} from={from} to={to} onClose={() => setItem(null)} />}
    </>
  );
}

type PL = { item: string; kg: string };
function ProductionSheet({ items, onClose, onSaved }: { items: Row[]; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const lang = useLang();
  const opt = items.map((i) => ({ value: i.code, label: nm(lang, i) }));
  const [date, setDate] = useState(today());
  const [used, setUsed] = useState<PL[]>([{ item: items.find((i) => i.kind === "raw")?.code ?? "", kg: "" }]);
  const [made, setMade] = useState<PL[]>([{ item: items.find((i) => i.kind === "finished")?.code ?? "", kg: "" }]);
  const [notes, setNotes] = useState("");
  const s = useSave();
  const rows = (list: PL[], set: (x: PL[]) => void) => (
    <>
      {list.map((l, i) => (
        <div className="line two" key={i}>
          <Field label={t("Item", "आइटम")}><Select value={l.item} onChange={(v) => set(list.map((x, j) => (j === i ? { ...x, item: v } : x)))} placeholder="—" options={opt} /></Field>
          <Field label={t("Weight", "वज़न")}><NumIn value={l.kg} onChange={(v) => set(list.map((x, j) => (j === i ? { ...x, kg: v } : x)))} suffix="kg" /></Field>
          {list.length > 1 && <button type="button" className="x" aria-label={t("Remove", "हटाएँ")} onClick={() => set(list.filter((_, j) => j !== i))}>×</button>}
        </div>))}
      <Btn small onClick={() => set([...list, { item: "", kg: "" }])}>+ {t("Another item", "और आइटम")}</Btn>
    </>
  );
  const save = () => s.run(async () => {
    const lines = [...used.filter((l) => l.item && l.kg).map((l) => ({ item: l.item, direction: "consumed", kg: l.kg })),
                   ...made.filter((l) => l.item && l.kg).map((l) => ({ item: l.item, direction: "produced", kg: l.kg }))];
    if (lines.some((l) => !isNum(l.kg))) throw new Error(t("Check the weights.", "वज़न जाँचें।"));
    if (!lines.length) throw new Error(t("Add what was used and what was made.", "क्या लगा और क्या बना, डालें।"));
    await rpc("save_production", { p: { run_date: date, notes, lines } });
  }, () => { onSaved(); onClose(); });
  return (
    <Sheet title={t("Production", "उत्पादन")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save production", "उत्पादन सेव करें")} />}>
      <Field label={t("Date", "तारीख")}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <h3 className="sub">{t("Used (consumed)", "क्या लगा (खपत)")}</h3>{rows(used, setUsed)}
      <h3 className="sub">{t("Made (produced)", "क्या बना (उत्पादन)")}</h3>{rows(made, setMade)}
      <Field label={t("Note (optional)", "नोट (वैकल्पिक)")}><TextIn value={notes} onValue={setNotes} /></Field>
    </Sheet>
  );
}

function MoveSheet({ items, onClose, onSaved }: { items: Row[]; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const lang = useLang();
  const [kind, setKind] = useState("dispatch");
  const [item, setItem] = useState("");
  const [kgv, setKg] = useState("");
  const [dir, setDir] = useState("+");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const s = useSave();
  const save = () => s.run(async () => {
    if (!item || !isNum(kgv) || Number(kgv) <= 0) throw new Error(t("Choose the item and enter the weight.", "आइटम चुनें और वज़न डालें।"));
    if (kind === "adjustment" && !reason.trim()) throw new Error(t("Say why the stock is adjusted.", "स्टॉक क्यों बदला, लिखें।"));
    const signed = kind === "dispatch" ? -Number(kgv) : kind === "adjustment" && dir === "-" ? -Number(kgv) : Number(kgv);
    await q(sb.from("stock_moves").insert({ move_date: date, item, kind, kg: signed, reason: reason.trim() || null }));
  }, () => { onSaved(); onClose(); });
  return (
    <Sheet title={t("Other stock entry", "अन्य स्टॉक एंट्री")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save", "सेव करें")} />}>
      <Field label={t("What is it", "क्या है")}>
        <Choice value={kind} onChange={setKind} cols={2} options={[
          { value: "dispatch", label: t("Dispatched (sold)", "डिस्पैच (बिका)") }, { value: "opening", label: t("Opening stock", "शुरुआती स्टॉक") },
          { value: "purchase_other", label: t("Other inward", "अन्य आवक") }, { value: "adjustment", label: t("Correction", "सुधार") }]} />
      </Field>
      <div className="grid2">
        <Field label={t("Item", "आइटम")}><Select value={item} onChange={setItem} placeholder="—" options={items.map((i) => ({ value: i.code, label: nm(lang, i) }))} /></Field>
        <Field label={t("Weight", "वज़न")}><NumIn value={kgv} onChange={setKg} suffix="kg" /></Field>
        <Field label={t("Date", "तारीख")}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {kind === "adjustment" && <Field label={t("Direction", "दिशा")}><Choice value={dir} onChange={setDir} cols={2} options={[{ value: "+", label: t("Add to stock", "स्टॉक बढ़ाएँ") }, { value: "-", label: t("Take off stock", "स्टॉक घटाएँ") }]} /></Field>}
      <Field label={kind === "adjustment" ? t("Reason (required)", "कारण (ज़रूरी)") : t("Note (optional)", "नोट (वैकल्पिक)")}><TextIn value={reason} onValue={setReason} /></Field>
    </Sheet>
  );
}

function TallyCheckSheet({ row, asOf, onClose, onSaved }: { row: Row; asOf: string; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const lang = useLang();
  const [v, setV] = useState("");
  const s = useSave();
  return (
    <Sheet title={`${t("Closing in Tally", "टैली में क्लोज़िंग")} · ${nm(lang, row)}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(async () => {
        if (!isNum(v)) throw new Error(t("Enter the closing weight from Tally.", "टैली की क्लोज़िंग डालें।"));
        await q(sb.from("stock_tally_checks").upsert({ item: row.item, as_of: asOf, tally_closing_kg: Number(v) }, { onConflict: "item,as_of" }));
      }, () => { onSaved(); onClose(); })} />}>
      <p className="muted">{t("Closing stock on", "क्लोज़िंग स्टॉक")} {day(asOf)}. {t("Portal shows", "पोर्टल में")} {kg(row.closing)}.</p>
      <Field label={t("Closing as per factory Tally", "फैक्ट्री टैली अनुसार क्लोज़िंग")}><NumIn value={v} onChange={setV} suffix="kg" autoFocus /></Field>
    </Sheet>
  );
}

function MovesSheet({ row, from, to, onClose }: { row: Row; from: string; to: string; onClose: () => void }) {
  const t = useT(); const lang = useLang();
  const { data, error } = useLoad(() => q(sb.from("v_stock_moves").select("*").eq("item", row.item).gte("move_date", from).lte("move_date", to).order("move_date")), [row.item, from, to]);
  const kinds: Record<string, string> = { inward: t("Arrival", "आवक"), note: t("Debit note", "डेबिट नोट"), consumed: t("Consumed", "खपत"), produced: t("Produced", "उत्पादन"), opening: t("Opening", "शुरुआती"), purchase_other: t("Other inward", "अन्य आवक"), dispatch: t("Dispatch", "डिस्पैच"), adjustment: t("Correction", "सुधार") };
  let run = Number(row.opening);
  return (
    <Sheet title={nm(lang, row)} onClose={onClose}>
      {!data ? (error ? <Err error={error} /> : <Loading />) : (
        <table className="tbl compact">
          <thead><tr><th>{t("Date", "तारीख")}</th><th>{t("Entry", "एंट्री")}</th><th className="n">kg</th><th className="n">{t("Stock", "स्टॉक")}</th></tr></thead>
          <tbody>
            <tr><td colSpan={3}>{t("Opening", "शुरुआती")}</td><td className="n">{kg(row.opening)}</td></tr>
            {data.map((m, i) => { run += Number(m.kg); return <tr key={i}><td>{day(m.move_date)}</td><td>{kinds[m.kind] ?? m.kind} · {m.ref}</td><td className="n">{Number(m.kg).toFixed(3)}</td><td className="n">{kg(run)}</td></tr>; })}
          </tbody>
        </table>)}
    </Sheet>
  );
}
