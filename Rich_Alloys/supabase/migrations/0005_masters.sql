-- Starting master data. All of it can be changed in Admin.
insert into plants (name) values ('Palghar');

insert into items (code, name, name_hi, kind, sort) values
  ('COPPER_SCRAP','Copper scrap','कॉपर स्क्रैप','raw',1),
  ('PHOS_COPPER','Phosphorus copper','फॉस्फोरस कॉपर','raw',2),
  ('COPPER_INGOT','Copper ingot','कॉपर इंगट','finished',3),
  ('COPPER_GROSS_SLAG','Copper gross and slag','कॉपर ग्रॉस और स्लैग','byproduct',4);

insert into grades (code, name, name_hi, stock_item, sort) values
  ('OC','OC','ओसी','COPPER_SCRAP',1),
  ('LAL','Lal','लाल','COPPER_SCRAP',2);

-- From DNs 114-116 and the factory calls. Default actions for IRON, DHAAGI, KACHRA, RETI to be confirmed.
insert into sort_categories (code, name, name_hi, default_action, sort) values
  ('LEAD_COPPER','Lead copper','लेड कॉपर','rate_diff',1),
  ('DC','DC','डीसी','rate_diff',2),
  ('LOW_QUALITY','Low quality','हल्का माल','rate_diff',3),
  ('ATTACHMENT','Attachment','अटैचमेंट','return',4),
  ('MITTI','Mitti','मिट्टी','return',5),
  ('IRON','Iron','लोहा','return',6),
  ('DHAAGI','Dhaagi','धागी','return',7),
  ('KACHRA','Kachra','कचरा','return',8),
  ('RETI','Reti','रेती','return',9);

insert into doc_types (code, name, name_hi, side, sort) values
  ('PO','Purchase order','खरीद आदेश (PO)','supplier',1),
  ('TAX_INVOICE','Tax invoice','टैक्स इनवॉइस','supplier',2),
  ('E_INVOICE','E-invoice (IRN)','ई-इनवॉइस (IRN)','supplier',3),
  ('EWAY_BILL','E-way bill','ई-वे बिल','supplier',4),
  ('WEIGHBRIDGE_EXT','External weighbridge slip','बाहरी धर्मकांटा पर्ची','supplier',5),
  ('PACKING_SLIP','Packing slips by grade','ग्रेड अनुसार पैकिंग स्लिप','supplier',6),
  ('SEAL_PHOTOS','Seal photos with GPS','सील की फोटो (GPS सहित)','supplier',7),
  ('CONSIGNMENT_NOTE','Transporter consignment note / LR','ट्रांसपोर्टर बिल्टी (LR)','supplier',8),
  ('LOADING_PHOTOS','Loading photos with GPS','लोडिंग की फोटो (GPS सहित)','supplier',9),
  ('DRIVER_TRUCK_PHOTO','Driver with truck photo','ड्राइवर और ट्रक की फोटो','supplier',10),
  ('VAHAN_CHECK','Vahan vehicle check','वाहन पोर्टल जाँच','supplier',11),
  ('DRIVING_LICENCE','Driving licence front and back','ड्राइविंग लाइसेंस (आगे और पीछे)','supplier',12),
  ('WEIGHBRIDGE_FACTORY','Factory weighbridge slip','फैक्ट्री धर्मकांटा पर्ची','rich_alloys',20),
  ('RECEIPT_PHOTOS','Receipt photos','माल प्राप्ति की फोटो','rich_alloys',21),
  ('SEAL_CUT_PHOTO','Seal-cutting photo','सील काटने की फोटो','rich_alloys',22),
  ('SORTING_REPORT','Sorting report','छँटाई रिपोर्ट','rich_alloys',23),
  ('RETURN_DN','Material return debit note','माल वापसी डेबिट नोट','return',30),
  ('RETURN_EWAY','Return e-way bill','वापसी ई-वे बिल','return',31),
  ('RETURN_CHIT','Handwritten return chit','हाथ से लिखी वापसी पर्ची','return',32),
  ('RETURN_LR','Transporter LR for return','वापसी की बिल्टी (LR)','return',33);

-- Who does what. Changeable in Admin > Permissions.
insert into permissions (action, role)
select a, r from (values
  ('admin',             '{owner,vbog_admin}'),
  ('money_view',        '{owner,vbog_admin,deal_desk,factory_accounts,ho_accounts}'),
  ('deal_edit',         '{owner,vbog_admin,deal_desk,factory_accounts,ho_accounts}'),
  ('inward_edit',       '{owner,vbog_admin,factory,factory_accounts}'),
  ('sorting_edit',      '{owner,vbog_admin,factory,factory_accounts}'),
  ('lot_close',         '{owner,vbog_admin,factory,factory_accounts}'),
  ('doc_verify',        '{owner,vbog_admin,factory_accounts}'),
  ('doc_approve',       '{owner,vbog_admin}'),
  ('dn_approve',        '{owner,vbog_admin,factory_accounts}'),
  ('payment_enter',     '{owner,vbog_admin,factory_accounts,ho_accounts}'),
  ('payment_reconcile', '{vbog_admin,ho_accounts}'),
  ('tax_edit',          '{owner,vbog_admin,factory_accounts,ho_accounts}'),
  ('ledger_confirm',    '{vbog_admin,ho_accounts}'),
  ('tally_factory',     '{vbog_admin,factory_accounts}'),
  ('tally_office',      '{vbog_admin,ho_accounts}'),
  ('production_edit',   '{owner,vbog_admin,factory,factory_accounts}'),
  ('stock_edit',        '{owner,vbog_admin,factory_accounts}')
) x(a, roles), unnest(roles::text[]) r;
