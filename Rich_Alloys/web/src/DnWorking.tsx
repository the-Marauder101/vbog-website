// Supplier-facing DN working (PRD 7.5, output 1): quantity, rate and amount per line, plus photos of
// the rejected material. Print it or "Save as PDF" from the phone's share/print menu.
import { useEffect, useState } from "react";
import { rejectionPhotos, type DealFull, type DebitNote } from "./data";
import { day, inr, kg, rate } from "./format";
import type { Key } from "./i18n";

const US = {
  name: "Rich Alloys India Private Limited",
  gstin: "27AAMCR8303C1ZF",
  address: "Plot 33/34/35, Aamgaon Industrial Estate, Talasari–Sanjan Road, Palghar, Maharashtra 401606",
};

export default function DnWorking({ t, deal, dn, inv, onBack }: {
  t: (k: Key) => string; deal: DealFull; dn: DebitNote; inv: { invoice_no: string; invoice_date: string; gst_rate: number }; onBack: () => void;
}) {
  const [photos, setPhotos] = useState<{ url: string; pdf: boolean }[] | null>(null);
  useEffect(() => { rejectionPhotos(deal.id).then(setPhotos).catch(() => setPhotos([])); }, [deal.id]);
  const s = deal.suppliers;

  return (
    <div className="working">
      <div className="no-print actions">
        <button className="link back" onClick={onBack}>← {t("backToDns")}</button>
        <button className="btn primary" onClick={() => window.print()}>{t("printSave")}</button>
      </div>
      <article className="sheet-doc">
        <header>
          <h1>{t("dnWorkingTitle")}: {t(`dn_${dn.dn_type}` as Key)}</h1>
          <p><strong>{US.name}</strong><br />GSTIN {US.gstin}<br />{US.address}</p>
        </header>
        <dl className="meta">
          <dt>{t("to")}</dt><dd>{s.name}{s.gstin ? ` · GSTIN ${s.gstin}` : ""}</dd>
          <dt>{t("againstInvoice")}</dt><dd>{inv.invoice_no} · {day(inv.invoice_date)}</dd>
          <dt>{t("poDeal")}</dt><dd>{deal.po_no ?? "—"} · {deal.deal_no}</dd>
          <dt>{t("dnDate")}</dt><dd>{day(dn.dn_date)}</dd>
          {dn.tally_dn_no && <><dt>{t("tallyDnNo")}</dt><dd>{dn.tally_dn_no}</dd></>}
        </dl>
        <table className="lines">
          <thead><tr><th>{t("item")} · {t("qty")} × {t("rateCol")}</th><th>{t("amount")}</th></tr></thead>
          <tbody>
            {dn.debit_note_lines.map((l, i) => (
              <tr key={i}><td>{l.grade} · {l.description}<div className="small num-left">{kg(l.qty_kg)} × {rate(l.rate)}</div></td>
                <td className="num">{inr(l.amount)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={1}>{t("taxable")}</td><td className="num">{inr(dn.taxable)}</td></tr>
            <tr><td colSpan={1}>{t("gstAmount")} ({Number(inv.gst_rate)}%)</td><td className="num">{inr(dn.gst_amount)}</td></tr>
            {Number(dn.round_off) !== 0 && <tr><td colSpan={1}>{t("roundOff")}</td><td className="num">{inr(dn.round_off)}</td></tr>}
            <tr className="total"><td colSpan={1}>{t("dnTotal")}</td><td className="num">{inr(dn.total)}</td></tr>
          </tfoot>
        </table>
        <p className="small">{t("workingNote")}</p>
        <h2>{t("photosTitle")}</h2>
        {photos === null ? <p className="muted">{t("loading")}</p>
          : photos.length === 0 ? <p className="muted small">{t("noRejectionPhotos")}</p>
          : <div className="photos">{photos.map((p, i) => p.pdf
              ? <a key={i} href={p.url} target="_blank" rel="noopener">PDF {i + 1}</a>
              : <img key={i} src={p.url} alt={`${t("photosTitle")} ${i + 1}`} />)}</div>}
      </article>
    </div>
  );
}
