// Pieces used on several screens: stages, Tally ticks, saving, payments, documents.
import { useCallback, useEffect, useState } from "react";
import { BUCKET, day, inr, isNum, rpc, sb, today, q, useCan, useLang, useLoad, useMe, useT, nm, type Row } from "./lib";
import { enqueue, onUploaded, online, remove, retry, useUploads, type Refused, type UpItem } from "./uploads";
import { DateIn, Btn, Chip, Empty, Err, Field, Loading, NumIn, Select, Sheet, SaveBar, TextIn, toast, type Tone } from "./ui";

export const STAGES: { id: string; en: string; hi: string; tone: Tone }[] = [
  { id: "received", en: "Received", hi: "माल आया", tone: "wait" },
  { id: "sorting", en: "Sorting", hi: "छँटाई चालू", tone: "wait" },
  { id: "dn_pending", en: "DN to approve", hi: "डेबिट नोट बाकी", tone: "bad" },
  { id: "tally_pending", en: "Tally entry pending", hi: "टैली एंट्री बाकी", tone: "info" },
  { id: "payment_pending", en: "Payment pending", hi: "पेमेंट बाकी", tone: "wait" },
  { id: "settled", en: "Settled", hi: "पूरा", tone: "ok" },
];
export function StageChip({ stage }: { stage: string }) {
  const t = useT();
  const s = STAGES.find((x) => x.id === stage);
  return <Chip tone={s?.tone ?? "none"}>{s ? t(s.en, s.hi) : stage}</Chip>;
}
export function Stepper({ stage }: { stage: string }) {
  const t = useT();
  const at = STAGES.findIndex((x) => x.id === stage);
  return (
    <ol className="stepper" aria-label={t("Progress", "प्रगति")}>
      {STAGES.map((s, i) => (
        <li key={s.id} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>
          <span className="dot">{i < at ? "✓" : i + 1}</span><span className="lbl">{t(s.en, s.hi)}</span>
        </li>
      ))}
    </ol>
  );
}

export const DN_LABEL: Record<string, [string, string]> = {
  price_diff: ["Invoice rate above agreed", "तय रेट से ज़्यादा बिल रेट"],
  weight_short: ["Weight short", "वज़न कम"],
  rate_diff: ["Rate difference", "रेट अंतर"],
  return: ["Material return", "माल वापसी"],
};

export function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // every save shows "Saved" when it worked (msg overrides, e.g. "Deleted"; null shows nothing)
  const run = useCallback(async (fn: () => Promise<unknown>, after?: () => void, msg?: [string, string] | null) => {
    setBusy(true); setError("");
    try { await fn(); after?.(); if (msg !== null) toast(msg); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }, []);
  return { busy, error, run, setError };
}

// ---------- Tally ticks ----------
export function TallyTick({ entity, id, book, marks, onDone }: {
  entity: string; id: string; book: "factory" | "office"; marks: Row[]; onDone: () => void;
}) {
  const t = useT(); const can = useCan();
  const mark = marks.find((m) => m.entity === entity && m.entity_id === id && m.book === book);
  const allowed = can(book === "factory" ? "tally_factory" : "tally_office");
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const s = useSave();
  const label = book === "factory" ? t("Factory Tally", "फैक्ट्री टैली") : t("Office Tally", "ऑफिस टैली");
  return (
    <span className="tick">
      {mark ? <Chip tone="ok">✓ {label}{mark.voucher_ref ? ` · ${mark.voucher_ref}` : ""}</Chip>
            : allowed ? <Btn small onClick={() => setOpen(true)}>{t("Mark entered in", "दर्ज किया:")} {label}</Btn>
            : <Chip tone="none">{label}: {t("not yet", "बाकी")}</Chip>}
      {mark && allowed && (
        <Btn small kind="ghost" onClick={() => { if (confirm(t("Remove this Tally tick?", "टैली टिक हटाएँ?"))) s.run(() => rpc("unmark_tally", { p_entity: entity, p_id: id, p_book: book }), onDone); }}>
          {t("Undo", "वापस")}
        </Btn>
      )}
      {open && (
        <Sheet title={`${label}: ${t("entered", "दर्ज")}`} onClose={() => setOpen(false)}
          footer={<SaveBar busy={s.busy} error={s.error} label={t("Save", "सेव करें")}
            onSave={() => s.run(() => rpc("mark_tally", { p_entity: entity, p_id: id, p_book: book, p_ref: ref }), () => { setOpen(false); onDone(); })} />}>
          <Field label={t("Voucher number in Tally (optional)", "टैली वाउचर नंबर (वैकल्पिक)")}>
            <TextIn value={ref} onValue={setRef} autoFocus />
          </Field>
        </Sheet>
      )}
    </span>
  );
}

// ---------- payments ----------
export const MODES = ["neft", "rtgs", "imps", "cheque", "cash", "other"];
export function PaymentSheet({ supplierId, invoiceId, dealId, existing, onClose, onSaved }: {
  supplierId?: string; invoiceId?: string; dealId?: string; existing?: Row; onClose: () => void; onSaved: () => void;
}) {
  const t = useT();
  const [supplier, setSupplier] = useState<string>(existing?.supplier_id ?? supplierId ?? "");
  const [invoice, setInvoice] = useState<string>(existing?.invoice_id ?? invoiceId ?? "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [paidOn, setPaidOn] = useState(existing?.paid_on ?? today());
  const [mode, setMode] = useState(existing?.mode ?? "neft");
  const [ref, setRef] = useState(existing?.bank_ref ?? "");
  const [kind, setKind] = useState(existing?.kind ?? (invoiceId ? "provisional" : "advance"));
  const [tds, setTds] = useState("");
  const [section, setSection] = useState("194Q");
  const [gstTds, setGstTds] = useState("");
  const s = useSave();
  const sups = useLoad(() => q(sb.from("suppliers").select("id,name").eq("active", true).order("name")), []);
  const open = useLoad(() => (supplier ? q(sb.from("v_payable").select("invoice_id,invoice_no,lot_no,balance").eq("supplier_id", supplier)) : Promise.resolve([] as Row[])), [supplier]);
  const holds = useLoad(() => (supplier ? q(sb.from("v_payment_holds").select("*").eq("supplier_id", supplier)) : Promise.resolve([] as Row[])), [supplier]);
  const lotNo = (open.data ?? []).find((x) => x.invoice_id === invoice)?.lot_no;
  const hold = (holds.data ?? []).find((h) => h.scope === "supplier" || (invoice && h.ref_no === lotNo));
  const save = () => s.run(async () => {
    if (!supplier) throw new Error(t("Choose the supplier.", "सप्लायर चुनें।"));
    if (!isNum(amount) || Number(amount) <= 0) throw new Error(t("Enter the amount paid.", "भुगतान की रकम डालें।"));
    const row = { supplier_id: supplier, invoice_id: invoice || null, deal_id: invoice ? null : (dealId ?? existing?.deal_id ?? null),
                  amount: Number(amount), paid_on: paidOn, mode, bank_ref: ref.trim() || null, kind };
    if (tds && (!isNum(tds) || Number(tds) <= 0)) throw new Error(t("Check the TDS amount.", "TDS रकम जाँचें।"));
    if (gstTds && (!isNum(gstTds) || Number(gstTds) <= 0)) throw new Error(t("Check the GST TDS amount.", "GST TDS रकम जाँचें।"));
    if ((tds || gstTds) && !invoice) throw new Error(t("TDS needs a bill. Choose the bill.", "TDS के लिए बिल चुनें।"));
    if (existing) await q(sb.from("payments").update(row).eq("id", existing.id));
    else {
      const p = await q<Row>(sb.from("payments").insert(row).select("id").single());
      if (tds) await q(sb.from("tds").insert({ invoice_id: invoice, payment_id: p.id, amount: Number(tds), kind: "it", section: section.trim().toUpperCase() || null, deducted_on: paidOn }));
      if (gstTds) await q(sb.from("tds").insert({ invoice_id: invoice, payment_id: p.id, amount: Number(gstTds), kind: "gst", section: "GST", deducted_on: paidOn }));
    }
  }, () => { onSaved(); onClose(); });
  return (
    <Sheet title={existing ? t("Correct payment", "पेमेंट सुधारें") : t("Record payment", "पेमेंट दर्ज करें")} onClose={onClose}
      footer={<SaveBar busy={s.busy} error={s.error} onSave={save} label={t("Save. Accounts will reconcile it.", "सेव करें। अकाउंट्स मिलान करेगा।")} />}>
      {existing?.reject_note && <p className="error">{t("Sent back:", "वापस भेजा:")} {existing.reject_note}</p>}
      {!supplierId && !existing && (
        <Field label={t("Supplier", "सप्लायर")}>
          <Select value={supplier} onChange={(v) => { setSupplier(v); setInvoice(""); }} placeholder={t("Choose…", "चुनें…")}
                  options={(sups.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
      )}
      {!invoiceId && (
        <Field label={t("Against bill", "किस बिल के लिए")} hint={t("Leave empty for an advance.", "एडवांस के लिए खाली छोड़ें।")}>
          <Select value={invoice} onChange={setInvoice} placeholder={t("Advance / no bill", "एडवांस / बिल नहीं")}
                  options={(open.data ?? []).map((x) => ({ value: x.invoice_id, label: `${x.invoice_no} · ${x.lot_no ?? ""} · ${t("balance", "बाकी")} ${inr(x.balance)}` }))} />
        </Field>
      )}
      {hold && hold.status !== "cleared" && !existing && <HoldHint h={hold} amount={amount} />}
      <div className="grid2">
        <Field label={t("Amount paid", "भुगतान रकम")}><NumIn value={amount} onChange={setAmount} suffix="₹" autoFocus /></Field>
        <Field label={t("Paid on", "भुगतान तारीख")}><DateIn value={paidOn} onChange={setPaidOn} /></Field>
        <Field label={t("Mode", "माध्यम")}><Select value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: m.toUpperCase() }))} /></Field>
        <Field label={t("Bank reference / UTR", "बैंक रेफरेंस / UTR")}><TextIn value={ref} onValue={setRef} /></Field>
        <Field label={t("Type", "प्रकार")}>
          <Select value={kind} onChange={setKind} options={[
            { value: "advance", label: t("Advance", "एडवांस") }, { value: "provisional", label: t("Provisional", "प्रोविजनल") },
            { value: "final", label: t("Final", "फाइनल") }, { value: "other", label: t("Other", "अन्य") }]} />
        </Field>
      </div>
      {!existing && invoice && (
        <div className="grid2">
          <Field label={t("Income-tax TDS from this bill", "इस बिल से आयकर TDS")} hint={t("Leave empty if none.", "न हो तो खाली छोड़ें।")}><NumIn value={tds} onChange={setTds} suffix="₹" /></Field>
          <Field label={t("Income-tax TDS section", "आयकर TDS सेक्शन")}><TextIn value={section} onValue={setSection} /></Field>
          <Field label={t("GST TDS from this bill", "इस बिल से GST TDS")} hint={t("Leave empty if none.", "न हो तो खाली छोड़ें।")}><NumIn value={gstTds} onChange={setGstTds} suffix="₹" /></Field>
        </div>
      )}
    </Sheet>
  );
}

// Pay up to the limit, hold the rest (supplier or lot setting)
export function HoldHint({ h, amount }: { h: Row; amount?: string }) {
  const t = useT();
  const over = amount && isNum(amount) && h.status === "paying" ? Number(amount) - Number(h.can_pay_now) : 0;
  const scope = h.scope === "supplier" ? t("this supplier, all bills", "इस सप्लायर के सभी बिल") : h.ref_no;
  return (
    <div className={over > 0.005 || h.status === "holding" || h.over_limit ? "warnbox" : h.status === "release_due" ? "notice" : "notice ok-notice"}>
      <strong>{t("Pay up to", "भुगतान सीमा")} {100 - Number(h.hold_pct)}%</strong> ({scope}): {inr(h.pay_limit)} · {t("paid", "दिया")} {inr(h.paid)}
      <p className="small">{h.status === "paying" ? `${t("Can pay now", "अभी दे सकते हैं")} ${inr(h.can_pay_now)}. ${t("Then hold", "फिर रोकें")} ${inr(Number(h.net) - Number(h.pay_limit))} ${t("for", "")} ${h.hold_days ?? 0} ${t("days", "दिन")}.`
        : h.status === "holding" ? `${t("Limit reached on", "सीमा पहुँची")} ${day(h.reached_on)}. ${t("Hold", "रोकें")} ${inr(h.held)} ${t("until", "तक")} ${day(h.release_on)}.`
        : `${t("Held amount due since", "रोकी रकम देनी है, तारीख")} ${day(h.release_on)}: ${inr(h.held)}.`}</p>
      {over > 0.005 && <p className="error small">{t("This goes past the limit by", "यह सीमा से ज़्यादा है:")} {inr(over)}.</p>}
      {h.over_limit && <p className="error small">{t("Already paid past the limit.", "सीमा से ज़्यादा दिया जा चुका है।")}</p>}
    </div>
  );
}

export function PaymentRow({ p, marks, onChange }: { p: Row; marks: Row[]; onChange: () => void }) {
  const t = useT(); const can = useCan(); const me = useMe();
  const [edit, setEdit] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const s = useSave();
  const tone: Tone = p.status === "reconciled" ? "ok" : p.status === "rejected" ? "bad" : "wait";
  const label = p.status === "reconciled" ? t("Reconciled", "मिलान हो गया") : p.status === "rejected" ? t("Sent back", "वापस भेजा") : t("Waiting for reconciliation", "मिलान बाकी");
  return (
    <div className="item">
      <div className="item-head">
        <strong>{inr(p.amount)}</strong>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <p className="muted small">{day(p.paid_on)} · {String(p.mode).toUpperCase()}{p.bank_ref ? ` · ${p.bank_ref}` : ""}{p.supplier ? ` · ${p.supplier}` : ""}</p>
      {p.reject_note && <p className="note">{p.reject_note}</p>}
      <Err error={s.error} />
      {why !== null ? (
        <div className="stack">
          <Field label={t("What does not match the bank statement?", "बैंक स्टेटमेंट से क्या नहीं मिल रहा?")}>
            <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
          </Field>
          <div className="actions">
            <Btn kind="danger" disabled={!why.trim() || s.busy} onClick={() => s.run(() => rpc("reject_payment", { p_id: p.id, p_note: why }), () => { setWhy(null); onChange(); })}>{t("Send back", "वापस भेजें")}</Btn>
            <Btn onClick={() => setWhy(null)}>{t("Cancel", "रद्द करें")}</Btn>
          </div>
        </div>
      ) : (
        <div className="actions">
          {p.status === "entered" && can("payment_reconcile") &&
            <Btn kind="primary" disabled={s.busy} onClick={() => s.run(() => rpc("reconcile_payment", { p_id: p.id }), onChange)}>{t("Matches bank statement", "बैंक स्टेटमेंट से मिलता है")}</Btn>}
          {p.status === "entered" && can("payment_reconcile") && <Btn kind="danger" onClick={() => setWhy("")}>{t("Does not match", "नहीं मिलता")}</Btn>}
          {p.status !== "reconciled" && can("payment_enter") && (p.entered_by === me.id || p.status === "rejected") &&
            <Btn onClick={() => setEdit(true)}>{t("Correct", "सुधारें")}</Btn>}
          {p.status === "reconciled" && <TallyTick entity="payment" id={p.id} book="office" marks={marks} onDone={onChange} />}
        </div>
      )}
      {edit && <PaymentSheet existing={p} onClose={() => setEdit(false)} onSaved={onChange} />}
    </div>
  );
}

// ---------- documents (per deal) ----------
type DocState = "approved" | "verified" | "uploaded" | "rejected" | "missing";
const rank: Record<DocState, number> = { approved: 4, verified: 3, uploaded: 2, rejected: 1, missing: 0 };
const docTone: Record<DocState, Tone> = { approved: "ok", verified: "wait", uploaded: "wait", rejected: "bad", missing: "none" };

export function DealDocs({ dealId, dealNo, hasReturn }: { dealId: string; dealNo: string; hasReturn: boolean }) {
  const t = useT(); const lang = useLang(); const can = useCan(); const me = useMe();
  const { data, error, reload } = useLoad(() => Promise.all([
    q(sb.from("doc_types").select("*").eq("active", true).order("sort")),
    q(sb.from("documents").select("*").eq("deal_id", dealId).order("uploaded_at")),
    q<Row>(sb.from("deals").select("suppliers(supplier_type)").eq("id", dealId).single()),
  ]), [dealId]);
  const [open, setOpen] = useState<string | null>(null);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [flash, setFlash] = useState("");
  const queue = useUploads().filter((i) => i.dealId === dealId);
  // When a queued file finishes: refresh the list and say so on screen.
  useEffect(() => onUploaded((i) => { if (i.dealId === dealId) { reload(); setFlash(i.name); } }), [dealId, reload]);
  useEffect(() => { if (!flash) return; const h = setTimeout(() => setFlash(""), 5000); return () => clearTimeout(h); }, [flash]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const s = useSave();
  if (!data) return error ? <Err error={error} /> : <Loading />;
  const [types, docs, deal] = data;
  const stype = deal?.suppliers?.supplier_type ?? "domestic";   // PRD 7b: the checklist follows the supplier type
  const shown = types.filter((x) => x.side !== "compliance" && (x.side !== "return" || hasReturn) && (!x.supplier_types || x.supplier_types.includes(stype)));
  const stateOf = (code: string): DocState =>
    docs.filter((d) => d.doc_type === code).reduce<DocState>((b, d) => (rank[d.status as DocState] > rank[b] ? d.status : b), "missing");
  const done = shown.filter((x) => stateOf(x.code) === "approved").length;
  const words: Record<DocState, string> = {
    approved: t("Approved", "मंज़ूर"), verified: t("Verified", "जाँचा गया"), uploaded: t("Uploaded", "अपलोड हुआ"),
    rejected: t("Rejected", "अस्वीकृत"), missing: t("Missing", "बाकी"),
  };
  // Upload queue (uploads.ts): shrunk, saved on the phone, sent with progress, retried by itself. Never lost silently.
  async function upload(code: string, files: FileList | null) {
    if (!files?.length) return;
    setRefused(await enqueue({ id: dealId, deal_no: dealNo }, code, Array.from(files), me.id));
  }
  // Open the tab inside the tap itself (phone browsers block tabs opened after a wait), then point it at the file.
  const view = (d: Row) => {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    return s.run(async () => {
      const r = await sb.storage.from(BUCKET).createSignedUrl(d.storage_path, 120);
      if (r.error) { tab?.close(); throw new Error(r.error.message); }
      if (tab) tab.location.href = r.data.signedUrl; else window.location.href = r.data.signedUrl;
    });
  };
  const sides: [string, string, string][] = [["supplier", "From the supplier", "सप्लायर से"], ["rich_alloys", "At our factory", "हमारी फैक्ट्री में"], ["return", "Material return", "माल वापसी"]];
  return (
    <>
      <div className="progress"><div className="bar"><span style={{ width: `${(done / Math.max(shown.length, 1)) * 100}%` }} /></div>
        <p><strong>{done}</strong> {t("of", "में से")} {shown.length} {t("documents approved", "दस्तावेज़ मंज़ूर")}</p></div>
      <Err error={s.error} />
      {queue.length > 0 && !online() && <p className="notice" role="status">{t("No network. Files are saved on this phone and will upload by themselves.", "नेटवर्क नहीं है। फ़ाइलें फ़ोन में सेव हैं, नेटवर्क आते ही अपने आप अपलोड होंगी।")}</p>}
      {flash && <p className="okline" role="status">✓ {t("Uploaded", "अपलोड हो गया")}: {flash}</p>}
      {sides.filter(([sd]) => shown.some((x) => x.side === sd)).map(([sd, en, hi]) => (
        <div key={sd}>
          <h3 className="sub">{t(en, hi)}</h3>
          <ul className="rows">
            {shown.filter((x) => x.side === sd).map((ty) => {
              const st = stateOf(ty.code); const mine = docs.filter((d) => d.doc_type === ty.code); const isOpen = open === ty.code;
              const waiting = queue.filter((x) => x.docType === ty.code); const failed = waiting.some((x) => x.state === "failed");
              return (
                <li key={ty.code} className={`edge-${docTone[st]}`}>
                  <button type="button" className="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : ty.code)}>
                    <span className="row-main"><span>{nm(lang, ty)}</span></span>
                    {waiting.length > 0 && st === "missing"
                      ? <Chip tone={failed ? "bad" : "wait"}>{failed ? t("Not uploaded", "अपलोड नहीं हुआ") : t("Uploading", "अपलोड हो रहा है")}</Chip>
                      : <Chip tone={docTone[st]}>{words[st]}</Chip>}
                  </button>
                  {isOpen && (
                    <div className="detail">
                      {mine.map((d) => (
                        <div className="item" key={d.id}>
                          <div className="item-head"><Chip tone={docTone[d.status as DocState]}>{words[d.status as DocState]}</Chip>
                            <span className="muted small">{new Date(d.uploaded_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span></div>
                          {d.note && <p className="note">{d.note}</p>}
                          {rejecting === d.id ? (
                            <div className="stack">
                              <Field label={t("Why are you rejecting this?", "अस्वीकार करने का कारण लिखें")}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
                              <div className="actions">
                                <Btn kind="danger" disabled={!reason.trim()} onClick={() => s.run(() => rpc("reject_document", { p_id: d.id, p_note: reason }), () => { setRejecting(null); setReason(""); reload(); })}>{t("Reject with this reason", "इस कारण से अस्वीकार करें")}</Btn>
                                <Btn onClick={() => { setRejecting(null); setReason(""); }}>{t("Cancel", "रद्द करें")}</Btn>
                              </div>
                            </div>
                          ) : (
                            <div className="actions">
                              {d.storage_path && !d.storage_path.endsWith("/seed") && <Btn onClick={() => view(d)}>{t("View", "देखें")}</Btn>}
                              {d.status === "uploaded" && can("doc_verify") && <Btn kind="primary" onClick={() => s.run(() => rpc("verify_document", { p_id: d.id }), reload)}>{t("Mark verified", "जाँच पूरी")}</Btn>}
                              {d.status === "verified" && can("doc_approve") && <Btn kind="primary" onClick={() => s.run(() => rpc("approve_document", { p_id: d.id }), reload)}>{t("Approve", "मंज़ूर करें")}</Btn>}
                              {(d.status === "uploaded" || d.status === "verified") && (can("doc_verify") || can("doc_approve")) && <Btn kind="danger" onClick={() => setRejecting(d.id)}>{t("Reject", "अस्वीकार करें")}</Btn>}
                            </div>
                          )}
                        </div>
                      ))}
                      {!mine.length && !waiting.length && <Empty>{t("Nothing uploaded yet.", "अभी कुछ अपलोड नहीं हुआ।")}</Empty>}
                      {waiting.map((x) => <UploadRow key={x.id} q={x} />)}
                      {refused.length > 0 && !waiting.length && refused.map((r) => (
                        <p key={r.name} className="error" role="alert">{r.name}: {r.reason === "tooBig"
                          ? t("larger than 20 MB, not added.", "20 MB से बड़ी है, जोड़ी नहीं गई।")
                          : t("not a photo or PDF, not added.", "फोटो या PDF नहीं है, जोड़ी नहीं गई।")}</p>
                      ))}
                      <label className="upload">
                        + {t("Add photo or PDF", "फोटो या PDF जोड़ें")}
                        <input type="file" accept="image/*,application/pdf" multiple hidden
                               onChange={(e) => { upload(ty.code, e.target.files); e.target.value = ""; }} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

// One file on its way up: name, size, a progress bar, and what happens next in words.
function UploadRow({ q: x }: { q: UpItem }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const pct = Math.round(x.progress * 100);
  const mb = `${(x.size / 1048576).toFixed(x.size < 1048576 ? 2 : 1)} MB`;
  const line = x.state === "uploading" ? `${t("Uploading", "अपलोड हो रहा है")} ${pct}%`
    : x.state === "failed" ? `${t("Not uploaded", "अपलोड नहीं हुआ")}: ${x.error ?? ""}`
    : !online() ? t("No network. Saved on this phone; it will upload by itself.", "नेटवर्क नहीं है। फ़ाइल फ़ोन में सेव है, नेटवर्क आते ही अपने आप अपलोड होगी।")
    : x.retryAt ? t("Network dropped. Trying again shortly.", "नेटवर्क टूट गया। थोड़ी देर में फिर कोशिश होगी।")
    : t("Waiting its turn to upload", "अपलोड की कतार में");
  return (
    <div className={`item pending ${x.state}`}>
      <div className="item-head"><span className="fname">{x.name}</span><span className="muted small">{mb}</span></div>
      <div className="bar thin" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={x.name}>
        <span style={{ width: `${x.state === "failed" ? 0 : pct}%` }} />
      </div>
      <p className={x.state === "failed" ? "note" : "muted small"} role={x.state === "failed" ? "alert" : undefined}>{line}</p>
      {confirm ? (
        <div className="stack">
          <p>{t("Remove this file? It has not been uploaded.", "यह फ़ाइल हटाएँ? यह अपलोड नहीं हुई है।")}</p>
          <div className="actions">
            <Btn kind="danger" onClick={() => remove(x.id)}>{t("Remove", "हटाएँ")}</Btn>
            <Btn onClick={() => setConfirm(false)}>{t("Cancel", "रद्द करें")}</Btn>
          </div>
        </div>
      ) : x.state !== "uploading" && (
        <div className="actions">
          {(x.state === "failed" || (x.retryAt && online())) && <Btn kind="primary" onClick={() => retry(x.id)}>{t("Try now", "अभी कोशिश करें")}</Btn>}
          <Btn kind="danger" onClick={() => setConfirm(true)}>{t("Remove", "हटाएँ")}</Btn>
        </div>
      )}
    </div>
  );
}

// ---------- invoice rate vs agreed rate: decide per truck, in one tap (migration 0012) ----------
// Shown on Home (Himanshu, Tinu), on the lot and on the deal. Accept = the deal takes the invoice rate;
// keep = over-billing becomes a debit note for the excess, under-billing is just recorded.
export function PriceDecisions({ lotId, dealId, onDone, title }: { lotId?: string; dealId?: string; onDone?: () => void; title?: boolean }) {
  const t = useT(); const can = useCan(); const lang = useLang();
  const { data, reload } = useLoad(() => {
    let qq = sb.from("v_price_diffs").select("*").eq("status", "open").order("invoice_date");
    if (lotId) qq = qq.eq("lot_id", lotId);
    if (dealId) qq = qq.eq("deal_id", dealId);
    return q(qq);
  }, [lotId, dealId]);
  const s = useSave();
  if (!data || !data.length) return null;
  const lots = Array.from(new Set(data.map((r) => r.lot_id)));
  const decide = (lot: string, choice: string) => s.run(() => rpc("decide_price", { p_lot: lot, p_choice: choice }), () => { reload(); onDone?.(); });
  return (
    <div className="price-block">
      {title && <h2 className="sub">{t("Invoice rate differs from the deal", "बिल का रेट सौदे से अलग")}</h2>}
      <Err error={s.error} />
      {lots.map((lot) => {
        const rows = data.filter((r) => r.lot_id === lot); const f = rows[0];
        const over = rows.filter((r) => r.direction === "over");
        const dn = over.reduce((a, r) => a + Number(r.total), 0);
        return (
          <div className="card price-card" key={lot}>
            <div className="item-head"><strong>{f.supplier}</strong><span className="muted small">{f.lot_no} · {t("invoice", "बिल")} {f.invoice_no}</span></div>
            {rows.map((r) => (
              <p key={r.grade} className="price-line">
                <strong>{nm(lang, { name: r.grade_name, name_hi: r.grade_name_hi }) || r.grade}</strong>:{" "}
                {t("invoice", "बिल")} {inr(r.invoice_rate)} · {t("agreed", "तय")} {inr(r.agreed_rate)}{" "}
                <span className={r.direction === "over" ? "bad" : "okline"}>({r.direction === "over" ? "+" : "−"}{inr(Math.abs(Number(r.diff_per_kg)))}/kg × {Number(r.billed_net_kg).toLocaleString("en-IN")} kg = {inr(Math.abs(Number(r.total)))} {t("incl. GST", "GST सहित")})</span>
              </p>))}
            {can("price_decide") ? (
              <div className="choice-buttons">
                <Btn kind="primary" disabled={s.busy} onClick={() => decide(lot, "accept_invoice")}>
                  {t("Accept invoice rate", "बिल का रेट मानें")}<small>{t("Also for trucks still to come", "आगे के ट्रकों के लिए भी")}</small></Btn>
                <Btn disabled={s.busy} onClick={() => decide(lot, "keep_agreed")}>
                  {t("Keep agreed rate", "तय रेट रखें")}<small>{over.length ? `${t("Debit note", "डेबिट नोट")} ${inr(dn)}` : t("Supplier to bill the difference", "फर्क का बिल सप्लायर भेजेगा")}</small></Btn>
              </div>
            ) : <p className="muted small">{t("Himanshu or Tinu will decide this.", "हिमांशु जी या टीनू तय करेंगे।")}</p>}
          </div>
        );
      })}
    </div>
  );
}

// Tap the rate, type the new one, tick. Used for a deal's rate and for a truck's price.
export function RateCell({ rate, label, editable, save, onSaved }: { rate: unknown; label: string; editable: boolean; save: (v: number) => Promise<unknown>; onSaved: () => void }) {
  const t = useT();
  const [v, setV] = useState<string | null>(null);
  const s = useSave();
  const shown = rate == null ? t("Open", "खुला") : `${inr(rate)}/kg`;
  if (!editable) return <>{shown}</>;
  if (v === null) return <button type="button" className={`rate-btn${rate == null ? " open" : ""}`} aria-label={`${rate == null ? t("Fix price", "रेट तय करें") : t("Change rate", "रेट बदलें")} ${label}`} onClick={() => setV(String(rate ?? ""))}>{shown} ✎</button>;
  return (
    <span className="rate-edit">
      <NumIn value={v} onChange={setV} autoFocus />
      <Btn small kind="primary" disabled={s.busy || !isNum(v) || Number(v) <= 0} aria-label={t("Save rate", "रेट सेव करें")}
        onClick={() => s.run(() => save(Number(v)), () => { setV(null); onSaved(); })}>✓</Btn>
      <Btn small aria-label={t("Cancel", "रद्द करें")} onClick={() => setV(null)}>✕</Btn>
      {s.error && <span className="error small">{s.error}</span>}
    </span>
  );
}

const SOURCE: Record<string, [string, string]> = {
  booked: ["booked", "बुक किया"], changed: ["deal changed", "सौदा बदला"],
  accepted_invoice: ["invoice rate accepted", "बिल का रेट माना"], confirmed_unbooked: ["confirmed (unbooked truck)", "पक्का किया (बिना बुकिंग)"],
  truck_changed: ["truck price changed", "ट्रक का रेट बदला"], price_fixed: ["open price fixed", "खुला रेट तय हुआ"],
};
// rows from deal_rate_history (with profiles(full_name) and lots(lot_no))
export function RateHistory({ rows, names, open }: { rows: Row[]; names: Record<string, string>; open?: boolean }) {
  const t = useT(); const lang = useLang();
  return (
    <details className="rate-history" open={open}>
      <summary>{t("Rate history", "रेट का इतिहास")} ({rows.length})</summary>
      <ul className="history">{rows.map((h) => (
        <li key={h.id}>
          <strong>{names[h.grade] ?? h.grade}</strong>{h.lots?.lot_no ? ` · ${h.lots.lot_no}` : ""} {h.old_rate != null ? <>{inr(h.old_rate)} → </> : null}<strong>{inr(h.new_rate)}</strong>
          <span className="muted"> · {t(...(SOURCE[h.source] ?? [h.source, h.source]))} · {h.profiles?.full_name ?? "—"} · {new Date(h.changed_at).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{h.note ? ` · ${h.note}` : ""}</span>
        </li>))}
      </ul>
    </details>
  );
}
