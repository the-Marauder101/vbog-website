// Payables (PRD 7.7): per supplier, then bill by bill. Overdue first.
import { useState } from "react";
import { payables } from "./data";
import { day, inr } from "./format";
import type { Key } from "./i18n";
import { Err, KV, useLoad } from "./ui";

export default function Payables({ t, onOpenDeal }: { t: (k: Key) => string; onOpenDeal: (dealId: string) => void }) {
  const d = useLoad(payables, []);
  const [open, setOpen] = useState<string | null>(null);
  if (d.error) return <><h1>{t("payables")}</h1><Err msg={d.error} /><button className="btn" onClick={d.reload}>{t("retry")}</button></>;
  if (!d.data) return <p className="muted">{t("loading")}</p>;
  const { suppliers, bills, total } = d.data;

  return (
    <>
      <h1>{t("payables")}</h1>
      <section className="card block totals">
        <KV k={t("totalPayable")} v={inr(total.balance)} strong />
        <KV k={t("overdue")} v={inr(total.overdue_balance)} tone={Number(total.overdue_balance) > 0 ? "bad" : "ok"} />
      </section>
      {suppliers.length === 0 && <p className="muted">{t("noPayables")}</p>}
      <ul className="rows">
        {suppliers.map((s) => {
          const isOpen = open === s.supplier_id;
          const overdue = Number(s.overdue_balance) > 0;
          return (
            <li key={s.supplier_id} className={overdue ? "state-rejected" : Number(s.balance) > 0 ? "state-uploaded" : "state-approved"}>
              <button className="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.supplier_id)}>
                <span className="row-main">
                  <strong>{s.supplier}</strong>
                  <span className="num">{inr(s.balance)}</span>
                  <span className="muted small">{t("bills")}: {s.bills}{s.next_due ? ` · ${t("nextDue")} ${day(s.next_due)}` : ""}</span>
                  {overdue && <span className="chip rejected">{t("overdue")} {inr(s.overdue_balance)} · {s.max_days_overdue} {t("days")}</span>}
                </span>
                <span className="chev" aria-hidden="true">{isOpen ? "⌃" : "›"}</span>
              </button>
              {isOpen && (
                <div className="detail">
                  {bills.filter((b) => b.supplier_id === s.supplier_id).map((b) => (
                    <button key={b.invoice_id} className="bill" onClick={() => onOpenDeal(b.deal_id)}>
                      <span><strong>{b.deal_no}</strong> · {b.invoice_no}</span>
                      <span className="num">{inr(b.balance)}</span>
                      <span className="muted small">
                        {t("dueDate")} {b.due_date ? day(b.due_date) : t("notSet")}
                        {b.days_overdue > 0 && <span className="bad-text"> · {t("overdueBy")} {b.days_overdue} {t("days")}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
