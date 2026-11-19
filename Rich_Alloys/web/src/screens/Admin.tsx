import { useState } from "react";
import { gstinOk, normGstin, q, sb, useCan, useLoad, useT, type Row } from "../lib";
import Staff from "./Staff";
import { Btn, Chip, Empty, Err, Field, Loading, Select, Sheet, SaveBar, Tabs, TextIn } from "../ui";
import { useSave } from "../common";
import { TermsSheet } from "./Deal";
import { TermsLine } from "./Lots";

type Col = { k: string; label: string; type?: "text" | "select"; options?: { value: string; label: string }[]; required?: boolean };
type Cfg = { table: string; title: string; cols: Col[]; hint?: string };

const ROLES = ["owner", "vbog_admin", "deal_desk", "gate", "factory", "factory_accounts", "ho_accounts"];
const ACTIONS: [string, string][] = [
  ["admin", "Admin (masters, permissions)"], ["money_view", "See money"], ["deal_edit", "Book deals, set terms"],
  ["inward_edit", "Record arrivals and returns"], ["sorting_edit", "Enter sorting"], ["lot_close", "Close or reopen sorting"],
  ["doc_verify", "Verify documents"], ["doc_approve", "Approve documents"], ["dn_approve", "Approve debit notes"],
  ["payment_enter", "Record payments"], ["payment_reconcile", "Reconcile payments"], ["tax_edit", "TDS and GST status"],
  ["ledger_confirm", "Confirm supplier ledgers"], ["gst_2b", "GSTR-2B upload (optional, off by default)"], ["tally_factory", "Tick factory Tally"], ["tally_office", "Tick office Tally"],
  ["production_edit", "Enter production"], ["stock_edit", "Other stock entries, Tally closing"],
  ["staff_manage", "Add staff, reset passwords, switch logins off"],
];

export default function Admin({ tab }: { tab?: string }) {
  const t = useT(); const can = useCan();
  const items = useLoad(() => q(sb.from("items").select("code,name").order("sort")), []);
  const cur = tab ?? (can("staff_manage") ? "staff" : "categories");
  const setTab = (x: string) => { history.replaceState(null, "", `#/admin/${x}`); window.dispatchEvent(new HashChangeEvent("hashchange")); };
  const cfgs: Record<string, Cfg> = {
    categories: { table: "sort_categories", title: t("Sorting categories", "छँटाई श्रेणियाँ"), hint: t("What sorting can find inside a lot. Switch off instead of deleting once used.", "लॉट में छँटाई में क्या निकल सकता है। इस्तेमाल हो चुकी श्रेणी हटाने की बजाय बंद करें।"),
      cols: [{ k: "name", label: "Name", required: true }, { k: "name_hi", label: "Hindi name" },
             { k: "default_action", label: "Usually", type: "select", required: true, options: [{ value: "rate_diff", label: "Kept at a lower rate" }, { value: "return", label: "Returned to supplier" }] }] },
    grades: { table: "grades", title: t("Grades", "ग्रेड"), cols: [{ k: "name", label: "Name", required: true }, { k: "name_hi", label: "Hindi name" },
             { k: "stock_item", label: "Stock item in Tally", type: "select", required: true, options: (items.data ?? []).map((i) => ({ value: i.code, label: i.name })) }] },
    items: { table: "items", title: t("Stock items", "स्टॉक आइटम"), hint: "Name them as they appear in Tally.",
             cols: [{ k: "name", label: "Name", required: true }, { k: "name_hi", label: "Hindi name" },
                    { k: "kind", label: "Kind", type: "select", required: true, options: ["raw", "finished", "byproduct", "consumable"].map((x) => ({ value: x, label: x })) }] },
    documents: { table: "doc_types", title: t("Document checklist", "दस्तावेज़ सूची"),
             cols: [{ k: "name", label: "Name", required: true }, { k: "name_hi", label: "Hindi name" },
                    { k: "side", label: "Group", type: "select", required: true, options: [{ value: "supplier", label: "From the supplier" }, { value: "rich_alloys", label: "At our factory" }, { value: "return", label: "Material return" }] }] },
  };
  const tabs = [...(can("staff_manage") ? [{ id: "staff", label: t("Staff", "स्टाफ") }] : []), { id: "categories", label: t("Sorting", "छँटाई") }, { id: "grades", label: t("Grades", "ग्रेड") }, { id: "items", label: t("Stock items", "आइटम") },
                { id: "documents", label: t("Documents", "दस्तावेज़") }, { id: "suppliers", label: t("Suppliers", "सप्लायर") }, { id: "permissions", label: t("Permissions", "अनुमति") }];
  return (
    <>
      <h1>{t("Admin", "एडमिन")}</h1>
      <Tabs tabs={tabs} value={cur} onChange={setTab} />
      {cfgs[cur] && <Master cfg={cfgs[cur]} key={cur} />}
      {cur === "suppliers" && <Suppliers />}
      {cur === "permissions" && <Permissions />}
      {cur === "staff" && can("staff_manage") && <Staff />}
    </>
  );
}

function Master({ cfg }: { cfg: Cfg }) {
  const t = useT();
  const { data, error, reload } = useLoad(() => q(sb.from(cfg.table).select("*").order("sort").order("code")), [cfg.table]);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const s = useSave();
  if (!data) return error ? <Err error={error} /> : <Loading />;
  return (
    <>
      {cfg.hint && <p className="muted small">{cfg.hint}</p>}
      <Btn kind="primary" onClick={() => setEdit("new")}>+ {t("Add", "जोड़ें")}</Btn>
      <Err error={s.error} />
      <ul className="rows gap-top">
        {data.map((r) => (
          <li key={r.code} className={r.active ? "" : "off"}>
            <div className="row static">
              <span className="row-main"><strong>{r.name}</strong><span className="muted small">{r.code}{r.name_hi ? ` · ${r.name_hi}` : ""}
                {cfg.cols.filter((c) => c.type === "select").map((c) => ` · ${c.options?.find((o) => o.value === r[c.k])?.label ?? r[c.k]}`).join("")}</span></span>
              <span className="actions tight">
                <Btn small onClick={() => setEdit(r)}>{t("Edit", "बदलें")}</Btn>
                <Btn small kind={r.active ? "danger" : ""} onClick={() => s.run(() => q(sb.from(cfg.table).update({ active: !r.active }).eq("code", r.code)), reload)}>
                  {r.active ? t("Switch off", "बंद करें") : t("Switch on", "चालू करें")}</Btn>
              </span>
            </div>
          </li>))}
      </ul>
      {edit && <MasterSheet cfg={cfg} row={edit === "new" ? null : edit} count={data.length} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function MasterSheet({ cfg, row, count, onClose, onSaved }: { cfg: Cfg; row: Row | null; count: number; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState<Row>(() => Object.fromEntries(cfg.cols.map((c) => [c.k, row?.[c.k] ?? (c.type === "select" ? c.options?.[0]?.value ?? "" : "")])));
  const [code, setCode] = useState<string>(row?.code ?? "");
  const s = useSave();
  const save = () => s.run(async () => {
    for (const c of cfg.cols) if (c.required && !String(f[c.k] ?? "").trim()) throw new Error(`${c.label} is required.`);
    const values = Object.fromEntries(cfg.cols.map((c) => [c.k, String(f[c.k] ?? "").trim() || null]));
    if (row) await q(sb.from(cfg.table).update(values).eq("code", row.code));
    else {
      const k = (code.trim() || String(f.name)).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (!k) throw new Error("Code is required.");
      await q(sb.from(cfg.table).insert({ code: k, sort: count + 1, ...values }));
    }
  }, () => { onSaved(); onClose(); });
  return (
    <Sheet title={row ? row.name : t("Add", "जोड़ें")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save", "सेव करें")} />}>
      {cfg.cols.map((c) => (
        <Field key={c.k} label={c.label}>
          {c.type === "select" ? <Select value={f[c.k] ?? ""} onChange={(v) => setF({ ...f, [c.k]: v })} options={c.options ?? []} />
            : <TextIn value={f[c.k] ?? ""} onValue={(v) => setF({ ...f, [c.k]: v })} />}
        </Field>))}
      {!row && <Field label="Code (optional)" hint="Capital letters and underscores. Made from the name if left empty. Cannot be changed later."><TextIn value={code} onValue={setCode} /></Field>}
    </Sheet>
  );
}

function Suppliers() {
  const t = useT();
  const { data, error, reload } = useLoad(() => q(sb.from("suppliers").select("*").order("name")), []);
  const [terms, setTerms] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  return (
    <>
      <p className="muted small">{t("Payment terms here drive the cash plan. A deal or lot can override them. Every source of material is a supplier: domestic sellers, the Mumbai branch, import sellers and job workers.", "यहाँ की पेमेंट शर्तें कैश प्लान चलाती हैं। सौदा या लॉट इन्हें बदल सकता है। माल का हर स्रोत सप्लायर है: घरेलू विक्रेता, मुंबई ब्रांच, इम्पोर्ट विक्रेता और जॉब वर्कर।")}</p>
      <Btn kind="primary" onClick={() => setEdit({ supplier_type: "branch", active: true, kyc_status: "verified" })}>+ {t("Add supplier", "सप्लायर जोड़ें")}</Btn>
      {data.length === 0 && <Empty>{t("No suppliers yet. They are added when a deal is booked.", "अभी कोई सप्लायर नहीं। सौदा बुक करते समय जुड़ते हैं।")}</Empty>}
      <ul className="rows">{data.map((s) => (
        <li key={s.id} className={s.active ? "" : "off"}><div className="row static">
          <span className="row-main"><strong>{s.name}</strong><span className="muted small">{SUPPLIER_TYPES.find((x) => x[0] === s.supplier_type)?.[1] ?? s.supplier_type} · {s.gstin ?? "—"} · {s.state ?? "—"} · KYC {s.kyc_status}</span>
            <span className="small"><TermsLine pct={s.provisional_pct} pdays={s.provisional_days} bdays={s.balance_days} /></span></span>
          <span className="actions tight"><Btn small onClick={() => setTerms(s)}>{t("Terms", "शर्तें")}</Btn><Btn small onClick={() => setEdit(s)}>{t("Edit", "बदलें")}</Btn></span>
        </div></li>))}
      </ul>
      {terms && <TermsSheet table="suppliers" id={terms.id} row={terms} onClose={() => setTerms(null)} onSaved={reload} />}
      {edit && <SupplierSheet row={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

// PRD 7b: the supplier type decides which steps a delivery goes through
export const SUPPLIER_TYPES: [string, string, string][] = [
  ["domestic", "Domestic purchase", "घरेलू खरीद"], ["branch", "Own branch (Mumbai)", "अपनी ब्रांच (मुंबई)"],
  ["import", "Import seller", "इम्पोर्ट विक्रेता"], ["job_work", "Job worker", "जॉब वर्कर"],
];

function SupplierSheet({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: row.name ?? "", gstin: row.gstin ?? "", state: row.state ?? "", kyc: row.kyc_status ?? "pending",
    active: row.active ? "yes" : "no", type: row.supplier_type ?? "domestic" });
  const s = useSave();
  return (
    <Sheet title={row.id ? row.name : t("Add supplier", "सप्लायर जोड़ें")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} label="Save" onSave={() => s.run(async () => {
      if (!f.name.trim()) throw new Error("Name is required.");
      if (f.gstin.trim() && !gstinOk(f.gstin)) throw new Error("The GSTIN does not look right (15 characters, e.g. 27AAMCR8303C1ZF). Check it on the supplier's invoice.");
      const rec = { name: f.name.trim(), gstin: normGstin(f.gstin) || null, state: f.state.trim() || null, kyc_status: f.kyc, active: f.active === "yes", supplier_type: f.type };
      await q(row.id ? sb.from("suppliers").update(rec).eq("id", row.id) : sb.from("suppliers").insert(rec));
    }, () => { onSaved(); onClose(); })} />}>
      <Field label={t("Type", "प्रकार")} hint={f.type === "domestic" ? t("Invoices, debit notes in rupees, payments.", "बिल, रुपये में डेबिट नोट, भुगतान।")
        : t("Weights, sorting and documents only. Notes in kg; no payments.", "सिर्फ वज़न, छँटाई और दस्तावेज़। नोट किलो में; भुगतान नहीं।")}>
        <Select value={f.type} onChange={(v) => setF({ ...f, type: v })} options={SUPPLIER_TYPES.map(([v, en, hi]) => ({ value: v, label: t(en, hi) }))} /></Field>
      <Field label="Name"><TextIn value={f.name} onValue={(v) => setF({ ...f, name: v })} /></Field>
      <Field label="GSTIN"><TextIn value={f.gstin} onValue={(v) => setF({ ...f, gstin: v })} /></Field>
      <Field label="State"><TextIn value={f.state} onValue={(v) => setF({ ...f, state: v })} /></Field>
      <Field label="KYC"><Select value={f.kyc} onChange={(v) => setF({ ...f, kyc: v })} options={["pending", "verified", "blocked"].map((x) => ({ value: x, label: x }))} /></Field>
      <Field label="Active"><Select value={f.active} onChange={(v) => setF({ ...f, active: v })} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} /></Field>
    </Sheet>
  );
}

function Permissions() {
  const t = useT();
  const { data, error, reload } = useLoad(() => q(sb.from("permissions").select("*")), []);
  const s = useSave();
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const has = (a: string, r: string) => data.some((p) => p.action === a && p.role === r);
  const toggle = (a: string, r: string) => s.run(() => has(a, r)
    ? q(sb.from("permissions").delete().eq("action", a).eq("role", r))
    : q(sb.from("permissions").insert({ action: a, role: r })), reload);
  return (
    <>
      <p className="muted small">{t("Who can do what. Changes apply the next time a person opens the app.", "कौन क्या कर सकता है। बदलाव अगली बार ऐप खोलने पर लागू।")}</p>
      <Err error={s.error} />
      <div className="tablewrap">
        <table className="tbl perm">
          <thead><tr><th></th>{ROLES.map((r) => <th key={r}>{r.replace("_", " ")}</th>)}</tr></thead>
          <tbody>{ACTIONS.map(([a, label]) => (
            <tr key={a}><td>{label}</td>{ROLES.map((r) => (
              <td key={r} className="c"><input type="checkbox" aria-label={`${label}: ${r}`} checked={has(a, r)} disabled={s.busy} onChange={() => toggle(a, r)} /></td>))}</tr>))}
          </tbody>
        </table>
      </div>
      <p className="muted small"><Chip tone="info">{t("Users", "यूज़र")}</Chip> {t("People are added in Admin > Staff.", "लोग एडमिन > स्टाफ में जोड़े जाते हैं।")}</p>
    </>
  );
}
