// Purchase order as a PDF (basic layout; the final design will replace it). Loaded only when someone downloads a PO.
import { COMPANY, type Row } from "./lib";

const money = (v: unknown) => `Rs. ${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v: unknown) => `${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");

export const poFileName = (deal: Row) => `${String(deal.po_no ?? deal.deal_no).replace(/[^A-Za-z0-9-]+/g, "_")}.pdf`;
/** deal: deals row with suppliers(*); lines: deal_lines with grades(name) */
export async function downloadPo(deal: Row, lines: Row[]) { (await buildPo(deal, lines)).save(poFileName(deal)); }
export async function poBlob(deal: Row, lines: Row[]): Promise<Blob> { return (await buildPo(deal, lines)).output("blob"); }

async function buildPo(deal: Row, lines: Row[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(); const M = 14;
  const sup = deal.suppliers ?? {};

  doc.setFont("helvetica", "bold").setFontSize(15).text(COMPANY.name, M, 18);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(doc.splitTextToSize(COMPANY.address, W - 2 * M - 60), M, 24);
  doc.text(`GSTIN: ${COMPANY.gstin}`, M, 33);
  doc.setFont("helvetica", "bold").setFontSize(13).text("PURCHASE ORDER", W - M, 18, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`PO No: ${deal.po_no ?? "-"}`, W - M, 24, { align: "right" });
  doc.text(`Date: ${dt(deal.po_date)}${Number(deal.po_revision) > 1 ? `   Rev ${deal.po_revision}` : ""}`, W - M, 29, { align: "right" });
  doc.text(`Deal: ${deal.deal_no}`, W - M, 34, { align: "right" });
  doc.setDrawColor(180).line(M, 38, W - M, 38);

  doc.setFont("helvetica", "bold").text("Supplier", M, 45);
  doc.setFont("helvetica", "normal");
  doc.text([String(sup.name ?? "-"), `GSTIN: ${sup.gstin ?? "-"}`, `State: ${sup.state ?? "-"}`], M, 50);
  doc.setFont("helvetica", "bold").text("Delivery", W / 2 + 4, 45);
  doc.setFont("helvetica", "normal");
  doc.text(doc.splitTextToSize(`To our factory: ${COMPANY.address}`, W / 2 - M - 4), W / 2 + 4, 50);
  doc.text(`Expected by: ${dt(deal.expected_date)}`, W / 2 + 4, 64);

  const open = lines.some((l) => l.rate_per_kg == null);
  const taxable = lines.reduce((a, l) => a + Number(l.qty_kg) * Number(l.rate_per_kg ?? 0), 0);
  const gst = Math.round(taxable * Number(deal.gst_rate) / 100 * 100) / 100;
  autoTable(doc, {
    startY: 72, margin: { left: M, right: M },
    head: [["#", "Material", { content: "Quantity", styles: { halign: "right" } }, { content: "Rate (per kg)", styles: { halign: "right" } }, { content: "Amount", styles: { halign: "right" } }]],
    body: lines.map((l, i) => [String(i + 1), String(l.grades?.name ?? l.grade), qty(l.qty_kg),
      l.rate_per_kg == null ? "Open *" : money(l.rate_per_kg), l.rate_per_kg == null ? "-" : money(Number(l.qty_kg) * Number(l.rate_per_kg))]),
    foot: [["", "", "", open ? "Taxable (fixed lines)" : "Taxable value", money(taxable)], ["", "", "", `GST ${deal.gst_rate}%`, money(gst)], ["", "", "", "Total", money(taxable + gst)]],
    styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [60, 45, 35] }, footStyles: { fillColor: [245, 240, 232], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 10 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(8).text("All rates exclude GST. GST is added on top.", M, y - 3); doc.setFontSize(9);
  if (open) {
    const w = doc.splitTextToSize(`* Price open: to be fixed${deal.price_basis ? ` on ${deal.price_basis}` : " against LME"}${deal.price_fix_days != null ? ` within ${deal.price_fix_days} days of delivery` : ""}, and confirmed in writing.`, W - 2 * M);
    doc.text(w, M, y + 2); y += 5 * w.length + 3;
  }

  const pct = deal.provisional_pct ?? sup.provisional_pct, pd = deal.provisional_days ?? sup.provisional_days, bd = deal.balance_days ?? sup.balance_days;
  const terms = pct == null ? "As agreed." : `${pct}% within ${pd ?? 0} days of invoice; balance within ${bd ?? "-"} days of invoice.`;
  doc.setFont("helvetica", "bold").text("Payment terms", M, y); doc.setFont("helvetica", "normal").text(terms, M + 32, y); y += 8;
  doc.setFont("helvetica", "bold").text("Conditions", M, y); y += 5;
  doc.setFont("helvetica", "normal");
  const cond = [
    "1. Quantity is settled at our weighbridge. Any weight short is debited at the agreed rate.",
    "2. Material is sorted at our factory. Mud, bags, attachments and other non-acceptable items are debited or returned.",
    "3. Invoice at the rate in this order. A different rate on the invoice will be debited or must be agreed in writing.",
    "4. Quote this PO number on the invoice, e-way bill and packing slip.",
  ];
  for (const c of cond) { const w = doc.splitTextToSize(c, W - 2 * M); doc.text(w, M, y); y += 5 * w.length; }
  y = Math.max(y + 18, 250);
  doc.text(`For ${COMPANY.name}`, W - M, y, { align: "right" });
  doc.text("Authorised signatory", W - M, y + 16, { align: "right" });
  return doc;
}
