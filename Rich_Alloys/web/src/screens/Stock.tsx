import { useState } from "react";
import { COMPANY, csv, day, download, esc, isNum, kg, printHtml, q, rpc, sb, today, useCan, useLang, useLoad, useT, nm, type Row } from "../lib";
import { Btn, Chip, Choice, DateIn, Empty, Err, Field, KV, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
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
  const [closing, setClosing] = useState<Row | null>(null);
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
    const [jobWork, position] = await Promise.all([q(sb.from("v_job_work").select("*").order("supplier")), q(sb.from("v_stock_position").select("*").order("sort"))]);
    return { sum, items, runs, marks, yields, jobWork, position };
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
        <Btn onClick={() => printStatement(data.sum, month)}>{t("Stock statement", "स्टॉक स्टेटमेंट")}</Btn>
        <Btn onClick={() => download(`stock_statement_${month}.csv`, csv(data.sum.map((r) => ({ ...r, item_name: r.name })), [["item_name", "Item Description"], ...STATEMENT_COLS.map(([c, , , head]): [string, string] => [c, head])]))}>{t("Download (CSV)", "डाउनलोड (CSV)")}</Btn>
      </div>
      {data.position.length > 0 && (
        <Section title={t("Where the stock is today", "आज स्टॉक कहाँ है")}>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>{t("Item", "आइटम")}</th><th className="n">{t("In factory", "फ़ैक्टरी में")}</th><th className="n">{t("In production", "उत्पादन में")}</th><th className="n">{t("Booked, to come", "बुक, आना बाकी")}</th><th className="n">{t("Total", "कुल")}</th></tr></thead>
              <tbody>{data.position.map((r) => <tr key={r.item}><td>{nm(lang, r)}</td><td className="n">{kg(r.in_factory)}</td>
                <td className="n">{Number(r.in_production) ? kg(r.in_production) : "—"}</td><td className="n">{Number(r.booked) ? kg(r.booked) : "—"}</td>
                <td className="n"><strong>{kg(Number(r.in_factory) + Number(r.in_production) + Number(r.booked))}</strong></td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted small">{t("In factory: stock not yet used. In production: material used in production that is not closed yet (output not entered). Booked: deals still to arrive.", "फ़ैक्टरी में: जो अभी इस्तेमाल नहीं हुआ। उत्पादन में: उत्पादन में लगा माल जिसका उत्पादन अभी बंद नहीं हुआ। बुक: सौदों का आना बाकी माल।")}</p>
        </Section>)}
      <h3 className="sub">{t("Monthly statement", "मासिक स्टेटमेंट")}</h3>
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
      {data.jobWork.some((j: Row) => Number(j.sent_kg) || Number(j.returned_kg)) && (
        <Section title={t("With job workers", "जॉब वर्कर के पास")}>
          <ul className="rows">{data.jobWork.filter((j: Row) => Number(j.sent_kg) || Number(j.returned_kg)).map((j: Row) => (
            <li key={j.supplier_id} className={Number(j.with_job_worker_kg) > 0.0005 ? "edge-wait" : "edge-ok"}><div className="row static">
              <span className="row-main"><strong>{j.supplier}</strong>
                <span className="muted small">{t("Sent", "भेजा")} {kg(j.sent_kg)} · {t("Came back", "वापस आया")} {kg(j.returned_kg)}</span></span>
              <span className="num"><strong>{kg(j.with_job_worker_kg)}</strong></span>
            </div></li>))}
          </ul>
        </Section>
      )}
      <Section title={t("Production entries", "उत्पादन एंट्री")}>
        {data.runs.length === 0 ? <Empty>{t("None yet.", "अभी कोई नहीं।")}</Empty> : data.runs.map((r) => (
          <div className="item" key={r.id}>
            <div className="item-head"><strong>{day(r.run_date)}{r.status === "open" ? <> <Chip tone="wait">{t("In production", "उत्पादन चालू")}</Chip></> : r.closed_on && r.closed_on !== r.run_date ? <span className="muted small"> → {day(r.closed_on)}</span> : null}</strong>
              <TallyTick entity="production" id={r.id} book="factory" marks={data.marks} onDone={reload} /></div>
            <p className="small">{t("Used", "खपत")}: {r.production_lines.filter((l: Row) => l.direction === "consumed").map((l: Row) => `${iname(l.item)} ${kg(l.kg)}`).join(", ") || "—"}</p>
            <p className="small">{t("Made", "बना")}: {r.production_lines.filter((l: Row) => l.direction === "produced").map((l: Row) => `${iname(l.item)} ${kg(l.kg)}`).join(", ") || "—"}</p>
            <YieldLine y={data.yields.find((y: Row) => y.id === r.id)} />
            {r.notes && <p className="muted small">{r.notes}</p>}
            {r.status === "open" && can("production_edit") && <div className="actions"><Btn small kind="primary" onClick={() => setClosing(r)}>{t("Production done: enter what was made", "उत्पादन पूरा: क्या बना डालें")}</Btn></div>}
          </div>))}
      </Section>
      {prod && <ProductionSheet items={data.items} onClose={() => setProd(false)} onSaved={reload} />}
      {closing && <CloseProductionSheet run={closing} items={data.items} onClose={() => setClosing(null)} onSaved={reload} />}
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
    if (!lines.some((l) => l.direction === "consumed")) throw new Error(t("Add what was used.", "क्या लगा, डालें।"));
    await rpc("save_production", { p: { run_date: date, notes, lines } });
  }, () => { onSaved(); onClose(); }, lines0() ? ["Production saved", "उत्पादन सेव हुआ"] : ["Saved as in production. Close it when the output is weighed.", "उत्पादन चालू के रूप में सेव। माल तौलने पर बंद करें।"]);
  function lines0() { return made.some((l) => l.item && l.kg); }
  return (
    <Sheet title={t("Production", "उत्पादन")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save production", "उत्पादन सेव करें")} />}>
      <Field label={t("Date", "तारीख")}><DateIn value={date} onChange={setDate} /></Field>
      <p className="muted small">{t("Enter what was actually weighed. Dross and ash do not have to make the run balance; anything not accounted for shows as melting loss.", "जो सच में तौला, वही डालें। ड्रॉस और ऐश से हिसाब बराबर करना ज़रूरी नहीं; जो बचा वो पिघलाई में कमी दिखेगी।")}</p>
      <h3 className="sub">{t("Used (consumed)", "क्या लगा (खपत)")}</h3>{rows(used, setUsed)}
      <h3 className="sub">{t("Made (produced)", "क्या बना (उत्पादन)")}</h3>
      <p className="muted small">{t("Still in the furnace? Leave this empty and save. It shows as 'in production' until you enter what was made.", "अभी भट्टी में है? इसे खाली छोड़कर सेव करें। जब तक क्या बना न डालें, यह 'उत्पादन चालू' दिखेगा।")}</p>
      {rows(made, setMade)}
      <Field label={t("Note (optional)", "नोट (वैकल्पिक)")}><TextIn value={notes} onValue={setNotes} /></Field>
    </Sheet>
  );
}

// Production done: what came out is weighed and entered, and the run closes
function CloseProductionSheet({ run, items, onClose, onSaved }: { run: Row; items: Row[]; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const lang = useLang();
  const opt = items.map((i) => ({ value: i.code, label: nm(lang, i) }));
  const [date, setDate] = useState(today());
  const [made, setMade] = useState<PL[]>([{ item: items.find((i) => i.kind === "finished")?.code ?? "", kg: "" }]);
  const s = useSave();
  const used = (run.production_lines ?? []).filter((l: Row) => l.direction === "consumed");
  return (
    <Sheet title={`${t("Production done", "उत्पादन पूरा")} · ${day(run.run_date)}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save and close", "सेव करें और बंद करें")} onSave={() => s.run(async () => {
        const lines = made.filter((l) => l.item && l.kg);
        if (!lines.length || lines.some((l) => !isNum(l.kg))) throw new Error(t("Enter what was made.", "क्या बना, डालें।"));
        await rpc("close_production", { p_run: run.id, p: { closed_on: date, lines } });
      }, () => { onSaved(); onClose(); }, ["Production closed", "उत्पादन बंद हुआ"])} />}>
      <p className="small">{t("Used", "खपत")}: {used.map((l: Row) => `${nm(lang, items.find((i) => i.code === l.item)) || l.item} ${kg(l.kg)}`).join(", ")}</p>
      <Field label={t("Finished on", "पूरा होने की तारीख")}><DateIn value={date} onChange={setDate} /></Field>
      {made.map((l, i) => (
        <div className="line two" key={i}>
          <Field label={t("Item made", "क्या बना")}><Select value={l.item} onChange={(v) => setMade(made.map((x, j) => (j === i ? { ...x, item: v } : x)))} placeholder="—" options={opt} /></Field>
          <Field label={t("Weight", "वज़न")}><NumIn value={l.kg} onChange={(v) => setMade(made.map((x, j) => (j === i ? { ...x, kg: v } : x)))} suffix="kg" /></Field>
          {made.length > 1 && <button type="button" className="x" aria-label={t("Remove", "हटाएँ")} onClick={() => setMade(made.filter((_, j) => j !== i))}>×</button>}
        </div>))}
      <Btn small onClick={() => setMade([...made, { item: "", kg: "" }])}>+ {t("Another item", "और आइटम")}</Btn>
    </Sheet>
  );
}

// Stock movements beyond supplier lots (PRD 7a item 2). Quantity only: no prices, buyers or import process.
// PRD 7b: material coming in from the branch, import sellers and job workers arrives as a lot (Lots screen).
// What stays here: sales, sending to the branch or a job worker, sales returns, item-to-item, opening, correction.
const MOVE_KINDS: { value: string; en: string; hi: string; dir: 1 | -1 | 0; to?: string }[] = [
  { value: "dispatch", en: "Sale / dispatch", hi: "बिक्री / डिस्पैच", dir: -1 },
  { value: "branch_out", en: "To Mumbai branch", hi: "मुंबई ब्रांच भेजा", dir: -1, to: "branch" },
  { value: "job_work_out", en: "Sent for job work", hi: "जॉब वर्क के लिए भेजा", dir: -1, to: "job_work" },
  { value: "credit_note", en: "Sales return (credit note)", hi: "बिक्री वापसी (क्रेडिट नोट)", dir: 1 },
  { value: "transfer", en: "Item to item", hi: "आइटम से आइटम", dir: 0 },
  { value: "opening", en: "Opening stock", hi: "शुरुआती स्टॉक", dir: 1 },
  { value: "adjustment", en: "Correction", hi: "सुधार", dir: 0 },
];
const OLD_KINDS: Record<string, [string, string]> = {
  branch_in: ["From Mumbai branch", "मुंबई ब्रांच से आया"], purchase_other: ["Other purchase", "अन्य खरीद"],
  import_receipt: ["Import receipt", "इम्पोर्ट"], job_work_in: ["Job work received", "जॉब वर्क आया"] };

function MoveSheet({ items, onClose, onSaved }: { items: Row[]; onClose: () => void; onSaved: () => void }) {
  const t = useT(); const lang = useLang();
  const sups = useLoad(() => q(sb.from("suppliers").select("id,name,supplier_type").eq("active", true).in("supplier_type", ["branch", "job_work"]).order("name")), []);
  const [to, setTo] = useState("");
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
    if (k.to && !to) throw new Error(k.to === "branch" ? t("Choose the branch.", "ब्रांच चुनें।") : t("Choose the job worker.", "जॉब वर्कर चुनें।"));
    const toName = (sups.data ?? []).find((x) => x.id === to)?.name;
    await q(sb.from("stock_moves").insert({ move_date: date, item, kind, kg: sign * Number(kgv), supplier_id: k.to ? to : null,
      party: (k.to ? toName : party.trim()) || null, doc_no: doc.trim() || null, reason: reason.trim() || null }));
  }, () => { onSaved(); onClose(); });
  return (
    <Sheet title={t("Other stock entry", "अन्य स्टॉक एंट्री")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save", "सेव करें")} />}>
      <Field label={t("What is it", "क्या है")}>
        <Choice value={kind} onChange={(v) => { setKind(v); setTo(""); }} cols={2} options={MOVE_KINDS.map((x) => ({ value: x.value, label: t(x.en, x.hi) }))} />
      </Field>
      <p className="muted small">{t("Material arriving from the branch, an import seller or a job worker is recorded on the Lots screen.", "ब्रांच, इम्पोर्ट विक्रेता या जॉब वर्कर से आया माल लॉट स्क्रीन पर दर्ज होता है।")}</p>
      <div className="grid2">
        <Field label={kind === "transfer" ? t("From item", "किस आइटम से") : t("Item", "आइटम")}><Select value={item} onChange={setItem} placeholder="—" options={opts} /></Field>
        {kind === "transfer" && <Field label={t("To item", "किस आइटम में")}><Select value={toItem} onChange={setToItem} placeholder="—" options={opts} /></Field>}
        <Field label={t("Weight", "वज़न")}><NumIn value={kgv} onChange={setKg} suffix="kg" /></Field>
        <Field label={t("Date", "तारीख")}><DateIn value={date} onChange={setDate} /></Field>
        {k.to && <Field label={k.to === "branch" ? t("Branch", "ब्रांच") : t("Job worker", "जॉब वर्कर")}>
          <Select value={to} onChange={setTo} placeholder="—" options={(sups.data ?? []).filter((x) => x.supplier_type === k.to).map((x) => ({ value: x.id, label: x.name }))} /></Field>}
        {!k.to && kind !== "transfer" && kind !== "opening" && kind !== "adjustment" &&
          <Field label={kind === "credit_note" ? t("Customer", "ग्राहक") : t("Party", "पार्टी")}><TextIn value={party} onValue={setParty} /></Field>}
        {kind !== "adjustment" && <Field label={t("Document number", "डॉक्यूमेंट नंबर")} hint={kind === "branch_out" ? t("Delivery note", "डिलीवरी नोट") : kind === "job_work_out" ? t("Challan", "चालान") : undefined}>
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
    ...Object.fromEntries(MOVE_KINDS.map((x) => [x.value, t(x.en, x.hi)])),
    ...Object.fromEntries(Object.entries(OLD_KINDS).map(([k2, [en, hi]]) => [k2, t(en, hi)])) };
  const rows: [string, string, string][] = STATEMENT_COLS.filter(([c]) => !["opening", "total", "closing"].includes(c)).map(([c, en, hi]) => [c, en, hi]);
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

// Tinu's monthly stock statement, column for column (Stock_analysis_2627.xlsx). Figures come from stock_summary.
const STATEMENT_COLS: [string, string, string, string][] = [
  ["opening", "Opening", "शुरुआती", "OP BALANCE"], ["purchase", "Purchase", "खरीद", "PURCHASE"],
  ["transfer_in", "Transfer received", "ट्रांसफर आया", "TRANSFER RECED"], ["produced", "Production (MFG)", "उत्पादन", "MFG"],
  ["receipt_note", "Receipt note (branch)", "रसीद नोट (ब्रांच)", "Recipt Note"], ["job_work_in", "Received from job work", "जॉब वर्क से आया", "Recd Process Job Wrk"],
  ["credit_note", "Credit note (sales return)", "क्रेडिट नोट", "CREDIT NOTE"], ["total", "Total", "कुल", "TOTAL"],
  ["sale", "Sale", "बिक्री", "SALE"], ["transfer_out", "Transfer to", "ट्रांसफर गया", "Transfer to"],
  ["debit_note", "Debit note", "डेबिट नोट", "Debit Note"], ["to_branch", "Delivery note to Mumbai", "मुंबई डिलीवरी नोट", "Del Note To Rich Mum"],
  ["to_job_work", "Sent for job work", "जॉब वर्क भेजा", "Send to Labour Job"], ["consumed", "Consumption", "खपत", "Consumption"],
  ["correction", "Correction (+/−)", "सुधार (+/−)", "Correction"], ["closing", "Closing", "बचा", "Closing Balance"],
];

function printStatement(sum: Row[], month: string) {
  const title = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const cols = STATEMENT_COLS.filter(([c]) => c !== "correction" || sum.some((r) => Number(r.correction) !== 0));
  const n3 = (v: unknown) => Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const body = sum.map((r) => `<tr><td>${esc(r.name)}</td>${cols.map(([c]) => `<td class="n">${n3(r[c])}</td>`).join("")}</tr>`).join("");
  printHtml(`Stock statement ${title}`, `<div><b>${esc(COMPANY.name)}</b><br>${esc(COMPANY.address)}<br>GSTIN ${esc(COMPANY.gstin)}</div>
    <h1 style="margin-top:12px">Stock Statement For The Month of ${esc(title)}</h1>
    <table><thead><tr><th>Item Description</th>${cols.map(([, , , h]) => `<th class="n">${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
    <p class="muted">kg. Prepared by the purchase portal from arrivals, debit notes, production and stock entries.</p>`);
}
