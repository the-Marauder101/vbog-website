import { useState } from "react";
import { day, isNum, kg, q, rpc, sb, today, useCan, useLang, useLoad, useT, nm, type Row } from "../lib";
import { Btn, Choice, DateIn, Empty, Err, Field, KV, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
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
  const [all, setAll] = useState(false);
  const from = monthStart(month); const to = monthEnd(month);
  const { data, error, reload } = useLoad(async () => {
    const [sum, items, runs] = await Promise.all([
      rpc<Row[]>("stock_summary", { p_from: from, p_to: to }),
      q(sb.from("items").select("*").eq("active", true).order("sort")),
      q(sb.from("production_runs").select("*, production_lines(*)").order("run_date", { ascending: false }).limit(15)),
    ]);
    const ids = runs.map((r) => r.id);
    const [marks, yields] = ids.length
      ? await Promise.all([q(sb.from("tally_marks").select("*").in("entity_id", ids)), q(sb.from("v_production_runs").select("*").in("id", ids))])
      : [[], []];
    return { sum, items, runs, marks, yields };
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
          <tbody>{data.sum.filter((r) => all || [r.opening, r.total_in, r.total_out, r.closing].some((v) => Number(v) !== 0) || r.tally_closing != null).map((r) => {
            const diff = r.difference == null ? null : Number(r.difference);
            return (
              <tr key={r.item} onClick={() => setItem(r)} className="click">
                <td>{nm(lang, r)}</td><td className="n">{kg(r.opening)}</td><td className="n">{kg(r.total_in)}</td><td className="n">{kg(r.total_out)}</td>
                <td className="n"><strong>{kg(r.closing)}</strong></td>
                <td className="n">{r.tally_closing == null
                  ? (can("stock_edit") ? <button type="button" className="link" onClick={(e) => { e.stopPropagation(); setCheck(r); }}>{t("Enter", "डालें")}</button> : "—")
                  : <span className={Math.abs(diff ?? 0) < 0.001 ? "okline" : "bad"}>{Math.abs(diff ?? 0) < 0.001 ? "✓" : `${t("off by", "अंतर")} ${kg(diff)}`}</span>}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      {!all && data.sum.some((r) => [r.opening, r.total_in, r.total_out, r.closing].every((v) => Number(v) === 0) && r.tally_closing == null) &&
        <button type="button" className="link small" onClick={() => setAll(true)}>{t("Show items with no stock", "बिना स्टॉक वाले आइटम दिखाएँ")}</button>}
      <p className="muted small">{t("In = purchases (arrivals at billed weight, other purchases, imports) + branch transfers + production + job work, credit notes and transfers. Out = consumption + weight-short and return debit notes + sales + branch transfers + job work and transfers. Tap an item for the breakdown. An opening entry starts an item's stock: earlier entries are inside it. Tally column compares the closing on", "आया = खरीद (बिल वज़न पर माल, अन्य खरीद, इम्पोर्ट) + ब्रांच ट्रांसफर + उत्पादन + जॉब वर्क, क्रेडिट नोट और ट्रांसफर। गया = खपत + वज़न कम और वापसी डेबिट नोट + बिक्री + ब्रांच ट्रांसफर + जॉब वर्क और ट्रांसफर। ब्रेकअप के लिए आइटम दबाएँ। शुरुआती स्टॉक एंट्री से आइटम का स्टॉक शुरू होता है। टैली कॉलम इस तारीख की क्लोज़िंग मिलाता है:")} {day(to)}.</p>
      <Section title={t("Production entries", "उत्पादन एंट्री")}>
        {data.runs.length === 0 ? <Empty>{t("None yet.", "अभी कोई नहीं।")}</Empty> : data.runs.map((r) => (
          <div className="item" key={r.id}>
            <div className="item-head"><strong>{day(r.run_date)}</strong><TallyTick entity="production" id={r.id} book="factory" marks={data.marks} onDone={reload} /></div>
            <p className="small">{t("Used", "खपत")}: {r.production_lines.filter((l: Row) => l.direction === "consumed").map((l: Row) => `${iname(l.item)} ${kg(l.kg)}`).join(", ") || "—"}</p>
            <p className="small">{t("Made", "बना")}: {r.production_lines.filter((l: Row) => l.direction === "produced").map((l: Row) => `${iname(l.item)} ${kg(l.kg)}`).join(", ") || "—"}</p>
            <YieldLine y={data.yields.find((y: Row) => y.id === r.id)} />
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
      <Field label={t("Date", "तारीख")}><DateIn value={date} onChange={setDate} /></Field>
      <p className="muted small">{t("Enter what was actually weighed. Dross and ash do not have to make the run balance; anything not accounted for shows as melting loss.", "जो सच में तौला, वही डालें। ड्रॉस और ऐश से हिसाब बराबर करना ज़रूरी नहीं; जो बचा वो पिघलाई में कमी दिखेगी।")}</p>
      <h3 className="sub">{t("Used (consumed)", "क्या लगा (खपत)")}</h3>{rows(used, setUsed)}
      <h3 className="sub">{t("Made (produced)", "क्या बना (उत्पादन)")}</h3>{rows(made, setMade)}
      <Field label={t("Note (optional)", "नोट (वैकल्पिक)")}><TextIn value={notes} onValue={setNotes} /></Field>
    </Sheet>
  );
}

// Stock movements beyond supplier lots (PRD 7a item 2). Quantity only: no prices, buyers or import process.
const MOVE_KINDS: { value: string; en: string; hi: string; dir: 1 | -1 | 0 }[] = [
  { value: "dispatch", en: "Sale / dispatch", hi: "बिक्री / डिस्पैच", dir: -1 },
  { value: "branch_in", en: "From Mumbai branch", hi: "मुंबई ब्रांच से आया", dir: 1 },
  { value: "branch_out", en: "To Mumbai branch", hi: "मुंबई ब्रांच भेजा", dir: -1 },
  { value: "purchase_other", en: "Other purchase", hi: "अन्य खरीद", dir: 1 },
  { value: "import_receipt", en: "Import receipt (bill of entry)", hi: "इम्पोर्ट (बिल ऑफ एंट्री)", dir: 1 },
  { value: "job_work_in", en: "Job work received", hi: "जॉब वर्क आया", dir: 1 },
  { value: "job_work_out", en: "Job work sent", hi: "जॉब वर्क भेजा", dir: -1 },
  { value: "credit_note", en: "Credit note received", hi: "क्रेडिट नोट आया", dir: 1 },
  { value: "transfer", en: "Item to item", hi: "आइटम से आइटम", dir: 0 },
  { value: "opening", en: "Opening stock", hi: "शुरुआती स्टॉक", dir: 1 },
  { value: "adjustment", en: "Correction", hi: "सुधार", dir: 0 },
];

function MoveSheet({ items, onClose, onSaved }: { items: Row[]; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const lang = useLang();
  const [kind, setKind] = useState("dispatch");
  const [item, setItem] = useState("");
  const [toItem, setToItem] = useState("");
  const [kgv, setKg] = useState("");
  const [dir, setDir] = useState("+");
  const [date, setDate] = useState(today());
  const [party, setParty] = useState("");
  const [doc, setDoc] = useState("");
  const [reason, setReason] = useState("");
  const s = useSave();
  const k = MOVE_KINDS.find((x) => x.value === kind)!;
  const opts = items.map((i) => ({ value: i.code, label: nm(lang, i) }));
  const save = () => s.run(async () => {
    if (!item || !isNum(kgv) || Number(kgv) <= 0) throw new Error(t("Choose the item and enter the weight.", "आइटम चुनें और वज़न डालें।"));
    if (kind === "adjustment" && !reason.trim()) throw new Error(t("Say why the stock is adjusted.", "स्टॉक क्यों बदला, लिखें।"));
    if (kind === "transfer") {
      if (!toItem || toItem === item) throw new Error(t("Choose the item it moved to.", "किस आइटम में गया, चुनें।"));
      await rpc("transfer_stock", { p: { move_date: date, from_item: item, to_item: toItem, kg: kgv, doc_no: doc, reason } });
      return;
    }
    const sign = k.dir !== 0 ? k.dir : dir === "-" ? -1 : 1;
    await q(sb.from("stock_moves").insert({ move_date: date, item, kind, kg: sign * Number(kgv),
      party: party.trim() || null, doc_no: doc.trim() || null, reason: reason.trim() || null }));
  }, () => { onSaved(); onClose(); });
  return (
    <Sheet title={t("Other stock entry", "अन्य स्टॉक एंट्री")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save", "सेव करें")} />}>
      <Field label={t("What is it", "क्या है")}>
        <Choice value={kind} onChange={setKind} cols={2} options={MOVE_KINDS.map((x) => ({ value: x.value, label: t(x.en, x.hi) }))} />
      </Field>
      <div className="grid2">
        <Field label={kind === "transfer" ? t("From item", "किस आइटम से") : t("Item", "आइटम")}><Select value={item} onChange={setItem} placeholder="—" options={opts} /></Field>
        {kind === "transfer" && <Field label={t("To item", "किस आइटम में")}><Select value={toItem} onChange={setToItem} placeholder="—" options={opts} /></Field>}
        <Field label={t("Weight", "वज़न")}><NumIn value={kgv} onChange={setKg} suffix="kg" /></Field>
        <Field label={t("Date", "तारीख")}><DateIn value={date} onChange={setDate} /></Field>
        {kind !== "transfer" && kind !== "opening" && kind !== "adjustment" &&
          <Field label={t("Party", "पार्टी")}><TextIn value={party} onValue={setParty} /></Field>}
        {kind !== "adjustment" && <Field label={t("Document number", "डॉक्यूमेंट नंबर")} hint={kind === "import_receipt" ? t("Bill of entry", "बिल ऑफ एंट्री") : kind.startsWith("branch") ? t("Delivery note", "डिलीवरी नोट") : undefined}>
          <TextIn value={doc} onValue={setDoc} /></Field>}
      </div>
      {kind === "adjustment" && <Field label={t("Direction", "दिशा")}><Choice value={dir} onChange={setDir} cols={2} options={[{ value: "+", label: t("Add to stock", "स्टॉक बढ़ाएँ") }, { value: "-", label: t("Take off stock", "स्टॉक घटाएँ") }]} /></Field>}
      {kind === "opening" && <p className="muted small">{t("An opening starts this item's stock on this date. Entries before it are treated as already inside it.", "शुरुआती स्टॉक इस तारीख से आइटम का स्टॉक शुरू करता है। इससे पहले की एंट्री इसमें शामिल मानी जाएँगी।")}</p>}
      <Field label={kind === "adjustment" ? t("Reason (required)", "कारण (ज़रूरी)") : t("Note (optional)", "नोट (वैकल्पिक)")}><TextIn value={reason} onValue={setReason} /></Field>
    </Sheet>
  );
}

function YieldLine({ y }: { y?: Row }) {
  const t = useT();
  if (!y || Number(y.consumed_kg) === 0) return null;
  const lost = Number(y.unaccounted_kg);
  return (
    <p className="small">
      <strong>{t("Yield", "यील्ड")}: {y.yield_pct == null ? "—" : `${Number(y.yield_pct).toFixed(2)}%`}</strong>{" "}
      <span className="muted">({t("finished goods ÷ used", "तैयार माल ÷ खपत")})</span>
      {lost > 0.0005 && <> · {t("Not accounted for", "हिसाब में नहीं")}: {kg(lost)}</>}
      {lost < -0.0005 && <> · <span className="bad">{t("More came out than went in", "जितना लगा उससे ज़्यादा बना")}: {kg(-lost)}</span></>}
    </p>
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
  const kinds: Record<string, string> = { inward: t("Arrival", "आवक"), note: t("Debit note", "डेबिट नोट"), consumed: t("Consumed", "खपत"), produced: t("Produced", "उत्पादन"),
    adjustment: t("Correction", "सुधार"), transfer_in: t("Transfer in", "ट्रांसफर आया"), transfer_out: t("Transfer out", "ट्रांसफर गया"),
    ...Object.fromEntries(MOVE_KINDS.map((x) => [x.value, t(x.en, x.hi)])) };
  const rows: [string, string, string][] = [["purchased", "Purchases", "खरीद"], ["branch_in", "From branch", "ब्रांच से"], ["produced", "Produced", "उत्पादन"],
    ["other_in", "Job work, credit notes, transfers in", "जॉब वर्क, क्रेडिट नोट, ट्रांसफर आया"], ["consumed", "Consumed", "खपत"], ["notes_out", "Debit notes", "डेबिट नोट"],
    ["sold", "Sold / dispatched", "बिक्री / डिस्पैच"], ["branch_out", "To branch", "ब्रांच को"], ["other_out", "Job work, transfers out", "जॉब वर्क, ट्रांसफर गया"]];
  let run = Number(row.opening);
  return (
    <Sheet title={nm(lang, row)} onClose={onClose}>
      <KV rows={[[t("Opening", "शुरुआती"), kg(row.opening)],
        ...rows.filter(([c]) => Number(row[c]) !== 0).map(([c, en, hi]): [string, string] => [t(en, hi), kg(row[c])]),
        [t("Closing", "बचा"), kg(row.closing), "total"]]} />
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
