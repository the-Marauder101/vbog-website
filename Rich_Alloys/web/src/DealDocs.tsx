import { useCallback, useEffect, useState } from "react";
import { api, type DealDocsData, type DocAction } from "./api";
import type { Key, Lang } from "./i18n";
import { canApprove, canVerify, type Deal, type Doc, type DocStatus, type DocType, type Profile, type Side } from "./types";
import { enqueue, onUploaded, online, remove, retry, useUploads, type Refused, type UpItem } from "./uploads";

const mb = (n: number) => `${(n / 1048576).toFixed(n < 1048576 ? 2 : 1)} MB`;

type State = DocStatus | "missing";
const rank: Record<State, number> = { approved: 4, verified: 3, uploaded: 2, rejected: 1, missing: 0 };
const sides: Side[] = ["supplier", "rich_alloys", "return"];

export default function DealDocs({ t, lang, deal, profile }: {
  t: (k: Key) => string; lang: Lang; deal: Deal; profile: Profile;
}) {
  const [data, setData] = useState<DealDocsData | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [flash, setFlash] = useState("");
  const queue = useUploads().filter((i) => i.dealId === deal.id);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () => api.dealDocs(deal.id).then(setData).catch((e: Error) => setError(e.message)),
    [deal.id],
  );
  useEffect(() => { load(); }, [load]);
  // When a queued file finishes: refresh the list and say so on screen.
  useEffect(() => onUploaded((i) => {
    if (i.dealId !== deal.id) return;
    load();
    setFlash(`${t("uploadedOk")}: ${i.name}`);
  }), [deal.id, load, t]);
  useEffect(() => { if (!flash) return; const h = setTimeout(() => setFlash(""), 5000); return () => clearTimeout(h); }, [flash]);

  async function run(work: () => Promise<void>) {
    setError("");
    try { await work(); } catch (e) { setError((e as Error).message); }
    await load();
  }

  async function upload(type: DocType, files: FileList | null) {
    if (!files?.length) return;
    setRefused(await enqueue(deal, type.code, Array.from(files), profile.id));
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
  const required = shown.filter((ty) => ty.required);
  const done = required.filter((ty) => stateOf(ty.code) === "approved").length;

  return (
    <>
      <div className="progress" role="img" aria-label={`${done} ${t("of")} ${required.length} ${t("progress")}`}>
        <div className="bar"><span style={{ width: `${(done / Math.max(required.length, 1)) * 100}%` }} /></div>
        <p><strong>{done}</strong> {t("of")} {required.length} {t("progress")}</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {queue.length > 0 && !online() && <p className="notice" role="status">{t("pendingOffline")}</p>}
      {flash && <p className="okline" role="status">✓ {flash}</p>}

      {sides.filter((s) => shown.some((ty) => ty.side === s)).map((side) => (
        <section key={side}>
          <h2>{t(side)}</h2>
          <ul className="rows">
            {shown.filter((ty) => ty.side === side).map((ty) => {
              const state = stateOf(ty.code);
              const mine = data.docs.filter((d) => d.doc_type === ty.code);
              const isOpen = open === ty.code;
              const waiting = queue.filter((q) => q.docType === ty.code);
              return (
                <li key={ty.code} className={`state-${state}`}>
                  <button className="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : ty.code)}>
                    <span className="row-main"><span>{lang === "hi" && ty.name_hi ? ty.name_hi : ty.name}</span>
                      {!ty.required && <span className="muted small">{t("optional")}</span>}</span>
                    {waiting.length > 0 && state === "missing"
                      ? <span className={`chip ${waiting.some((q) => q.state === "failed") ? "rejected" : "uploaded"}`}>
                          {waiting.some((q) => q.state === "failed") ? t("upFailed") : t("upUploading")}
                        </span>
                      : <span className={`chip ${state}`}>{t(state)}</span>}
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
                      {waiting.map((q) => <UploadRow key={q.id} t={t} q={q} />)}
                      {refused.length > 0 && waiting.length === 0 && open === ty.code && refused.map((r) => (
                        <p key={r.name} className="error" role="alert">{r.name} {t(r.reason)}</p>
                      ))}
                      <label className="upload">
                        + {t("upload")}
                        <input type="file" accept="image/*,application/pdf" multiple hidden
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

// One file on its way up: name, size, a progress bar, and what happens next in words.
function UploadRow({ t, q }: { t: (k: Key) => string; q: UpItem }) {
  const [confirm, setConfirm] = useState(false);
  const pct = Math.round(q.progress * 100);
  const line = q.state === "uploading" ? `${t("upUploading")} ${pct}%`
    : q.state === "failed" ? `${t("upFailed")}: ${q.error ?? ""}`
    : !online() ? t("upWaitingNet")
    : q.retryAt ? t("upRetrying") : t("upQueued");
  return (
    <div className={`file pending ${q.state}`}>
      <div className="file-head">
        <span className="fname">{q.name}</span>
        <span className="muted small">{mb(q.size)}</span>
      </div>
      <div className="bar thin" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={q.name}>
        <span style={{ width: `${q.state === "failed" ? 0 : pct}%` }} />
      </div>
      <p className={q.state === "failed" ? "note" : "muted small"} role={q.state === "failed" ? "alert" : undefined}>{line}</p>
      {confirm ? (
        <div className="confirm">
          <p>{t("confirmRemove")}</p>
          <div className="actions">
            <button className="btn danger" onClick={() => remove(q.id)}>{t("remove")}</button>
            <button className="btn" onClick={() => setConfirm(false)}>{t("cancel")}</button>
          </div>
        </div>
      ) : q.state !== "uploading" && (
        <div className="actions">
          {(q.state === "failed" || (q.retryAt && online())) &&
            <button className="btn primary" onClick={() => retry(q.id)}>{t("retryNow")}</button>}
          <button className="btn danger" onClick={() => setConfirm(true)}>{t("remove")}</button>
        </div>
      )}
    </div>
  );
}
