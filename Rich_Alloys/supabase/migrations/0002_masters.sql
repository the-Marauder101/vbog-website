-- Masters needed in production: plant, grades, sorting categories, document checklist.
insert into plants (name) values ('Palghar');
insert into grades values ('OC','OC'), ('LAL','Lal');
insert into sort_categories values
  ('LEAD_COPPER','Lead copper','rate_diff'), ('DC','DC','rate_diff'), ('LOW_QUALITY','Low quality','rate_diff'),
  ('ATTACHMENT','Attachment','return'), ('MITTI','Mitti','return');

insert into doc_types (code, name, name_hi, side, sort) values
  ('PO','Purchase order','खरीद आदेश (PO)','supplier',1), ('TAX_INVOICE','Tax invoice','टैक्स इनवॉइस','supplier',2),
  ('E_INVOICE','E-invoice (IRN)','ई-इनवॉइस (IRN)','supplier',3), ('EWAY_BILL','E-way bill','ई-वे बिल','supplier',4),
  ('WEIGHBRIDGE_EXT','External weighbridge slip','बाहरी धर्मकांटा पर्ची','supplier',5), ('PACKING_SLIP','Packing slips by grade','ग्रेड अनुसार पैकिंग स्लिप','supplier',6),
  ('SEAL_PHOTOS','Seal photos with GPS','सील की फोटो (GPS सहित)','supplier',7), ('CONSIGNMENT_NOTE','Transporter consignment note / LR','ट्रांसपोर्टर बिल्टी (LR)','supplier',8),
  ('LOADING_PHOTOS','Loading photos with GPS','लोडिंग की फोटो (GPS सहित)','supplier',9), ('DRIVER_TRUCK_PHOTO','Driver with truck photo','ड्राइवर और ट्रक की फोटो','supplier',10),
  ('VAHAN_CHECK','Vahan vehicle check','वाहन पोर्टल जाँच','supplier',11), ('DRIVING_LICENCE','Driving licence front and back','ड्राइविंग लाइसेंस (आगे और पीछे)','supplier',12),
  -- Rich Alloys side: list still to be confirmed with Himanshu
  ('WEIGHBRIDGE_FACTORY','Factory weighbridge slip','फैक्ट्री धर्मकांटा पर्ची','rich_alloys',20), ('RECEIPT_PHOTOS','Receipt photos','माल प्राप्ति की फोटो','rich_alloys',21),
  ('SEAL_CUT_PHOTO','Seal-cutting photo','सील काटने की फोटो','rich_alloys',22), ('SORTING_REPORT','Sorting report','छँटाई रिपोर्ट','rich_alloys',23),
  ('RETURN_DN','Material return debit note','माल वापसी डेबिट नोट','return',30), ('RETURN_EWAY','Return e-way bill','वापसी ई-वे बिल','return',31),
  ('RETURN_CHIT','Handwritten return chit','हाथ से लिखी वापसी पर्ची','return',32), ('RETURN_LR','Transporter LR for return','वापसी की बिल्टी (LR)','return',33);

