import { useEffect, useState } from "react";
import { api } from "./api";
import type { Key } from "./i18n";
import type { Deal } from "./types";
import { day } from "./format";

export default function Deals({ t, onOpen, onNew }: { t: (k: Key) => string; onOpen: (d: Deal) => void; onNew?: () => void }) {
  const [data, setData] = useState<{ deals: Deal[]; gaps: Record<string, number> } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => { api.deals().then(setData).catch((e: Error) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">{t("loading")}</p>;

  const needle = q.trim().toLowerCase();
  const shown = data.deals.filter((d) =>
    (showClosed || !["closed", "cancelled"].includes(d.status)) &&
    (!needle || [d.deal_no, d.po_no, d.suppliers?.name].some((x) => x?.toLowerCase().includes(needle))));
  const hidden = data.deals.length - data.deals.filter((d) => !["closed", "cancelled"].includes(d.status)).length;

  return (
    <>
      <h1>{t("deals")}</h1>
      {onNew && <button className="btn primary wide" onClick={onNew}>+ {t("newDeal")}</button>}
      {data.deals.length > 3 && (
        <label className="fld search"><span className="sr-only">{t("search")}</span>
          <input type="search" placeholder={t("searchDeals")} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {data.deals.length === 0 && <p className="muted">{t("noDeals")}</p>}
      <ul className="rows">
        {shown.map((d) => {
          const n = data.gaps[d.deal_no] ?? 0;
          return (
            <li key={d.id}>
              <button className="row deal" onClick={() => onOpen(d)}>
                <span className="row-main">
                  <strong className="deal-no">{d.deal_no}</strong>
                  <span>{d.suppliers?.name}</span>
                  <span className="muted small">{d.po_no ? `${d.po_no} · ` : ""}{day(d.deal_date)}</span>
                  <span className="chips">
                    <span className="chip role">{t(`st_${d.status}` as Key)}</span>
                    <span className={n ? "chip missing" : "chip approved"}>{n ? `${n} ${t("pending")}` : t("allDone")}</span>
                  </span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <button className="link" onClick={() => setShowClosed(!showClosed)}>{showClosed ? t("hideClosed") : `${t("showClosed")} (${hidden})`}</button>}
    </>
  );
}
