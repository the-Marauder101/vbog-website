import { addDays, day, go, inr, inrShort, q, sb, today, useCan, useLang, useLoad, useMe, useT, type Row } from "../lib";
import { Btn, Empty, Err, Loading, Section } from "../ui";

const KINDS: Record<string, { en: string; hi: string; to: (r: Row) => string }> = {
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
  const { data, error } = useLoad(() => Promise.all([
    q(sb.from("v_tasks").select("*").order("since", { ascending: true, nullsFirst: false })),
    can("money_view") ? q(sb.from("v_cash_plan").select("due_date,amount")) : Promise.resolve([] as Row[]),
  ]), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [tasks, cash] = data;
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
      <Section title={t("Your work", "आपका काम")}>
        {groups.length === 0 && <Empty>{t("Nothing waiting for you.", "आपके लिए कुछ बाकी नहीं।")}</Empty>}
        {groups.map(({ k, rows }) => (
          <div key={k} className="task-group">
            <h3 className="sub">{t(KINDS[k].en, KINDS[k].hi)} <span className="count">{rows.length}</span></h3>
            <ul className="rows">
              {rows.slice(0, 6).map((r, i) => (
                <li key={i}><button type="button" className="row" onClick={() => go(KINDS[k].to(r))}>
                  <span className="row-main">
                    <strong>{r.ref_no || r.supplier}</strong>
                    <span className="muted small">{[r.ref_no ? r.supplier : null, lang === "hi" && r.detail_hi ? r.detail_hi : r.detail, r.since ? day(r.since) : null].filter(Boolean).join(" · ")}</span>
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
