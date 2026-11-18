import { useState } from "react";
import { addDays, day, go, inr, inrShort, q, sb, today, useLoad, useT, type Row } from "../lib";
import { Chip, Empty, Err, Loading, Section } from "../ui";

export default function Cash() {
  const t = useT();
  const [weeks, setWeeks] = useState(8);
  const { data, error } = useLoad(() => q(sb.from("v_cash_plan").select("*").order("due_date")), []);
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const now = today();
  const buckets: { key: string; label: string; from: string; to: string; rows: Row[] }[] = [
    { key: "over", label: t("Overdue", "बकाया"), from: "0000-01-01", to: addDays(now, -1), rows: [] },
  ];
  for (let i = 0; i < weeks; i++) {
    const from = addDays(now, i * 7); const to = addDays(now, i * 7 + 6);
    buckets.push({ key: `w${i}`, label: i === 0 ? t("Next 7 days", "अगले 7 दिन") : `${day(from).replace(/ \d{4}$/, "")} – ${day(to).replace(/ \d{4}$/, "")}`, from, to, rows: [] });
  }
  const later: Row[] = [];
  for (const r of data) { const b = buckets.find((x) => r.due_date >= x.from && r.due_date <= x.to); if (b) b.rows.push(r); else later.push(r); }
  const sum = (rows: Row[]) => rows.reduce((a, r) => a + Number(r.amount), 0);
  const max = Math.max(1, ...buckets.map((b) => sum(b.rows)));
  const total = sum(data);
  const missing = new Set(data.filter((r) => r.terms_missing).map((r) => r.supplier));
  return (
    <>
      <h1>{t("Cash needed", "कितना कैश चाहिए")}</h1>
      <div className="stats">
        <div><small>{t("Overdue", "बकाया")}</small><strong className={sum(buckets[0].rows) > 0 ? "bad" : ""}>{inrShort(sum(buckets[0].rows))}</strong></div>
        <div><small>{t("Next 7 days", "अगले 7 दिन")}</small><strong>{inrShort(sum(buckets[1]?.rows ?? []))}</strong></div>
        <div><small>{t(`Next ${weeks} weeks`, `अगले ${weeks} हफ़्ते`)}</small><strong>{inrShort(buckets.reduce((a, b) => a + sum(b.rows), 0))}</strong></div>
        <div><small>{t("All open", "कुल बाकी")}</small><strong>{inrShort(total)}</strong></div>
      </div>
      <div className="filters">{[4, 8, 12].map((w) => <button key={w} type="button" className={weeks === w ? "on" : ""} onClick={() => setWeeks(w)}>{w} {t("weeks", "हफ़्ते")}</button>)}</div>
      <div className="bars" role="img" aria-label={t("Cash needed by week", "हफ़्तेवार कैश")}>
        {buckets.map((b) => (
          <div key={b.key} className={`barrow ${b.key === "over" ? "over" : ""}`}>
            <span className="bl">{b.label}</span>
            <span className="bt"><span style={{ width: `${(sum(b.rows) / max) * 100}%` }} /></span>
            <span className="bv">{sum(b.rows) ? inrShort(sum(b.rows)) : "—"}</span>
          </div>
        ))}
      </div>
      {missing.size > 0 && <p className="warnbox">{t("No payment terms for", "पेमेंट शर्तें नहीं")}: {[...missing].join(", ")}. {t("Their full amount is shown on the invoice or arrival date.", "पूरी रकम बिल या आगमन तारीख पर दिखाई है।")} <a href="#/admin/suppliers">{t("Set terms", "शर्तें डालें")}</a></p>}
      <p className="muted small">{t("Includes received lots (invoice less debit notes, TDS and payments) and deals still on the way (remaining quantity × agreed rate + GST).", "इसमें आए हुए लॉट (बिल घटा डेबिट नोट, TDS और भुगतान) और रास्ते वाले सौदे (बाकी मात्रा × तय रेट + GST) शामिल हैं।")}</p>
      {[...buckets, { key: "later", label: t("Later", "बाद में"), from: "", to: "", rows: later }].filter((b) => b.rows.length).map((b) => (
        <Section key={b.key} title={b.label} right={<strong>{inr(sum(b.rows))}</strong>}>
          <ul className="rows">{b.rows.map((r, i) => (
            <li key={i} className={r.source === "incoming" ? "edge-info" : ""}>
              <button type="button" className="row" onClick={() => go(r.lot_id ? `lot/${r.lot_id}/pay` : `deal/${r.deal_id}`)}>
                <span className="row-main"><strong>{r.supplier}</strong>
                  <span className="muted small">{r.lot_no ?? r.deal_no} · {r.source === "incoming" ? t("on the way", "रास्ते में") : t("received", "आया")} · {r.tranche === "provisional" ? t("provisional", "प्रोविजनल") : r.tranche === "balance" ? t("balance", "बाकी") : t("full", "पूरा")} · {day(r.due_date)}</span>
                  {r.terms_missing && <Chip tone="bad">{t("terms not set", "शर्तें नहीं")}</Chip>}
                </span>
                <span className="amt">{inr(r.amount)}</span>
              </button></li>))}
          </ul>
        </Section>
      ))}
      {data.length === 0 && <Empty>{t("Nothing to pay.", "कुछ देना बाकी नहीं।")}</Empty>}
    </>
  );
}
