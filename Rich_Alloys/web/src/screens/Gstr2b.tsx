import { useState } from "react";
import { day, go, inr, q, rpc, sb, today, useCan, useLoad, useT, type Row } from "../lib";
import { Btn, Chip, Empty, Err, Field, Loading, Section, Sheet, SaveBar } from "../ui";
import { useSave } from "../common";

// Reads the GSTR-2B JSON downloaded from the GST portal (Returns > GSTR-2B > Download JSON).
// Defensive: accepts tax at item or invoice level, and either { data: {...} } or the bare object.
type Line = { section: string; supplier_gstin: string; supplier_name?: string; doc_type: string; doc_no: string;
              doc_date: string | null; taxable: number | null; tax: number | null; total: number | null; itc_available: boolean | null };
export function parse2B(json: unknown): { period: string; lines: Line[] } {
  const root = (json as Row)?.data ?? json;
  const rp = String(root?.rtnprd ?? root?.ret_period ?? "");
  const period = /^\d{6}$/.test(rp) ? `${rp.slice(2)}-${rp.slice(0, 2)}` : "";
  const docs = root?.docdata ?? root?.docData ?? {};
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const date = (v: unknown) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(v ?? "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const money = (d: Row) => {
    const items: Row[] = Array.isArray(d.items) && d.items.length ? d.items : [d];
    const sum = (k: string) => items.reduce((a, it) => a + (Number(it[k]) || 0), 0);
    const taxable = sum("txval"); const tax = sum("igst") + sum("cgst") + sum("sgst") + sum("cess");
    return { taxable: Math.round(taxable * 100) / 100, tax: Math.round(tax * 100) / 100 };
  };
  const lines: Line[] = [];
  for (const sup of (docs.b2b ?? []) as Row[]) for (const inv of (sup.inv ?? []) as Row[]) {
    const m = money(inv);
    lines.push({ section: "b2b", supplier_gstin: sup.ctin, supplier_name: sup.trdnm, doc_type: "invoice", doc_no: inv.inum,
      doc_date: date(inv.dt), taxable: m.taxable, tax: m.tax, total: n(inv.val), itc_available: inv.itcavl == null ? null : inv.itcavl === "Y" });
  }
  for (const sup of (docs.cdnr ?? []) as Row[]) for (const nt of (sup.nt ?? []) as Row[]) {
    const m = money(nt);
    lines.push({ section: "cdnr", supplier_gstin: sup.ctin, supplier_name: sup.trdnm, doc_type: nt.typ === "D" ? "debit_note" : "credit_note",
      doc_no: nt.ntnum, doc_date: date(nt.dt), taxable: m.taxable, tax: m.tax, total: n(nt.val), itc_available: nt.itcavl == null ? null : nt.itcavl === "Y" });
  }
  return { period, lines };
}

export function Gstr2b({ onChange }: { onChange: () => void }) {
  const t = useT(); const can = useCan();
  const { data, error, reload } = useLoad(() => Promise.all([
    q(sb.from("v_gstr2b_recon").select("*").order("doc_date", { ascending: true, nullsFirst: false })),
    q(sb.from("gstr2b_imports").select("*").order("period", { ascending: false }).limit(12)),
  ]), []);
  const [file, setFile] = useState<{ name: string; period: string; lines: Line[] } | null>(null);
  const [result, setResult] = useState<Row | null>(null);
  const [manual, setManual] = useState<Row | null>(null);
  const [view, setView] = useState("diff");
  const s = useSave();
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [rows, imports] = data;
  const diff = rows.filter((r) => r.status === "matched" && Math.abs(Number(r.difference)) > 1);
  const missing = rows.filter((r) => r.status === "not_in_2b" && r.doc_date < today().slice(0, 8) + "01");
  const extra = rows.filter((r) => r.status === "not_in_portal");
  const notes = rows.filter((r) => r.status === "credit_note" || r.status === "debit_note");
  const read = async (f: File | undefined) => {
    if (!f) return;
    setResult(null);
    await s.run(async () => {
      let json: unknown;
      try { json = JSON.parse(await f.text()); } catch { throw new Error(t("This is not a GSTR-2B JSON file. Download the JSON (not Excel) from the GST portal.", "यह GSTR-2B JSON फ़ाइल नहीं है। GST पोर्टल से JSON (Excel नहीं) डाउनलोड करें।")); }
      const p = parse2B(json);
      if (!p.period) throw new Error(t("Could not find the return period in this file.", "फ़ाइल में रिटर्न महीना नहीं मिला।"));
      if (!p.lines.length) throw new Error(t("No invoices found in this file.", "फ़ाइल में कोई बिल नहीं मिला।"));
      setFile({ name: f.name, ...p });
    });
  };
  const lists: Record<string, [string, Row[], string]> = {
    diff: [t("Amount differs", "रकम अलग"), diff, t("The supplier filed a different amount than the invoice we recorded.", "सप्लायर ने हमारे बिल से अलग रकम फ़ाइल की।")],
    missing: [t("Our invoices not in 2B", "हमारे बिल 2B में नहीं"), missing, t("Before last month. Credit cannot be taken until the supplier files. Chase them before paying the balance.", "पिछले महीने से पहले के। सप्लायर के फ़ाइल करने तक क्रेडिट नहीं मिलेगा। बाकी पेमेंट से पहले उनसे बात करें।")],
    extra: [t("In 2B, not in portal", "2B में, पोर्टल में नहीं"), extra, t("Often other purchases (power, services). Scrap invoices here mean an arrival was not recorded or the invoice number differs.", "अक्सर दूसरी खरीद (बिजली, सेवाएँ)। स्क्रैप के बिल हों तो माल दर्ज नहीं हुआ या बिल नंबर अलग है।")],
    notes: [t("Supplier credit and debit notes", "सप्लायर के क्रेडिट/डेबिट नोट"), notes, t("Our debit notes should come back as the supplier's credit notes. Compare per supplier.", "हमारे डेबिट नोट सप्लायर के क्रेडिट नोट के रूप में आने चाहिए। सप्लायरवार मिलाएँ।")],
  };
  const [title, list, hint] = lists[view];
  return (
    <Section title="GSTR-2B" right={can("tax_edit") ? (
      <label className="btn small primary filebtn">{t("Upload 2B file", "2B फ़ाइल अपलोड")}<input type="file" accept=".json,application/json" hidden onChange={(e) => { read(e.target.files?.[0]); e.target.value = ""; }} /></label>) : undefined}>
      <p className="muted small">{t("Each month: GST portal → Returns → GSTR-2B → Download JSON, then upload it here. Invoices are matched by supplier GSTIN and invoice number.", "हर महीने: GST पोर्टल → रिटर्न → GSTR-2B → JSON डाउनलोड करें, फिर यहाँ अपलोड करें। बिल सप्लायर GSTIN और बिल नंबर से मिलाए जाते हैं।")}</p>
      {imports.length > 0 && <p className="small">{t("Uploaded", "अपलोड हुए")}: {imports.map((i) => i.period).join(", ")}</p>}
      <Err error={s.error} />
      {result && <p className="okline">✓ {result.lines} {t("lines read", "लाइन पढ़ी")}, {result.matched} {t("matched to our invoices", "हमारे बिलों से मिलीं")}.</p>}
      <div className="filters">
        {Object.entries(lists).map(([k, [lb, l]]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{lb} ({l.length})</button>)}
      </div>
      <p className="muted small">{hint}</p>
      {list.length === 0 ? <Empty>{t("None.", "कोई नहीं।")}</Empty> : (
        <ul className="rows">{list.map((r, i) => (
          <li key={i} className={view === "diff" || view === "missing" ? "edge-bad" : "edge-info"}>
            <div className="row static">
              <span className="row-main"><strong>{r.supplier ?? r.supplier_gstin}</strong>
                <span className="muted small">{r.doc_no} · {day(r.doc_date)}{r.period ? ` · 2B ${r.period}` : ""}{r.itc_available === false ? ` · ${t("ITC not available", "ITC उपलब्ध नहीं")}` : ""}</span>
                {view === "diff" && <span className="small">{t("2B", "2B")} {inr(r.gstr2b_total)} · {t("ours", "हमारा")} {inr(r.portal_total)} · <strong className="bad">{inr(r.difference)}</strong></span>}
              </span>
              <span className="actions tight">
                {r.lot_id && <Btn small onClick={() => go(`lot/${r.lot_id}/weights`)}>{t("Open", "खोलें")}</Btn>}
                {view === "missing" && can("tax_edit") && <Btn small onClick={() => setManual(r)}>{t("Seen in 2B", "2B में दिखा")}</Btn>}
                {view !== "missing" && view !== "diff" && <Chip tone="info">{r.total != null ? inr(r.total) : "—"}</Chip>}
              </span>
            </div>
          </li>))}
        </ul>)}
      {file && (
        <Sheet title={`GSTR-2B ${file.period}`} onClose={() => setFile(null)}
          footer={<SaveBar busy={s.busy} error={s.error} label={t("Upload and match", "अपलोड करें और मिलाएँ")} onSave={() => s.run(async () => {
            const r = await rpc<Row>("import_gstr2b", { p: { period: file.period, file_name: file.name, lines: file.lines } });
            setResult(r); setFile(null);
          }, () => { reload(); onChange(); })} />}>
          <p>{file.name}</p>
          <p><strong>{file.lines.filter((l) => l.section === "b2b").length}</strong> {t("invoices", "बिल")} · <strong>{file.lines.filter((l) => l.section === "cdnr").length}</strong> {t("credit/debit notes", "क्रेडिट/डेबिट नोट")} · {new Set(file.lines.map((l) => l.supplier_gstin)).size} {t("suppliers", "सप्लायर")}</p>
          {imports.some((i) => i.period === file.period) && <p className="warn">{t("This month was uploaded before. The new file replaces it.", "यह महीना पहले अपलोड हुआ था। नई फ़ाइल उसकी जगह लेगी।")}</p>}
        </Sheet>
      )}
      {manual && <ManualSheet inv={manual} onClose={() => setManual(null)} onSaved={() => { reload(); onChange(); }} />}
    </Section>
  );
}

function ManualSheet({ inv, onClose, onSaved }: { inv: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [p, setP] = useState(today().slice(0, 7));
  const s = useSave();
  return (
    <Sheet title={`GSTR-2B · ${inv.doc_no}`} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(() => rpc("set_invoice_2b", { p_id: inv.invoice_id, p_in: true, p_period: p }), () => { onSaved(); onClose(); })} />}>
      <p className="muted small">{t("Use only if the upload could not match it (for example, the supplier typed the invoice number differently).", "तभी इस्तेमाल करें जब अपलोड इसे न मिला पाए (जैसे सप्लायर ने बिल नंबर अलग लिखा)।")}</p>
      <Field label={t("2B period", "2B महीना")}><input type="month" value={p} onChange={(e) => setP(e.target.value)} /></Field>
    </Sheet>
  );
}
