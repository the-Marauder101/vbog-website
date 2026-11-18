// One deal, four tabs, same header (PRD 9). The deal ID runs from phone deal to final payment.
import { useState } from "react";
import { api } from "./api";
import { dealFull, DEAL_STATUSES, setDealStatus, type DealFull, type DealStatus } from "./data";
import type { Key, Lang } from "./i18n";
import type { Deal, Profile } from "./types";
import { Err, useLoad, useSaver } from "./ui";
import { day, kg, rate } from "./format";
import DealDocs from "./DealDocs";
import Weights from "./Weights";
import DebitNotes from "./DebitNotes";
import PaymentTab from "./PaymentTab";

export type DealTab = "docs" | "weights" | "dns" | "pay";
const TABS: [DealTab, Key][] = [["docs", "tabDocs"], ["weights", "tabWeights"], ["dns", "tabDns"], ["pay", "tabPay"]];

export default function DealPage({ t, lang, deal, profile, tab: initial, onBack }: {
  t: (k: Key) => string; lang: Lang; deal: Deal; profile: Profile; tab?: DealTab; onBack: () => void;
}) {
  const [tab, setTab] = useState<DealTab>(initial ?? "docs");
  const full = useLoad<DealFull | null>(() => (api.demo ? Promise.resolve(null) : dealFull(deal.id)), [deal.id]);
  const save = useSaver();
  const d = full.data;

  return (
    <>
      <button className="link back" onClick={onBack}>← {t("back")}</button>
      <div className="deal-head">
        <h1 className="deal-no">{deal.deal_no}</h1>
        <p className="muted">{deal.suppliers?.name}{deal.po_no && <> · {deal.po_no}</>}</p>
        {d && (
          <>
            <p className="muted small">
              {day(d.deal_date)} · {d.deal_lines.map((l) => `${l.grade} ${kg(l.qty_kg)} @ ${rate(l.rate_per_kg)}`).join(" · ")}
            </p>
            <label className="status-pick">
              <span className="muted small">{t("dealStatus")}</span>
              <select value={d.status} disabled={save.busy} onChange={async (e) => {
                const s = e.target.value as DealStatus;
                if (await save.run(() => setDealStatus(d.id, s))) full.reload(); else full.reload();
              }}>
                {DEAL_STATUSES.map((s) => <option key={s} value={s}>{t(`st_${s}` as Key)}</option>)}
              </select>
            </label>
          </>
        )}
        <Err msg={save.error || full.error} />
      </div>

      <nav className="tabs deal-tabs" aria-label={t("dealSections")}>
        {TABS.map(([k, label]) => (
          <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{t(label)}</button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === "docs" && <DealDocs t={t} lang={lang} deal={deal} profile={profile} />}
        {tab !== "docs" && api.demo && <p className="notice">{t("demoOnlyDocs")}</p>}
        {tab !== "docs" && d && tab === "weights" && <Weights t={t} lang={lang} deal={d} />}
        {tab !== "docs" && d && tab === "dns" && <DebitNotes t={t} deal={d} />}
        {tab !== "docs" && d && tab === "pay" && <PaymentTab t={t} deal={d} />}
      </div>
    </>
  );
}
