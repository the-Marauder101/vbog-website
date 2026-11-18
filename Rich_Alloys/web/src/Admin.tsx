// Admin (PRD 9): staff, suppliers, master lists (grades, sorting categories).
import { useState } from "react";
import { masters, saveGrade, saveSortCat, saveSupplier, type Grade, type SortCat, type Supplier } from "./data";
import { num, str } from "./format";
import type { Key } from "./i18n";
import { canManageStaff, type Profile } from "./types";
import { Err, NumIn, Ok, Sel, TxtIn, useLoad, useSaver } from "./ui";
import Staff from "./Staff";

type T = (k: Key) => string;
type Part = "staff" | "suppliers" | "grades" | "cats";

export default function Admin({ t, me }: { t: T; me: Profile }) {
  const parts: [Part, Key][] = [
    ...(canManageStaff(me.role) ? [["staff", "staff"] as [Part, Key]] : []),
    ["suppliers", "suppliers"], ["grades", "gradesTitle"], ["cats", "sortCats"],
  ];
  const [part, setPart] = useState<Part>(parts[0][0]);
  const m = useLoad(masters, []);
  return (
    <>
      <nav className="tabs sub-tabs" aria-label={t("admin")}>
        {parts.map(([k, l]) => <button key={k} aria-current={part === k ? "page" : undefined} onClick={() => setPart(k)}>{t(l)}</button>)}
      </nav>
      {part === "staff" && <Staff t={t} me={me} />}
      {part !== "staff" && m.error && <Err msg={m.error} />}
      {part !== "staff" && !m.data && !m.error && <p className="muted">{t("loading")}</p>}
      {part === "suppliers" && m.data && <Suppliers t={t} rows={m.data.suppliers} onSaved={m.reload} />}
      {part === "grades" && m.data && <Grades t={t} rows={m.data.grades} onSaved={m.reload} />}
      {part === "cats" && m.data && <Cats t={t} rows={m.data.cats} onSaved={m.reload} />}
    </>
  );
}

// ---------- suppliers ----------
function Suppliers({ t, rows, onSaved }: { t: T; rows: Supplier[]; onSaved: () => void }) {
  const [open, setOpen] = useState<string | "new" | null>(null);
  return (
    <>
      <h1>{t("suppliers")}</h1>
      {open === "new"
        ? <SupplierForm t={t} onDone={() => { setOpen(null); onSaved(); }} onCancel={() => setOpen(null)} />
        : <button className="btn primary wide" onClick={() => setOpen("new")}>+ {t("newSupplier")}</button>}
      <ul className="rows">
        {rows.map((s) => (
          <li key={s.id} className={s.kyc_status === "verified" ? "state-approved" : s.kyc_status === "blocked" ? "state-rejected" : "state-uploaded"}>
            <button className="row" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className="row-main">
                <strong>{s.name}</strong>
                <span className="muted small">{s.gstin ?? t("noGstin")}{s.state ? ` · ${s.state}` : ""}</span>
                <span className="muted small">
                  {t("provisionalPct")}: {s.provisional_pct ?? "—"}{s.provisional_pct != null ? "%" : ""} · {t("creditDays")}: {s.credit_days ?? "—"}
                </span>
                <span className="chips"><span className={`chip ${s.kyc_status === "verified" ? "approved" : s.kyc_status === "blocked" ? "rejected" : "uploaded"}`}>{t(`kyc_${s.kyc_status}` as Key)}</span></span>
              </span>
              <span className="chev" aria-hidden="true">{open === s.id ? "⌃" : "›"}</span>
            </button>
            {open === s.id && <div className="detail"><SupplierForm t={t} row={s} onDone={() => { setOpen(null); onSaved(); }} onCancel={() => setOpen(null)} /></div>}
          </li>
        ))}
      </ul>
    </>
  );
}

function SupplierForm({ t, row, onDone, onCancel }: { t: T; row?: Supplier; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: row?.name ?? "", gstin: row?.gstin ?? "", state: row?.state ?? "", kyc_status: row?.kyc_status ?? "pending",
    provisional_pct: str(row?.provisional_pct), credit_days: str(row?.credit_days) });
  const s = useSaver();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <div className="card inset">
      <div className="grid2">
        <TxtIn label={t("supplierName")} value={f.name} onChange={set("name")} />
        <TxtIn label="GSTIN" value={f.gstin} onChange={set("gstin")} upper />
        <TxtIn label={t("state")} value={f.state} onChange={set("state")} />
        <Sel label={t("kycStatus")} value={f.kyc_status} onChange={set("kyc_status")}
             options={[["pending", t("kyc_pending")], ["verified", t("kyc_verified")], ["blocked", t("kyc_blocked")]]} />
        <NumIn label={t("provisionalPct")} value={f.provisional_pct} onChange={set("provisional_pct")} suffix="%" />
        <NumIn label={t("creditDays")} value={f.credit_days} onChange={set("credit_days")} />
      </div>
      <div className="actions">
        <button className="btn primary" disabled={s.busy} onClick={async () => {
          const ok = await s.run(async () => {
            if (!f.name.trim()) throw new Error(t("needSupplierName"));
            const p = num(f.provisional_pct), c = num(f.credit_days);
            if (Number.isNaN(p) || Number.isNaN(c)) throw new Error(`${t("checkNumbers")}: ${t("provisionalPct")}, ${t("creditDays")}`);
            await saveSupplier({ id: row?.id, name: f.name.trim(), gstin: f.gstin.trim() || null, state: f.state.trim() || null,
              kyc_status: f.kyc_status as Supplier["kyc_status"], provisional_pct: p, credit_days: c === null ? null : Math.round(c) });
          });
          if (ok) onDone();
        }}>{s.busy ? t("saving") : t("save")}</button>
        <button className="btn" onClick={onCancel}>{t("cancel")}</button>
      </div>
      <Err msg={s.error} />
    </div>
  );
}

// ---------- grades ----------
function Grades({ t, rows, onSaved }: { t: T; rows: Grade[]; onSaved: () => void }) {
  return (
    <>
      <h1>{t("gradesTitle")}</h1>
      <p className="muted small">{t("mastersHint")}</p>
      {rows.map((g) => <MasterRow key={g.code} t={t} code={g.code} name={g.name} nameHi={g.name_hi ?? ""}
        onSave={(n, h) => saveGrade({ code: g.code, name: n, name_hi: h || null }, false)} onSaved={onSaved} />)}
      <NewMaster t={t} onSave={(c, n, h) => saveGrade({ code: c, name: n, name_hi: h || null }, true)} onSaved={onSaved} />
    </>
  );
}

// ---------- sorting categories ----------
function Cats({ t, rows, onSaved }: { t: T; rows: SortCat[]; onSaved: () => void }) {
  return (
    <>
      <h1>{t("sortCats")}</h1>
      <p className="muted small">{t("mastersHint")}</p>
      {rows.map((c) => <MasterRow key={c.code} t={t} code={c.code} name={c.name} nameHi={c.name_hi ?? ""} action={c.default_action}
        onSave={(n, h, a) => saveSortCat({ code: c.code, name: n, name_hi: h || null, default_action: a ?? c.default_action }, false)} onSaved={onSaved} />)}
      <NewMaster t={t} withAction onSave={(c, n, h, a) => saveSortCat({ code: c, name: n, name_hi: h || null, default_action: a ?? "return" }, true)} onSaved={onSaved} />
    </>
  );
}

type Act = "rate_diff" | "return";
function MasterRow({ t, code, name, nameHi, action, onSave, onSaved }: {
  t: T; code: string; name: string; nameHi: string; action?: Act; onSave: (n: string, h: string, a?: Act) => Promise<void>; onSaved: () => void;
}) {
  const [n, setN] = useState(name), [h, setH] = useState(nameHi), [a, setA] = useState<Act | undefined>(action);
  const s = useSaver();
  const dirty = n !== name || h !== nameHi || a !== action;
  return (
    <div className="card inset master">
      <strong className="mono">{code}</strong>
      <div className={action ? "grid3" : "grid2"}>
        <TxtIn label={t("nameEn")} value={n} onChange={setN} />
        <TxtIn label={t("nameHi")} value={h} onChange={setH} />
        {action && <Sel label={t("defaultAction")} value={a ?? "return"} onChange={(v) => setA(v as Act)}
                        options={[["rate_diff", t("act_rate_diff")], ["return", t("act_return")]]} />}
      </div>
      {dirty && <div className="actions"><button className="btn primary" disabled={s.busy || !n.trim()}
        onClick={async () => { if (await s.run(() => onSave(n.trim(), h.trim(), a), t("saved"))) onSaved(); }}>{t("save")}</button></div>}
      <Err msg={s.error} /><Ok msg={s.done} />
    </div>
  );
}

function NewMaster({ t, withAction, onSave, onSaved }: {
  t: T; withAction?: boolean; onSave: (c: string, n: string, h: string, a?: Act) => Promise<void>; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState(""), [n, setN] = useState(""), [h, setH] = useState(""), [a, setA] = useState<Act>("return");
  const s = useSaver();
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>+ {t("addNew")}</button>;
  return (
    <div className="card inset">
      <div className="grid2">
        <TxtIn label={t("code")} value={c} onChange={(v) => setC(v.replace(/[^A-Z0-9_]/gi, "_"))} upper hint={t("codeHint")} />
        <TxtIn label={t("nameEn")} value={n} onChange={setN} />
        <TxtIn label={t("nameHi")} value={h} onChange={setH} />
        {withAction && <Sel label={t("defaultAction")} value={a} onChange={(v) => setA(v as Act)}
                            options={[["rate_diff", t("act_rate_diff")], ["return", t("act_return")]]} />}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={s.busy || !c.trim() || !n.trim()} onClick={async () => {
          if (await s.run(() => onSave(c.trim(), n.trim(), h.trim(), withAction ? a : undefined))) { setOpen(false); setC(""); setN(""); setH(""); onSaved(); }
        }}>{t("save")}</button>
        <button className="btn" onClick={() => setOpen(false)}>{t("cancel")}</button>
      </div>
      <Err msg={s.error} />
    </div>
  );
}
