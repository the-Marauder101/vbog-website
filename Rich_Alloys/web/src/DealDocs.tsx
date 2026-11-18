import { useCallback, useEffect, useState } from "react";
import { api, type DealDocsData, type DocAction } from "./api";
import type { Key, Lang } from "./i18n";
import { canApprove, canVerify, type Deal, type Doc, type DocStatus, type DocType, type Profile, type Side } from "./types";

type State = DocStatus | "missing";
const rank: Record<State, number> = { approved: 4, verified: 3, uploaded: 2, rejected: 1, missing: 0 };
const sides: Side[] = ["supplier", "rich_alloys", "return"];

export default function DealDocs({ t, lang, deal, profile, onBack }: {
  t: (k: Key) => string; lang: Lang; deal: Deal; profile: Profile; onBack: () => void;
}) {
  const [data, setData] = useState<DealDocsData | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () => api.dealDocs(deal.id).then(setData).catch((e: Error) => setError(e.message)),
    [deal.id],
  );
  useEffect(() => { load(); }, [load]);

  async function run(work: () => Promise<void>) {
    setError("");
    try { await work(); } catch (e) { setError((e as Error).message); }
    await load();
  }

  async function upload(type: DocType, files: FileList | null) {
    if (!files?.length) return;
    setBusy(type.code);
    await run(async () => { for (const f of Array.from(files)) await api.upload(deal, type.code, f, profile.id); });
    setBusy(null);
  }

  const act = (action: DocAction, doc: Doc, note?: string) => run(() => api.act(action, doc.id, note));
  // Open the tab inside the tap itself (phone browsers block tabs opened after a wait), then point it at the file.
  const view = (doc: Doc) => {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    return run(async () => {
      try {
        const url = await api.fileUrl(doc);
        if (tab) tab.location.href = url; else window.location.href = url;
      } catch (e) { tab?.close(); throw e; }
    });
  };

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">{t("loading")}</p>;

  const shown = data.types.filter((ty) => ty.side !== "return" || data.hasReturn);
  const stateOf = (code: string): State =>
    data.docs.filter((d) => d.doc_type === code)
      .reduce<State>((best, d) => (rank[d.status] > rank[best] ? d.status : best), "missing");
  const done = shown.filter((ty) => stateOf(ty.code) === "approved").length;

  return (
    <>
      <button className="link back" onClick={onBack}>← {t("back")}</button>
      <h1 className="deal-no">{deal.deal_no}</h1>
      <p className="muted">{deal.suppliers?.name}<br />{deal.po_no}</p>

      <div className="progress" role="img" aria-label={`${done} ${t("of")} ${shown.length} ${t("progress")}`}>
        <div className="bar"><span style={{ width: `${(done / Math.max(shown.length, 1)) * 100}%` }} /></div>
        <p><strong>{done}</strong> {t("of")} {shown.length} {t("progress")}</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {sides.filter((s) => shown.some((ty) => ty.side === s)).map((side) => (
        <section key={side}>
          <h2>{t(side)}</h2>
          <ul className="rows">
            {shown.filter((ty) => ty.side === side).map((ty) => {
              const state = stateOf(ty.code);
              const mine = data.docs.filter((d) => d.doc_type === ty.code);
              const isOpen = open === ty.code;
              return (
                <li key={ty.code} className={`state-${state}`}>
                  <button className="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : ty.code)}>
                    <span className="row-main"><span>{lang === "hi" && ty.name_hi ? ty.name_hi : ty.name}</span></span>
                    <span className={`chip ${state}`}>{t(state)}</span>
                  </button>
                  {isOpen && (
                    <div className="detail">
                      {mine.map((d) => (
                        <div className="file" key={d.id}>
                          <div className="file-head">
                            <span className={`chip ${d.status}`}>{t(d.status)}</span>
                            <span className="muted small">{new Date(d.uploaded_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                          </div>
                          {d.note && <p className="note">{d.note}</p>}
                          {rejecting === d.id ? (
                            <div className="reject">
                              <label>{t("rejectWhy")}
                                <textarea rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
                              </label>
                              <div className="actions">
                                <button className="btn danger" disabled={!reason.trim()}
                                  onClick={() => { act("reject_document", d, reason.trim()); setRejecting(null); setReason(""); }}>
                                  {t("confirmReject")}
                                </button>
                                <button className="btn" onClick={() => { setRejecting(null); setReason(""); }}>{t("cancel")}</button>
                              </div>
                            </div>
                          ) : (
                            <div className="actions">
                              <button className="btn" onClick={() => view(d)}>{t("view")}</button>
                              {d.status === "uploaded" && canVerify(profile.role) &&
                                <button className="btn primary" onClick={() => act("verify_document", d)}>{t("verify")}</button>}
                              {d.status === "verified" && canApprove(profile.role) &&
                                <button className="btn primary" onClick={() => act("approve_document", d)}>{t("approve")}</button>}
                              {(d.status === "uploaded" || d.status === "verified") && canVerify(profile.role) &&
                                <button className="btn danger" onClick={() => setRejecting(d.id)}>{t("reject")}</button>}
                            </div>
                          )}
                        </div>
                      ))}
                      <label className={`upload ${busy === ty.code ? "busy" : ""}`}>
                        {busy === ty.code ? t("uploading") : `+ ${t("upload")}`}
                        <input type="file" accept="image/*,application/pdf" multiple hidden disabled={busy !== null}
                               onChange={(e) => { upload(ty, e.target.files); e.target.value = ""; }} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
