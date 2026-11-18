import { useEffect, useState } from "react";
import { api } from "./api";
import type { Key } from "./i18n";
import type { Deal } from "./types";

export default function Deals({ t, onOpen }: { t: (k: Key) => string; onOpen: (d: Deal) => void }) {
  const [data, setData] = useState<{ deals: Deal[]; gaps: Record<string, number> } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { api.deals().then(setData).catch((e: Error) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">{t("loading")}</p>;

  return (
    <>
      <h1>{t("deals")}</h1>
      {data.deals.length === 0 && <p className="muted">{t("noDeals")}</p>}
      <ul className="rows">
        {data.deals.map((d) => {
          const n = data.gaps[d.deal_no] ?? 0;
          return (
            <li key={d.id}>
              <button className="row deal" onClick={() => onOpen(d)}>
                <span className="row-main">
                  <strong className="deal-no">{d.deal_no}</strong>
                  <span>{d.suppliers?.name}</span>
                  <span className="muted small">{d.po_no} · {d.deal_date}</span>
                  <span className={n ? "chip missing" : "chip approved"}>{n ? `${n} ${t("pending")}` : t("allDone")}</span>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
