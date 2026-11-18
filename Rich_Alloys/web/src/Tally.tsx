// Tally export and reconciliation (PRD 7.8). Tally is the book of record: the portal exports what Niti
// enters, then shows what is not yet in Tally and any sign of a double payment.
import { useState } from "react";
import { markExported, setPaymentInTally, setTallyNo, tally, type TallyExportRow, type TallyPending } from "./data";
import { day, inr, today } from "./format";
import type { Key } from "./i18n";
import { Err, Ok, TxtIn, useLoad, useSaver } from "./ui";

type T = (k: Key) => string;

function csv(rows: TallyExportRow[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));   // BOM: Excel reads ₹ and Hindi
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Tally({ t }: { t: T }) {
  const d = useLoad(tally, []);
  const s = useSaver();
  if (d.error) return <><h1>{t("tally")}</h1><Err msg={d.error} /><button className="btn" onClick={d.reload}>{t("retry")}</button></>;
  if (!d.data) return <p className="muted">{t("loading")}</p>;
  const { pending, doubles, exportRows } = d.data;
  const dns = pending.filter((p) => p.kind === "debit_note");
  const pays = pending.filter((p) => p.kind === "payment");
  const toExport = dns.filter((x) => x.status === "approved");

  return (
    <>
      <h1>{t("tally")}</h1>

      <section className="card block">
        <h2>{t("dnsForTally")}</h2>
        <p className="muted small">{t("dnsForTallyHint")}</p>
        {dns.length === 0 && <p className="okline">✓ {t("allDnsBooked")}</p>}
        {dns.length > 0 && (
          <div className="actions">
            <button className="btn primary" disabled={!exportRows.length}
              onClick={() => download(`tally_debit_notes_${today()}.csv`, csv(exportRows))}>{t("downloadCsv")}</button>
            {toExport.length > 0 && (
              <button className="btn" disabled={s.busy}
                onClick={async () => { if (await s.run(() => markExported(toExport.map((x) => x.id)), t("saved"))) d.reload(); }}>
                {t("markExported")} ({toExport.length})
              </button>
            )}
          </div>
        )}
        {dns.map((x) => <DnRow key={x.id} t={t} x={x} onSaved={d.reload} />)}
      </section>

      <section className="card block">
        <h2>{t("paymentsForTally")}</h2>
        {pays.length === 0 && <p className="okline">✓ {t("allPaymentsInTally")}</p>}
        {pays.map((p) => (
          <div key={p.id} className="money-row">
            <div>
              <strong>{inr(p.amount)}</strong> · {p.party}
              <div className="muted small">{p.deal_no} · {t(`pay_${p.detail}` as Key)} · {day(p.on_date)}{p.ref ? ` · ${p.ref}` : ""}</div>
            </div>
            <button className="btn" disabled={s.busy}
              onClick={async () => { if (await s.run(() => setPaymentInTally(p.id, true), t("saved"))) d.reload(); }}>{t("markInTally")}</button>
          </div>
        ))}
      </section>

      <section className="card block">
        <h2>{t("doubleCheck")}</h2>
        {doubles.length === 0
          ? <p className="okline">✓ {t("noDoubles")}</p>
          : doubles.map((x, i) => (
            <div key={i} className="warn-row">
              <strong>{t(`dbl_${x.issue}` as Key)}</strong> · {inr(x.amount)}
              <div className="small">{x.supplier} · {x.deal_no}{x.invoice_no ? ` · ${x.invoice_no}` : ""}{x.bank_ref ? ` · ${x.bank_ref}` : ""}</div>
            </div>
          ))}
      </section>
      <Err msg={s.error} /><Ok msg={s.done} />
    </>
  );
}

function DnRow({ t, x, onSaved }: { t: T; x: TallyPending; onSaved: () => void }) {
  const [no, setNo] = useState("");
  const s = useSaver();
  return (
    <div className="money-row wrap">
      <div>
        <strong>{inr(x.amount)}</strong> · {x.party}
        <div className="muted small">{x.deal_no} · {t(`dn_${x.detail}` as Key)} · {day(x.on_date)} · {t(`dns_${x.status}` as Key)}</div>
      </div>
      <div className="inline-form">
        <TxtIn label={t("tallyDnNo")} value={no} onChange={setNo} upper />
        <button className="btn primary" disabled={s.busy || !no.trim()}
          onClick={async () => { if (await s.run(() => setTallyNo(x.id, no))) onSaved(); }}>{t("save")}</button>
      </div>
      <Err msg={s.error} />
    </div>
  );
}
