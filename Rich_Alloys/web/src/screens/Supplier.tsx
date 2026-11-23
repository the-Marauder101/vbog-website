// One supplier: onboarding (checklist + onboarded or not), recurring reminders, payment terms and hold, deals.
import { useState } from "react";
import { addDays, day, go, inr, isNum, q, rpc, sb, today, useCan, useLang, useLoad, useT, nm, type Row } from "../lib";
import { Btn, Chip, DateIn, Empty, Err, Field, KV, Loading, NumIn, Section, Select, Sheet, SaveBar, TextIn } from "../ui";
import { HoldHint, useSave } from "../common";
import { TermsSheet } from "./Deal";
import { TermsLine } from "./Lots";
import { SUPPLIER_TYPES, SupplierSheet } from "./Admin";

const UNITS: [string, string, string][] = [["day", "days", "दिन"], ["week", "weeks", "हफ़्ते"], ["month", "months", "महीने"], ["year", "years", "साल"]];
const ONE: Record<string, [string, string]> = { day: ["Every day", "हर दिन"], week: ["Every week", "हर हफ़्ते"], month: ["Every month", "हर महीने"], year: ["Every year", "हर साल"] };
const FOR: [string, string, string][] = [["owner", "Himanshu (owner)", "हिमांशु (मालिक)"], ["factory_accounts", "Factory accounts (Tinu)", "फैक्ट्री अकाउंट्स (टीनू)"],
  ["ho_accounts", "Head office accounts (Niti)", "हेड ऑफिस अकाउंट्स (नीति)"], ["vbog_admin", "V-BOG admin", "V-BOG एडमिन"]];

export default function Supplier({ id }: { id: string }) {
  const t = useT(); const can = useCan(); const lang = useLang();
  const [terms, setTerms] = useState(false);
  const [edit, setEdit] = useState(false);
  const [rem, setRem] = useState<Row | null>(null);
  const [tick, setTick] = useState<Record<string, boolean>>({});   // ticks show at once; undone if the save fails
  const s = useSave();
  const { data, error, reload } = useLoad(() => Promise.all([
    q<Row>(sb.from("suppliers").select("*, onboarder:profiles!suppliers_onboarded_by_fkey(full_name)").eq("id", id).single()),
    q(sb.from("onboarding_steps").select("*").eq("active", true).order("sort")),
    q(sb.from("supplier_onboarding").select("*, profiles(full_name)").eq("supplier_id", id)),
    q(sb.from("reminders").select("*").eq("supplier_id", id).order("next_due")),
    q(sb.from("deals").select("id, deal_no, deal_date, po_no, cancelled").eq("supplier_id", id).order("deal_date", { ascending: false }).limit(10)),
    can("money_view") ? q(sb.from("v_payment_holds").select("*").eq("supplier_id", id).neq("status", "cleared")) : Promise.resolve([] as Row[]),
  ]), [id]);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [sup, steps, done, reminders, deals, holds] = data;
  const domestic = sup.supplier_type === "domestic";
  const doneOf = (code: string) => done.find((x) => x.step === code);
  const left = steps.filter((x) => x.required && !(tick[x.code] ?? !!doneOf(x.code))).length;
  const typeName = SUPPLIER_TYPES.find((x) => x[0] === sup.supplier_type);
  return (
    <>
      <button type="button" className="link back" onClick={() => history.back()}>← {t("Back", "वापस")}</button>
      <div className="page-head">
        <div><h1>{sup.name}</h1><p className="muted">{typeName ? t(typeName[1], typeName[2]) : sup.supplier_type} · {sup.gstin ?? "—"} · {sup.state ?? "—"}</p></div>
        {sup.onboarded_at ? <Chip tone="ok">{t("Onboarded", "ऑनबोर्ड")}</Chip> : <Chip tone="wait">{t("Not onboarded", "ऑनबोर्ड नहीं")}</Chip>}
      </div>
      <Err error={s.error} />

      <Section title={t("Onboarding", "ऑनबोर्डिंग")}>
        {sup.onboarded_at && <p className="notice ok-notice">{t("Onboarded on", "ऑनबोर्ड हुआ")} {day(sup.onboarded_at)}{sup.onboarder?.full_name ? ` · ${sup.onboarder.full_name}` : ""}</p>}
        {steps.length === 0
          ? <p className="muted small">{t("The onboarding steps are not set yet.", "ऑनबोर्डिंग के कदम अभी तय नहीं हैं।")}{can("admin") && <> <a href="#/admin/onboarding">{t("Set them in Admin.", "एडमिन में तय करें।")}</a></>}</p>
          : <ul className="checklist">{steps.map((x) => {
              const d = doneOf(x.code);
              return (
                <li key={x.code}>
                  <label className="check">
                    <input type="checkbox" checked={tick[x.code] ?? !!d} disabled={!can("supplier_onboard") || !!sup.onboarded_at}
                      onChange={(e) => { const v = e.target.checked; setTick({ ...tick, [x.code]: v });
                        s.run(async () => { try { await rpc("set_onboarding_step", { p_supplier: id, p_step: x.code, p_done: v }); } catch (err) { setTick((m) => { const n = { ...m }; delete n[x.code]; return n; }); throw err; } }, reload); }} />
                    <span>{nm(lang, x)}{!x.required && <span className="muted small"> ({t("optional", "वैकल्पिक")})</span>}
                      {d && <span className="muted small"> · {day(d.done_at)}{d.profiles?.full_name ? ` · ${d.profiles.full_name}` : ""}</span>}</span>
                  </label>
                </li>);
            })}</ul>}
        {can("supplier_onboard") && (
          <div className="actions">
            {!sup.onboarded_at
              ? <Btn kind="primary" disabled={s.busy || left > 0} onClick={() => s.run(() => rpc("set_supplier_onboarded", { p_supplier: id, p_onboarded: true }), reload, ["Supplier onboarded", "सप्लायर ऑनबोर्ड हुआ"])}>
                  {left > 0 ? `${left} ${t("steps left", "कदम बाकी")}` : t("Mark as onboarded", "ऑनबोर्ड हुआ")}</Btn>
              : <Btn disabled={s.busy} onClick={() => { if (confirm(t("Reopen onboarding for this supplier?", "इस सप्लायर की ऑनबोर्डिंग फिर खोलें?"))) s.run(() => rpc("set_supplier_onboarded", { p_supplier: id, p_onboarded: false }), reload); }}>
                  {t("Reopen onboarding", "ऑनबोर्डिंग फिर खोलें")}</Btn>}
          </div>)}
      </Section>

      <Section title={t("Reminders", "रिमाइंडर")} right={can("supplier_onboard") ? <Btn small onClick={() => setRem({})}>+ {t("Reminder", "रिमाइंडर")}</Btn> : undefined}>
        {reminders.length === 0 ? <Empty>{t("No reminders. Add one for anything that repeats: KYC renewal, agreement, visit.", "कोई रिमाइंडर नहीं। जो बार-बार होता है उसके लिए जोड़ें: KYC, एग्रीमेंट, विज़िट।")}</Empty> : (
          <ul className="rows">{reminders.map((r) => {
            const due = r.active && r.next_due <= today();
            const unit = UNITS.find((u) => u[0] === r.every_unit);
            return (
              <li key={r.id} className={!r.active ? "off" : due ? "edge-bad" : "edge-info"}><div className="row static">
                <span className="row-main"><strong>{r.title}</strong>
                  <span className="muted small">{Number(r.every_n) === 1 && ONE[r.every_unit] ? t(...ONE[r.every_unit]) : <>{t("Every", "हर")} {r.every_n} {unit ? t(unit[1], unit[2]) : r.every_unit}</>} · {t("next", "अगला")} {day(r.next_due)} · {t(...((FOR.find((f) => f[0] === r.for_role) ?? [r.for_role, r.for_role, r.for_role]).slice(1) as [string, string]))}{r.note ? ` · ${r.note}` : ""}</span></span>
                <span className="actions tight">
                  {due && <Btn small kind="primary" disabled={s.busy} onClick={() => s.run(() => rpc("complete_reminder", { p_id: r.id }), reload, ["Done. Next one is scheduled.", "हो गया। अगला तय है।"])}>{t("Done", "हो गया")}</Btn>}
                  {can("supplier_onboard") && <Btn small onClick={() => setRem(r)}>{t("Edit", "बदलें")}</Btn>}
                </span>
              </div></li>);
          })}</ul>)}
      </Section>

      {domestic && can("money_view") && (
        <Section title={t("Payment terms", "पेमेंट शर्तें")} right={(can("deal_edit") || can("admin")) ? <Btn small onClick={() => setTerms(true)}>{t("Change", "बदलें")}</Btn> : undefined}>
          <KV rows={[
            [t("Terms", "शर्तें"), <TermsLine key="t" pct={sup.provisional_pct} pdays={sup.provisional_days} bdays={sup.balance_days} />],
            [t("Hold", "रोक"), sup.hold_pct == null ? "—" : `${sup.hold_pct}% · ${sup.hold_days ?? 0} ${t("days", "दिन")} · ${sup.hold_scope === "supplier" ? t("all bills together", "सभी बिल मिलाकर") : t("each lot", "हर लॉट")}`],
          ]} />
          {holds.map((h) => <HoldHint key={h.scope + h.ref_id} h={h} />)}
          <div className="actions"><Btn small onClick={() => go("payables/suppliers")}>{t("Ledger", "लेजर")}</Btn></div>
        </Section>)}

      <Section title={t("Deals", "सौदे")}>
        {deals.length === 0 ? <Empty>{t("No deals yet.", "अभी कोई सौदा नहीं।")}</Empty> : (
          <ul className="rows">{deals.map((d) => (
            <li key={d.id} className={d.cancelled ? "off" : ""}><button type="button" className="row" onClick={() => go(`deal/${d.id}`)}>
              <span className="row-main"><strong>{d.deal_no}{d.po_no ? ` · ${d.po_no}` : ""}</strong><span className="muted small">{day(d.deal_date)}</span></span></button></li>))}
          </ul>)}
      </Section>
      {(can("deal_edit") || can("admin")) && <div className="actions"><Btn onClick={() => setEdit(true)}>{t("Edit supplier details", "सप्लायर की जानकारी बदलें")}</Btn></div>}

      {terms && <TermsSheet table="suppliers" id={id} row={sup} onClose={() => setTerms(false)} onSaved={reload} />}
      {edit && <SupplierSheet row={sup} onClose={() => setEdit(false)} onSaved={reload} />}
      {rem && <ReminderSheet supplierId={id} row={rem} onClose={() => setRem(null)} onSaved={reload} />}
    </>
  );
}

function ReminderSheet({ supplierId, row, onClose, onSaved }: { supplierId: string; row: Row; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ title: row.title ?? "", note: row.note ?? "", n: String(row.every_n ?? 1), unit: row.every_unit ?? "year",
    due: row.next_due ?? addDays(today(), 30), who: row.for_role ?? "owner", active: row.active === false ? "no" : "yes" });
  const s = useSave();
  return (
    <Sheet title={row.id ? row.title : t("New reminder", "नया रिमाइंडर")} onClose={onClose} footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")} onSave={() => s.run(async () => {
      if (!f.title.trim()) throw new Error(t("Say what to be reminded of.", "किस बात का रिमाइंडर, लिखें।"));
      if (!isNum(f.n) || Number(f.n) < 1) throw new Error(t("How often?", "कितनी बार?"));
      const rec = { supplier_id: supplierId, title: f.title.trim(), note: f.note.trim() || null, every_n: Number(f.n), every_unit: f.unit, next_due: f.due, for_role: f.who, active: f.active === "yes" };
      await q(row.id ? sb.from("reminders").update(rec).eq("id", row.id) : sb.from("reminders").insert(rec));
    }, () => { onSaved(); onClose(); })} />}>
      <Field label={t("Remind about", "किस बात का")}><TextIn value={f.title} onValue={(v) => setF({ ...f, title: v })} placeholder={t("e.g. Renew KYC", "जैसे KYC दोबारा")} /></Field>
      <div className="grid2">
        <Field label={t("Every", "हर")}><NumIn value={f.n} onChange={(v) => setF({ ...f, n: v })} /></Field>
        <Field label={t("Unit", "इकाई")}><Select value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={UNITS.map(([v, en, hi]) => ({ value: v, label: t(en, hi) }))} /></Field>
        <Field label={t("First / next date", "पहली / अगली तारीख")}><DateIn value={f.due} onChange={(v) => setF({ ...f, due: v })} futureOnly /></Field>
        <Field label={t("Alert", "किसे बताएँ")}><Select value={f.who} onChange={(v) => setF({ ...f, who: v })} options={FOR.map(([v, en, hi]) => ({ value: v, label: t(en, hi) }))} /></Field>
      </div>
      <Field label={t("Note (optional)", "नोट (वैकल्पिक)")}><TextIn value={f.note} onValue={(v) => setF({ ...f, note: v })} /></Field>
      {row.id && <Field label={t("On", "चालू")}><Select value={f.active} onChange={(v) => setF({ ...f, active: v })} options={[{ value: "yes", label: t("Yes", "हाँ") }, { value: "no", label: t("Switched off", "बंद") }]} /></Field>}
      <p className="muted small">{t("On the due date it appears on that person's Home page until it is marked done; then the next date is set.", "तय तारीख पर यह उस व्यक्ति के होम पेज पर दिखेगा, जब तक 'हो गया' न दबाएँ; फिर अगली तारीख अपने आप तय होगी।")}</p>
    </Sheet>
  );
}
