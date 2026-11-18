// Demo mode: sample data held in memory so the screens can be shown without Supabase.
// The deal is the verified Ogo purchase (PO/RA/082/26-27). Nothing here is saved.
import type { Api } from "./api";
import type { Deal, Doc, DocType, Profile, Role } from "./types";

const types: DocType[] = ([
  ["PO", "Purchase order", "खरीद आदेश (PO)", "supplier"], ["TAX_INVOICE", "Tax invoice", "टैक्स इनवॉइस", "supplier"],
  ["E_INVOICE", "E-invoice (IRN)", "ई-इनवॉइस (IRN)", "supplier"], ["EWAY_BILL", "E-way bill", "ई-वे बिल", "supplier"],
  ["WEIGHBRIDGE_EXT", "External weighbridge slip", "बाहरी धर्मकांटा पर्ची", "supplier"], ["PACKING_SLIP", "Packing slips by grade", "ग्रेड अनुसार पैकिंग स्लिप", "supplier"],
  ["SEAL_PHOTOS", "Seal photos with GPS", "सील की फोटो (GPS सहित)", "supplier"], ["CONSIGNMENT_NOTE", "Transporter consignment note / LR", "ट्रांसपोर्टर बिल्टी (LR)", "supplier"],
  ["LOADING_PHOTOS", "Loading photos with GPS", "लोडिंग की फोटो (GPS सहित)", "supplier"], ["DRIVER_TRUCK_PHOTO", "Driver with truck photo", "ड्राइवर और ट्रक की फोटो", "supplier"],
  ["VAHAN_CHECK", "Vahan vehicle check", "वाहन पोर्टल जाँच", "supplier"], ["DRIVING_LICENCE", "Driving licence front and back", "ड्राइविंग लाइसेंस (आगे और पीछे)", "supplier"],
  ["WEIGHBRIDGE_FACTORY", "Factory weighbridge slip", "फैक्ट्री धर्मकांटा पर्ची", "rich_alloys"], ["RECEIPT_PHOTOS", "Receipt photos", "माल प्राप्ति की फोटो", "rich_alloys"],
  ["SEAL_CUT_PHOTO", "Seal-cutting photo", "सील काटने की फोटो", "rich_alloys"], ["SORTING_REPORT", "Sorting report", "छँटाई रिपोर्ट", "rich_alloys"],
  ["RETURN_DN", "Material return debit note", "माल वापसी डेबिट नोट", "return"], ["RETURN_EWAY", "Return e-way bill", "वापसी ई-वे बिल", "return"],
  ["RETURN_CHIT", "Handwritten return chit", "हाथ से लिखी वापसी पर्ची", "return"], ["RETURN_LR", "Transporter LR for return", "वापसी की बिल्टी (LR)", "return"],
] as const).map(([code, name, name_hi, side], i) => ({ code, name, name_hi, side, required: true, sort: i }));

const deal: Deal = {
  id: "demo-deal", deal_no: "RA-082", po_no: "PO/RA/082/26-27", deal_date: "2026-10-22", status: "dn_approved",
  suppliers: { name: "Ogo Enviro Solutions Private Limited" },
};

export function demoApi(): Api {
  let user: string | null = null;
  let role: Role = "ho_accounts";
  let listener: (u: string | null) => void = () => {};
  const files = new Map<string, string>();
  let docs: Doc[] = types.filter((t) => t.side !== "rich_alloys").map((t, i) => ({
    id: `seed-${i}`, doc_type: t.code, storage_path: "", status: "approved", note: null, uploaded_at: "2026-10-25T10:00:00+05:30",
  }));
  const find = (id: string) => {
    const d = docs.find((x) => x.id === id);
    if (!d) throw new Error("Document not found");
    return d;
  };

  return {
    demo: true,
    async currentUser() { return user; },
    onAuthChange(cb) { listener = cb; return () => { listener = () => {}; }; },
    async signIn() { user = "demo-user"; listener(user); },
    async signOut() { user = null; listener(null); },
    async profile(id): Promise<Profile> { return { id, full_name: "Demo user", role }; },
    setDemoRole(r) { role = r; },
    async deals() {
      const approved = new Set(docs.filter((d) => d.status === "approved").map((d) => d.doc_type));
      return { deals: [deal], gaps: { [deal.deal_no]: types.filter((t) => !approved.has(t.code)).length } };
    },
    async dealDocs() { return { types, docs: [...docs], hasReturn: true }; },
    async upload(_deal, docType, file) {
      const id = `demo-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      files.set(id, URL.createObjectURL(file));
      docs = [...docs, { id, doc_type: docType, storage_path: file.name, status: "uploaded", note: null, uploaded_at: new Date().toISOString() }];
    },
    async fileUrl(doc) {
      const u = files.get(doc.id);
      if (!u) throw new Error("Demo data has no file behind this entry.");
      return u;
    },
    async act(action, docId, note) {
      const d = find(docId);
      if (action === "verify_document") d.status = "verified";
      if (action === "approve_document") d.status = "approved";
      if (action === "reject_document") { d.status = "rejected"; d.note = note ?? ""; }
      docs = [...docs];
    },
  };
}
