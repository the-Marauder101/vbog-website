import { addDays, day, go, inr, inrShort, kg, nm, q, rpc, sb, today, useCan, useLang, useLoad, useMe, useT, type Row } from "../lib";
import { Btn, Empty, Err, Loading, Section } from "../ui";
import { PriceDecisions, useSave } from "../common";
import { useEffect, useState } from "react";
import { canPrompt, isInstalled, isIos, onInstallChange, promptInstall } from "../pwa";

const KINDS: Record<string, { en: string; hi: string; to: (r: Row) => string }> = {
  hold_release: { en: "Held payments now due: pay the balance", hi: "रोकी रकम अब देनी है", to: (r) => (r.ref_type === "lot" ? `lot/${r.ref_id}/pay` : `supplier/${r.ref_id}`) },
  hold_reached: { en: "Payment limit reached: hold the rest", hi: "भुगतान सीमा पूरी: बाकी रोकें", to: (r) => (r.ref_type === "lot" ? `lot/${r.ref_id}/pay` : `supplier/${r.ref_id}`) },
  machine_due: { en: "Machine payments due", hi: "मशीन का पेमेंट देना है", to: () => "payables/machines" },
  transport_bill_diff: { en: "Transport bill differs from the booking", hi: "ट्रांसपोर्ट बिल बुकिंग से अलग", to: () => "lots/transport" },
  price_to_fix: { en: "Open prices to fix", hi: "खुले रेट तय करने हैं", to: (r) => `lot/${r.ref_id}` },
  po_missing: { en: "Booked: issue the PO", hi: "बुक हुआ: PO जारी करें", to: (r) => `deal/${r.ref_id}` },
  supplier_onboard: { en: "Suppliers not onboarded", hi: "सप्लायर ऑनबोर्ड नहीं", to: (r) => `supplier/${r.ref_id}` },
  rate_confirm: { en: "Trucks that came without a booking: confirm the rate", hi: "बिना बुकिंग आए ट्रक: रेट पक्का करें", to: (r) => `deal/${r.ref_id}` },
  arrival_late: { en: "Booked supplies that are late", hi: "देर से आने वाला बुक माल", to: (r) => `deal/${r.ref_id}` },
  sorting_open: { en: "Lots to sort", hi: "छँटाई करनी है", to: (r) => `lot/${r.ref_id}/sorting` },
  dn_pending: { en: "Debit notes to approve", hi: "डेबिट नोट मंज़ूर करने हैं", to: (r) => `lot/${r.ref_id}/dn` },
  doc_verify: { en: "Documents to verify", hi: "दस्तावेज़ जाँचने हैं", to: (r) => `deal/${r.ref_id}` },
  doc_approve: { en: "Documents to approve", hi: "दस्तावेज़ मंज़ूर करने हैं", to: (r) => `deal/${r.ref_id}` },
  tally_changed: { en: "Changed after Tally entry: correct in Tally", hi: "टैली के बाद बदला: टैली में सुधारें", to: (r) => `tally/${r.detail}` },
  tally_factory: { en: "Enter in factory Tally", hi: "फैक्ट्री टैली में दर्ज करें", to: () => "tally/factory" },
  tally_office: { en: "Enter in office Tally", hi: "ऑफिस टैली में दर्ज करें", to: () => "tally/office" },
  payment_reco: { en: "Payments to reconcile", hi: "पेमेंट का मिलान करना है", to: () => "payables/payments" },
  payment_fix: { en: "Payments sent back to you", hi: "वापस भेजे गए पेमेंट", to: () => "payables/payments" },
  gst_2b: { en: "Invoices not seen in GSTR-2B", hi: "GSTR-2B में नहीं दिखे बिल", to: () => "payables/gst2b" },
  ledger_confirm: { en: "Supplier ledgers to confirm", hi: "सप्लायर लेजर मिलाने हैं", to: () => "payables/suppliers" },
  terms_missing: { en: "Suppliers without payment terms", hi: "पेमेंट शर्तें नहीं डाली", to: () => "admin/suppliers" },
};
const ORDER = Object.keys(KINDS);

export default function Home() {
  const t = useT(); const me = useMe(); const can = useCan(); const lang = useLang();
  const { data, error, reload } = useLoad(() => Promise.all([
    q(sb.from("v_tasks").select("*").order("since", { ascending: true, nullsFirst: false })),
    can("money_view") ? q(sb.from("v_cash_plan").select("due_date,amount")) : Promise.resolve([] as Row[]),
    can("deal_edit") ? q(sb.from("v_stock_position").select("*").order("sort")) : Promise.resolve([] as Row[]),
    q(sb.from("v_lots").select("lot_id, invoice_no")),
  ]), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [tasks, cash, position, lotInv] = data;
  const invOf = Object.fromEntries(lotInv.map((l) => [l.lot_id, l.invoice_no]));   // the supplier's invoice no. first, ours beside it
  const reminders = tasks.filter((x) => x.kind === "reminder_due");
  const groups = ORDER.map((k) => ({ k, rows: tasks.filter((x) => x.kind === k) })).filter((g) => g.rows.length);
  const now = today(); const week = addDays(now, 7);
  const overdue = cash.filter((c) => c.due_date < now).reduce((a, c) => a + Number(c.amount), 0);
  const soon = cash.filter((c) => c.due_date >= now && c.due_date <= week).reduce((a, c) => a + Number(c.amount), 0);
  return (
    <>
      <h1>{t("Namaste", "नमस्ते")}, {me.full_name.split(" ")[0]}</h1>
      <div className="quick">
        {can("deal_edit") && <Btn onClick={() => go("lots/new")}>+ {t("New deal", "नया सौदा")}</Btn>}
        {can("inward_edit") && <Btn onClick={() => go("lots")}>{t("Material arrived", "माल आया")}</Btn>}
        {can("production_edit") && <Btn onClick={() => go("stock/production")}>+ {t("Production", "उत्पादन")}</Btn>}
        {can("payment_enter") && <Btn onClick={() => go("payables/new")}>+ {t("Payment", "पेमेंट")}</Btn>}
      </div>
      {can("money_view") && (
        <button type="button" className="cashcard" onClick={() => go("payables/topay")}>
          <span><small>{t("Overdue", "बकाया")}</small><strong className={overdue > 0 ? "bad" : ""}>{inrShort(overdue)}</strong></span>
          <span><small>{t("Due in 7 days", "7 दिन में देना")}</small><strong>{inrShort(soon)}</strong></span>
          <span className="go">{t("Payables", "देनदारी")} ›</span>
        </button>
      )}
      <InstallCard />
      {position.length > 0 && <PositionCard rows={position} />}
      <Section title={t("Your work", "आपका काम")}>
        {reminders.length > 0 && <Reminders rows={reminders} onDone={reload} />}
        {tasks.some((x) => x.kind === "price_decide") && <PriceDecisions title />}
        {groups.length === 0 && !reminders.length && !tasks.some((x) => x.kind === "price_decide") && <Empty>{t("Nothing waiting for you.", "आपके लिए कुछ बाकी नहीं।")}</Empty>}
        {groups.map(({ k, rows }) => (
          <div key={k} className="task-group">
            <h3 className="sub">{t(KINDS[k].en, KINDS[k].hi)} <span className="count">{rows.length}</span></h3>
            <ul className="rows">
              {rows.slice(0, 6).map((r, i) => (
                <li key={i}><button type="button" className="row" onClick={() => go(KINDS[k].to(r))}>
                  <span className="row-main">
                    <strong>{r.ref_type === "lot" && invOf[r.ref_id] ? invOf[r.ref_id] : r.ref_no || r.supplier}</strong>
                    <span className="muted small">{r.ref_type === "lot" && invOf[r.ref_id] ? `${r.ref_no} · ` : ""}{k === "hold_reached" ? [r.ref_no ? r.supplier : null, `${t("hold until", "तक रोकें")} ${day(r.detail)}`].filter(Boolean).join(" · ")
                      : [r.ref_no ? r.supplier : null, lang === "hi" && r.detail_hi ? r.detail_hi : r.detail, r.since ? day(r.since) : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  {r.amount != null && <span className="amt">{inr(r.amount)}</span>}
                </button></li>
              ))}
            </ul>
            {rows.length > 6 && <p className="muted small">+ {rows.length - 6} {t("more", "और")}</p>}
          </div>
        ))}
      </Section>
    </>
  );
}

// Due reminders: one tap marks done and schedules the next one.
function Reminders({ rows, onDone }: { rows: Row[]; onDone: () => void }) {
  const t = useT(); const s = useSave();
  return (
    <div className="task-group">
      <h3 className="sub">{t("Reminders", "रिमाइंडर")} <span className="count">{rows.length}</span></h3>
      <ul className="rows">{rows.map((r) => (
        <li key={r.ref_id} className="edge-bad"><div className="row static">
          <span className="row-main"><strong>{r.ref_no}</strong><span className="muted small">{[r.supplier, r.detail, `${t("due", "तारीख")} ${day(r.since)}`].filter(Boolean).join(" · ")}</span></span>
          <Btn small kind="primary" disabled={s.busy} onClick={() => s.run(() => rpc("complete_reminder", { p_id: r.ref_id }), onDone, ["Done. Next one is scheduled.", "हो गया। अगला तय है।"])}>{t("Done", "हो गया")}</Btn>
        </div></li>))}
      </ul>
      {s.error && <p className="error small">{s.error}</p>}
    </div>
  );
}

// Where the metal is: in the factory, in production, booked and still to come
function PositionCard({ rows }: { rows: Row[] }) {
  const t = useT(); const lang = useLang();
  const main = rows.filter((r) => r.kind === "raw" || r.kind === "finished").slice(0, 5);
  if (!main.length) return null;
  return (
    <button type="button" className="poscard" onClick={() => go("stock")}>
      <span className="poscard-head"><strong>{t("Stock position", "स्टॉक स्थिति")}</strong><span className="go">{t("Stock", "स्टॉक")} ›</span></span>
      <table className="tbl compact">
        <thead><tr><th></th><th className="n">{t("In factory", "फ़ैक्टरी में")}</th><th className="n">{t("In production", "उत्पादन में")}</th><th className="n">{t("Booked", "बुक")}</th></tr></thead>
        <tbody>{main.map((r) => <tr key={r.item}><td>{nm(lang, r)}</td><td className="n">{kg(r.in_factory)}</td>
          <td className="n">{Number(r.in_production) ? kg(r.in_production) : "—"}</td><td className="n">{Number(r.booked) ? kg(r.booked) : "—"}</td></tr>)}</tbody>
      </table>
    </button>
  );
}

// Install the app on this phone: Android/Chrome gets a button; iPhone gets the two taps in Safari.
function InstallCard() {
  const t = useT();
  const [, tick] = useState(0);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("installHidden") === "1"; } catch { return false; } });
  useEffect(() => onInstallChange(() => tick((n) => n + 1)), []);
  if (hidden || isInstalled() || (!canPrompt() && !isIos())) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem("installHidden", "1"); } catch { /* private mode */ } };
  return (
    <div className="notice install-card">
      <strong>{t("Use it as an app", "इसे ऐप की तरह इस्तेमाल करें")}</strong>
      <p className="small">{canPrompt()
        ? t("Install Rich Alloys on this phone: it opens from its own icon, full screen.", "Rich Alloys को इस फ़ोन पर इंस्टॉल करें: अपने आइकन से, पूरी स्क्रीन पर खुलेगा।")
        : t("In Safari, tap Share (the square with an arrow) and then 'Add to Home Screen'.", "Safari में शेयर (तीर वाला चौकोर) दबाएँ, फिर 'Add to Home Screen'।")}</p>
      <div className="actions">
        {canPrompt() && <Btn small kind="primary" onClick={() => promptInstall()}>{t("Install app", "ऐप इंस्टॉल करें")}</Btn>}
        <Btn small onClick={hide}>{t("Not now", "अभी नहीं")}</Btn>
      </div>
    </div>
  );
}
