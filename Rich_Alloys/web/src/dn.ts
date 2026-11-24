// Debit note as a PDF (basic layout until Rich Alloys' own DN format replaces it). Loaded only when needed.
import { COMPANY, type Row } from "./lib";

const money = (v: unknown) => `Rs. ${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");
export const DN_TITLE: Record<string, string> = {
  weight_short: "Weight short", rate_diff: "Quality (sorting) rate difference", return: "Material returned", price_diff: "Invoice rate above agreed rate" };
export const dnNumber = (n: Row, lotNo: string) => n.tally_no || `${lotNo}-${String(n.dn_type).toUpperCase()}`;
export const dnFileName = (n: Row, lotNo: string) => `Debit note ${dnNumber(n, lotNo)}`.replace(/[^A-Za-z0-9 -]+/g, "_") + ".pdf";

/** n: notes row with note_lines(*); ctx: supplier {name, gstin, state}, invoice {invoice_no, invoice_date, gst_rate}, lot_no, deal_no */
export async function dnBlob(n: Row, ctx: { supplier: Row; invoice: Row; lot_no: string; deal_no?: string }): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(); const M = 14;
  const sup = ctx.supplier ?? {}; const inv = ctx.invoice ?? {};
  const sameState = String(sup.gstin ?? "").slice(0, 2) === COMPANY.gstin.slice(0, 2);
  doc.setFont("helvetica", "bold").setFontSize(15).text(COMPANY.name, M, 18);
  doc.setFont("helvetica", "normal").setFontSize(9).text(doc.splitTextToSize(COMPANY.address, W - 2 * M - 60), M, 24);
  doc.text(`GSTIN: ${COMPANY.gstin}`, M, 33);
  doc.setFont("helvetica", "bold").setFontSize(13).text(n.status === "cancelled" ? "DEBIT NOTE (CANCELLED)" : "DEBIT NOTE", W - M, 18, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`No: ${dnNumber(n, ctx.lot_no)}`, W - M, 24, { align: "right" });
  doc.text(`Date: ${dt(n.note_date)}`, W - M, 29, { align: "right" });
  doc.text(`Lot ${ctx.lot_no}${ctx.deal_no ? ` · Deal ${ctx.deal_no}` : ""}`, W - M, 34, { align: "right" });
  doc.setDrawColor(180).line(M, 38, W - M, 38);
  doc.setFont("helvetica", "bold").text("To", M, 45);
  doc.setFont("helvetica", "normal").text([String(sup.name ?? "-"), `GSTIN: ${sup.gstin ?? "-"}`, `State: ${sup.state ?? "-"}`], M, 50);
  doc.setFont("helvetica", "bold").text("Against your invoice", W / 2 + 4, 45);
  doc.setFont("helvetica", "normal").text([`No: ${inv.invoice_no ?? "-"}`, `Date: ${dt(inv.invoice_date)}`, `Reason: ${DN_TITLE[n.dn_type] ?? n.dn_type}`], W / 2 + 4, 50);
  const gstRate = Number(inv.gst_rate ?? 0);
  const taxRows: string[][] = sameState
    ? [["", "", "", `CGST ${gstRate / 2}%`, money(Number(n.gst_amount) / 2)], ["", "", "", `SGST ${gstRate / 2}%`, money(Number(n.gst_amount) / 2)]]
    : [["", "", "", `IGST ${gstRate}%`, money(n.gst_amount)]];
  autoTable(doc, {
    startY: 68, margin: { left: M, right: M },
    head: [["#", "Description", { content: "Qty (kg)", styles: { halign: "right" } }, { content: "Rate (per kg)", styles: { halign: "right" } }, { content: "Amount", styles: { halign: "right" } }]],
    body: (n.note_lines ?? []).map((l: Row, i: number) => [String(i + 1), `${l.grade} · ${l.description}`,
      Number(l.qty_kg).toLocaleString("en-IN", { minimumFractionDigits: 3 }), money(l.rate), money(l.amount)]),
    foot: [["", "", "", "Taxable value", money(n.taxable)], ...taxRows, ["", "", "", "Round off", Number(n.round_off).toFixed(2)], ["", "", "", "Total", money(n.total)]],
    styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [60, 45, 35] }, footStyles: { fillColor: [245, 240, 232], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 10 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(8).text(["Rates exclude GST; GST is added on top.", "Calculated from our weighbridge and sorting records. Photos are available on request.",
    "Please issue a credit note against this debit note."], M, y);
  doc.setFontSize(9).text(`For ${COMPANY.name}`, W - M, 262, { align: "right" }).text("Authorised signatory", W - M, 278, { align: "right" });
  return doc.output("blob");
}
