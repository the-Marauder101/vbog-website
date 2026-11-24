// One-click packages: every file for one invoice (lot) or one supplier in a single .zip, with the PO, the debit notes
// as PDFs and an index. Built on the phone; loaded only when someone downloads a package.
import { BUCKET, csv, q, sb, type Row } from "./lib";

type Add = { path: string; blob?: Blob; storage?: string };
type Progress = (done: number, total: number) => void;

const clean = (s: unknown) => String(s ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "file";
const ext = (p: string) => (p.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "bin").toLowerCase();
const SIDE: Record<string, string> = { supplier: "From the supplier", rich_alloys: "Our factory (QA, sorting, weighbridge)", return: "Material return", compliance: "Compliance" };

export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// files named by their type, numbered when there are several of one type in a folder
function docFiles(docs: Row[], folder: string): Add[] {
  const seen: Record<string, number> = {};
  return docs.map((d) => {
    const dir = `${folder}${SIDE[d.side] ?? clean(d.side)}/`;
    const base = clean(d.step_name ? `${d.step_name}` : d.type_name);
    const k = dir + base; seen[k] = (seen[k] ?? 0) + 1;
    return { path: `${dir}${base}${seen[k] > 1 ? ` ${seen[k]}` : ""}.${ext(d.storage_path)}`, storage: d.storage_path };
  });
}

async function poFiles(dealIds: string[], folder: string): Promise<Add[]> {
  if (!dealIds.length) return [];
  const deals = await q(sb.from("deals").select("*, suppliers(*), deal_lines(*, grades(name))").in("id", dealIds));
  const { poBlob, poFileName } = await import("./po");
  const out: Add[] = [];
  for (const d of deals.filter((x) => x.po_issued_at)) out.push({ path: `${folder}${poFileName(d)}`, blob: await poBlob(d, d.deal_lines ?? []) });
  return out;
}

async function dnFiles(lotIds: string[], folderOf: (lotId: string) => string, noteIds?: string[]): Promise<Add[]> {
  if (!lotIds.length) return [];
  const all = await q(sb.from("notes").select("*, note_lines(*), lots(lot_no, deals(deal_no, suppliers(name, gstin, state))), invoices(invoice_no, invoice_date, gst_rate)")
    .in("lot_id", lotIds).neq("status", "cancelled").order("note_date"));
  const notes = noteIds ? all.filter((n) => noteIds.includes(n.id)) : all;
  const { dnBlob, dnFileName } = await import("./dn");
  const out: Add[] = [];
  for (const n of notes) {
    const lotNo = n.lots?.lot_no ?? "";
    out.push({ path: `${folderOf(n.lot_id)}Debit notes/${dnFileName(n, lotNo)}`,
      blob: await dnBlob(n, { supplier: n.lots?.deals?.suppliers ?? {}, invoice: n.invoices ?? {}, lot_no: lotNo, deal_no: n.lots?.deals?.deal_no }) });
  }
  return out;
}

async function zipIt(name: string, files: Add[], index: Row[], progress?: Progress) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  let done = 0; const total = files.length; progress?.(0, total);
  const missing: string[] = [];
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      if (f.blob) zip.file(f.path, f.blob);
      else if (f.storage) {
        const r = await sb.storage.from(BUCKET).download(f.storage);
        if (r.data) zip.file(f.path, r.data); else missing.push(f.path);
      }
      progress?.(++done, total);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const rows = [...index, ...missing.map((m) => ({ file: m, type: "NOT DOWNLOADED (file missing in storage)" }))];
  zip.file("index.csv", csv(rows, [["file", "File"], ["type", "Type"], ["status", "Status"], ["uploaded", "Uploaded"], ["lot", "Lot"], ["invoice", "Invoice"], ["deal", "Deal"]]));
  saveBlob(`${clean(name)}.zip`, await zip.generateAsync({ type: "blob" }));
  return { files: total, missing: missing.length };
}

const indexRows = (docs: Row[], files: Add[]) => files.map((f) => {
  const d = docs.find((x) => x.storage_path === f.storage);
  return { file: f.path, type: d ? d.type_name : f.path.includes("Debit notes/") ? "Debit note (made by the portal)" : "Purchase order (made by the portal)",
           status: d?.status ?? "issued", uploaded: d?.uploaded_at?.slice(0, 10) ?? "", lot: d?.lot_no ?? "", invoice: d?.invoice_no ?? "", deal: d?.deal_no ?? "" };
});

/** Everything for one truck / invoice: its files, its deals' files, the PO(s), the debit notes */
export async function packageLot(lot: Row, progress?: Progress) {
  const dealIds: string[] = lot.deal_ids ?? [lot.deal_id];
  const docs = await q(sb.from("v_doc_index").select("*").or(`lot_id.eq.${lot.lot_id},and(lot_id.is.null,deal_id.in.(${dealIds.join(",")}))`));
  const files = [...docFiles(docs, ""), ...await poFiles(dealIds, "Purchase order/"), ...await dnFiles([lot.lot_id], () => "")];
  return zipIt(`${lot.lot_no} ${lot.invoice_no ?? ""} ${lot.supplier ?? ""}`, files, indexRows(docs, files), progress);
}

/** Everything for one supplier: compliance files, every deal's files and PO, every invoice's files and debit notes */
export async function packageSupplier(supplier: Row, progress?: Progress) {
  const [docs, deals, lots] = await Promise.all([
    q(sb.from("v_doc_index").select("*").eq("supplier_id", supplier.id)),
    q(sb.from("deals").select("id, deal_no").eq("supplier_id", supplier.id).eq("cancelled", false)),
    q(sb.from("v_lots").select("lot_id, lot_no, invoice_no").eq("supplier_id", supplier.id)),
  ]);
  const lotDir = (id: string) => { const l = lots.find((x) => x.lot_id === id); return `Invoices/${clean(`${l?.lot_no ?? ""} ${l?.invoice_no ?? ""}`)}/`; };
  const dealDir = (id: string) => `Deals/${clean(deals.find((x) => x.id === id)?.deal_no)}/`;
  const files: Add[] = [
    ...docFiles(docs.filter((d) => !d.deal_id), ""),
    ...deals.flatMap((dl) => docFiles(docs.filter((d) => d.deal_id === dl.id && !d.lot_id), dealDir(dl.id))),
    ...lots.flatMap((l) => docFiles(docs.filter((d) => d.lot_id === l.lot_id), lotDir(l.lot_id))),
  ];
  for (const dl of deals) files.push(...await poFiles([dl.id], dealDir(dl.id)));
  files.push(...await dnFiles(lots.map((l) => l.lot_id), lotDir));
  return zipIt(`${supplier.name} documents`, files, indexRows(docs, files), progress);
}

/** Debit notes only, e.g. one month's, in one zip */
export async function packageNotes(notes: Row[], name: string, progress?: Progress) {
  const files = await dnFiles([...new Set(notes.map((n) => n.lot_id as string))], () => "", notes.map((n) => n.id));
  return zipIt(name, files, indexRows([], files), progress);
}

/** Everything under one PO: the PO, the deal's files, and every truck that carried its material (files and debit notes) */
export async function packageDeal(dealId: string, progress?: Progress) {
  const [deal, lots] = await Promise.all([
    q<Row>(sb.from("deals").select("id, deal_no, po_no, suppliers(name)").eq("id", dealId).single()),
    q(sb.from("v_lots").select("lot_id, lot_no, invoice_no").contains("deal_ids", [dealId])),
  ]);
  const lotIds = lots.map((l) => l.lot_id as string);
  const docs = await q(sb.from("v_doc_index").select("*").or(lotIds.length
    ? `deal_id.eq.${dealId},lot_id.in.(${lotIds.join(",")})` : `deal_id.eq.${dealId}`));
  const lotDir = (id: string) => { const l = lots.find((x) => x.lot_id === id); return `Invoices/${clean(`${l?.invoice_no ?? ""} ${l?.lot_no ?? ""}`)}/`; };
  const files: Add[] = [
    ...await poFiles([dealId], ""),
    ...docFiles(docs.filter((d) => !d.lot_id), "Deal documents/"),
    ...lots.flatMap((l) => docFiles(docs.filter((d) => d.lot_id === l.lot_id), lotDir(l.lot_id))),
    ...await dnFiles(lotIds, lotDir),
  ];
  return zipIt(`${deal.po_no ?? deal.deal_no} ${deal.suppliers?.name ?? ""}`, files, indexRows(docs, files), progress);
}
