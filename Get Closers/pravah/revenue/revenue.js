(function(){
  'use strict';
  const api=window.PravahApi;
  const state={context:null,clients:[],placements:[],stages:[],leads:[],deals:[],sales:[],payments:[],dashboard:null};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const today=()=>new Date().toISOString().slice(0,10);
  const money=(v,c='INR')=>v==null?'—':new Intl.NumberFormat('en-IN',{style:'currency',currency:c,maximumFractionDigits:0}).format(Number(v));
  const dateLabel=v=>v?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v)):'—';
  const badge=v=>{const x=String(v||'unknown').replaceAll('_',' ');return `<span class="badge badge-${esc(x.replaceAll(' ','-'))}">${esc(x)}</span>`};
  function setLoading(on){$('loading-bar').hidden=!on;$('sync-state').textContent=on?'Updating…':'Connected'}
  function toast(message,error=false){const t=$('toast');t.textContent=message;t.classList.toggle('error',error);t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  function clientName(id){return state.clients.find(c=>c.id===id)?.business_name||'Unknown client'}
  function placementName(id){const p=state.placements.find(x=>x.placement_id===id);return p?`${p.closer_name} · ${p.business_name}`:'Unassigned'}
  function leadName(id){return state.leads.find(l=>l.id===id)?.full_name||'Unknown customer'}
  function isAdmin(){return state.context?.is_admin===true}
  function showSignedOut(){$('auth-screen').hidden=false;$('access-screen').hidden=true;$('app-shell').hidden=true}
  function showAccess(title,message){$('auth-screen').hidden=true;$('app-shell').hidden=true;$('access-screen').hidden=false;$('access-title').textContent=title;$('access-message').textContent=message}
  function showApp(){$('auth-screen').hidden=true;$('access-screen').hidden=true;$('app-shell').hidden=false;$('account-name').textContent=state.context.display_name||state.context.role;$('account-role').textContent=String(state.context.role||'staff').replaceAll('_',' ')}
  function showView(name){const target=$(name)||$('dashboard');document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v===target));document.querySelectorAll('.nav-link').forEach(v=>v.classList.toggle('active',v.dataset.view===target.id));$('view-name').textContent=target.dataset.title;document.querySelector('.sidebar').classList.remove('open')}
  function fillSelect(id,items,placeholder,labelFn){const el=$(id);if(!el)return;el.innerHTML=`<option value="">${esc(placeholder)}</option>`+items.map(x=>`<option value="${esc(x.id||x.placement_id)}">${esc(labelFn(x))}</option>`).join('')}
  function formOptions(){
    fillSelect('client-filter',state.clients,'All clients',x=>x.business_name);
    ['lead-client','activity-client','deal-client','sale-client','payment-client','import-client'].forEach(id=>fillSelect(id,state.clients,'Select client',x=>x.business_name));
    ['lead-owner','activity-owner','deal-owner','sale-owner'].forEach(id=>fillSelect(id,state.placements,'Unassigned',x=>placementName(x.placement_id)));
    const stages=state.stages.map(s=>`<option value="${esc(s.code)}">${esc(s.label)}</option>`).join('');['lead-stage','deal-stage'].forEach(id=>{const el=$(id);if(el)el.innerHTML=stages});
    const leads=state.leads.map(l=>`<option value="${esc(l.id)}">${esc(l.full_name)} · ${esc(clientName(l.client_id))}</option>`).join('');['activity-lead','deal-lead','sale-lead'].forEach(id=>{const el=$(id);if(el)el.innerHTML='<option value="">No lead selected</option>'+leads});
    const deals=state.deals.map(d=>`<option value="${esc(d.id)}">${esc(d.title)} · ${esc(leadName(d.lead_id))}</option>`).join('');if($('sale-deal'))$('sale-deal').innerHTML='<option value="">No deal selected</option>'+deals;
    const sales=state.sales.map(s=>`<option value="${esc(s.id)}">${esc(dateLabel(s.sale_date))} · ${esc(leadName(s.lead_id))} · ${esc(money(s.net_amount,s.currency))}</option>`).join('');if($('payment-sale'))$('payment-sale').innerHTML='<option value="">Select sale</option>'+sales;
  }
  async function applyDashboard(showMessage){const start=$('period-start').value,end=$('period-end').value,client=$('client-filter').value;state.dashboard=await api.rpc('pravah_revenue_dashboard',{p_period_start:start,p_period_end:end,p_client_id:client||null});renderDashboard();if(showMessage)toast('Revenue view updated.')}
  async function load(){setLoading(true);try{
    state.context=await api.rpc('pravah_context');
    if(!state.context?.authorized){showAccess('Revenue workspace unavailable.','Staff access is approved through Nikash. Client and closer portals remain restricted until V6.');return}
    showApp();
    const r=await Promise.all([
      api.fetch('clients?select=id,business_name&order=business_name'),
      api.fetch('pravah_v_placements?select=placement_id,closer_name,business_name&placement_state=eq.active&order=closer_name'),
      api.fetch('pravah_revenue_stages?select=*&active=eq.true&order=sort_order'),
      api.fetch('pravah_revenue_leads?select=*&order=created_at.desc&limit=250'),
      api.fetch('pravah_revenue_deals?select=*&order=created_at.desc&limit=250'),
      api.fetch('pravah_revenue_sales?select=*&order=sale_date.desc&limit=250'),
      api.fetch('pravah_revenue_payments?select=*&order=payment_date.desc&limit=250')
    ]);
    [state.clients,state.placements,state.stages,state.leads,state.deals,state.sales,state.payments]=r;formOptions();
    if(!$('period-start').value)$('period-start').value=new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);
    if(!$('period-end').value)$('period-end').value=today();
    await applyDashboard(false);renderAll();showView(location.hash.slice(1)||'dashboard');
  }catch(e){if(String(e.code)==='401'){api.signOut();showSignedOut()}else showAccess('Pravah could not load.',e.message)}finally{setLoading(false)}}
  function renderAll(){renderDashboard();renderLeads();renderDeals();renderSales();renderPayments()}
  function renderDashboard(){const d=state.dashboard||{headline:{},funnel:[],clients:[],closers:[]},h=d.headline||{};$('metric-leads').textContent=h.active_leads??0;$('metric-pipeline').textContent=money(h.pipeline_value);$('metric-revenue').textContent=money(h.booked_revenue);$('metric-cash').textContent=money(h.verified_cash);$('metric-outstanding').textContent=money(h.outstanding);$('metric-conversion').textContent=h.conversion_rate==null?'—':`${h.conversion_rate}%`;
    const funnel=d.funnel||[],max=Math.max(1,...funnel.map(x=>Number(x.count||0)));$('funnel').innerHTML=funnel.map(x=>`<div class="funnel-row"><span class="funnel-label">${esc(x.label)}</span><span class="funnel-track"><span class="funnel-fill" style="width:${Math.max(2,Number(x.count||0)/max*100)}%"></span></span><span class="funnel-count">${esc(x.count)}</span></div>`).join('')||'<div class="table-empty">No lead records yet.</div>';
    $('client-rows').innerHTML=(d.clients||[]).map(x=>`<tr><td><strong>${esc(x.business_name)}</strong></td><td class="mono">${esc(x.leads)}</td><td class="mono">${esc(x.sales)}</td><td class="mono">${money(x.revenue)}</td><td class="mono">${money(x.cash)}</td><td class="mono">${money(x.pipeline)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="table-empty">No client revenue data.</div></td></tr>';
    $('closer-rows').innerHTML=(d.closers||[]).map(x=>`<tr><td><strong>${esc(x.closer_name)}</strong></td><td>${esc(x.business_name)}</td><td class="mono">${esc(x.leads)}</td><td class="mono">${esc(x.sales)}</td><td class="mono">${money(x.revenue)}</td><td class="mono">${money(x.cash)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="table-empty">No closer revenue data.</div></td></tr>';
  }
  function renderLeads(){$('lead-rows').innerHTML=state.leads.map(l=>`<tr><td><div class="customer-name"><strong>${esc(l.full_name)}</strong><small>${esc(l.email||l.phone||'No contact detail')}</small></div></td><td>${esc(clientName(l.client_id))}</td><td><select class="inline-select" data-lead-stage="${esc(l.id)}">${state.stages.map(s=>`<option value="${esc(s.code)}"${s.code===l.stage?' selected':''}>${esc(s.label)}</option>`).join('')}</select></td><td>${esc(placementName(l.owner_placement_id))}</td><td>${esc(l.source||'—')}</td><td>${dateLabel(l.last_activity_at)}</td><td class="row-action"><button class="text-button" data-activity="${esc(l.id)}">Log activity</button><button class="text-button" data-deal-from-lead="${esc(l.id)}">Deal</button></td></tr>`).join('')||'<tr><td colspan="7"><div class="table-empty">No leads yet. Add the first customer record.</div></td></tr>'}
  function renderDeals(){$('deal-rows').innerHTML=state.deals.filter(d=>d.status==='open').map(d=>`<tr><td><strong>${esc(d.title)}</strong><small>${esc(d.notes||'')}</small></td><td>${esc(leadName(d.lead_id))}</td><td>${esc(clientName(d.client_id))}</td><td><select class="inline-select" data-deal-stage="${esc(d.id)}">${state.stages.map(s=>`<option value="${esc(s.code)}"${s.code===d.stage?' selected':''}>${esc(s.label)}</option>`).join('')}</select></td><td>${esc(placementName(d.placement_id))}</td><td class="mono">${money(d.value,d.currency)}</td><td>${dateLabel(d.expected_close_on)}</td></tr>`).join('')||'<tr><td colspan="7"><div class="table-empty">No open opportunities.</div></td></tr>'}
  function renderSales(){$('sale-rows').innerHTML=state.sales.slice(0,100).map(s=>`<tr><td>${dateLabel(s.sale_date)}</td><td>${esc(leadName(s.lead_id))}</td><td>${esc(clientName(s.client_id))}</td><td>${esc(placementName(s.placement_id))}</td><td class="mono">${money(s.net_amount,s.currency)}</td><td>${badge(s.status)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="table-empty">No sales recorded.</div></td></tr>'}
  function renderPayments(){$('payment-rows').innerHTML=state.payments.slice(0,100).map(p=>`<tr><td>${dateLabel(p.payment_date)}</td><td class="mono">${money(p.amount,p.currency)}</td><td>${badge(p.status)}</td><td class="payment-evidence">${p.evidence_url?`<a href="${esc(p.evidence_url)}" target="_blank" rel="noopener">Evidence</a>`:'—'}</td><td class="row-action">${p.status==='pending'&&(isAdmin()||state.context?.role==='client_success')?`<button class="text-button" data-verify-payment="${esc(p.id)}">Verify</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5"><div class="table-empty">No payments recorded.</div></td></tr>'}
  function openModal(type,seed){const f=$('record-form');$('modal').hidden=false;f.dataset.type=type;const title={lead:'Customer / lead',activity:'Log activity',deal:'Create opportunity',sale:'Record sale',payment:'Record payment'}[type];$('modal-title').textContent=title;$('modal-eyebrow').textContent=type==='payment'?'PAYMENT EVIDENCE':type.toUpperCase();
    if(type==='lead')f.innerHTML=`<div class="form-grid"><label>Client<select id="lead-client" required></select></label><label>Owner<select id="lead-owner"></select></label><label>Customer name<input id="lead-name" required></label><label>Email<input id="lead-email" type="email"></label><label>Phone<input id="lead-phone"></label><label>Source<input id="lead-source" placeholder="Meta, referral, inbound…"></label><label>Stage<select id="lead-stage"></select></label><label class="full">Notes<textarea id="lead-notes" rows="3"></textarea></label></div>`;
    if(type==='activity')f.innerHTML=`<div class="form-grid"><label>Client<select id="activity-client" required></select></label><label>Customer<select id="activity-lead" required></select></label><label>Closer<select id="activity-owner"></select></label><label>Type<select id="activity-type"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="follow_up">Follow-up</option><option value="note">Note</option></select></label><label>When<input id="activity-date" type="datetime-local" required></label><label>Duration (seconds)<input id="activity-duration" type="number" min="0"></label><label>Outcome<input id="activity-outcome"></label><label class="full">Notes<textarea id="activity-notes" rows="4"></textarea></label></div>`;
    if(type==='deal')f.innerHTML=`<div class="form-grid"><label>Client<select id="deal-client" required></select></label><label>Customer<select id="deal-lead" required></select></label><label>Closer<select id="deal-owner"></select></label><label>Deal title<input id="deal-title" required></label><label>Value<input id="deal-value" type="number" min="0" step="0.01" required></label><label>Stage<select id="deal-stage"></select></label><label>Expected close<input id="deal-close" type="date"></label><label>Currency<input id="deal-currency" value="INR"></label><label class="full">Notes<textarea id="deal-notes" rows="3"></textarea></label></div>`;
    if(type==='sale')f.innerHTML=`<div class="form-grid"><label>Client<select id="sale-client" required></select></label><label>Closer<select id="sale-owner"></select></label><label>Customer<select id="sale-lead"></select></label><label>Deal<select id="sale-deal"></select></label><label>Sale date<input id="sale-date" type="date" value="${today()}"></label><label>Currency<input id="sale-currency" value="INR"></label><label>Gross amount<input id="sale-gross" type="number" min="0" step="0.01" required></label><label>Discount<input id="sale-discount" type="number" min="0" step="0.01" value="0"></label><label>Net revenue<input id="sale-net" type="number" min="0" step="0.01" required></label><label>Status<select id="sale-status"><option value="booked">Booked</option><option value="refunded">Refunded</option><option value="cancelled">Cancelled</option></select></label><label class="full">Notes<textarea id="sale-notes" rows="3"></textarea></label></div>`;
    if(type==='payment')f.innerHTML=`<div class="form-grid"><label>Client<select id="payment-client" required></select></label><label>Sale<select id="payment-sale" required></select></label><label>Payment date<input id="payment-date" type="date" value="${today()}"></label><label>Amount<input id="payment-amount" type="number" min="0" step="0.01" required></label><label>Currency<input id="payment-currency" value="INR"></label><label>Evidence URL<input id="payment-evidence" placeholder="Receipt / CRM record / sheet link"></label><label class="full">Evidence note<textarea id="payment-note" rows="3"></textarea></label></div><p class="helper">Payments start as pending evidence. They must be verified before they count as official cash.</p>`;
    formOptions();
    if(seed){if(type==='activity'){$('activity-lead').value=seed.lead||'';$('activity-client').value=seed.client||''}if(type==='deal'){$('deal-lead').value=seed.lead||'';$('deal-client').value=seed.client||''}if(type==='lead')$('lead-client').value=seed.client||''}
    if(type==='activity')$('activity-date').value=new Date().toISOString().slice(0,16);
    if(type==='sale'){const sync=()=>{$('sale-net').value=Math.max(0,Number($('sale-gross').value||0)-Number($('sale-discount').value||0)).toFixed(2)};$('sale-gross').addEventListener('input',sync);$('sale-discount').addEventListener('input',sync)}
  }
  function closeModal(){$('modal').hidden=true;$('record-form').innerHTML=''}
  async function submitModal(){const type=$('record-form').dataset.type;setLoading(true);try{
    if(type==='lead')await api.rpc('pravah_revenue_create_lead',{p_client_id:$('lead-client').value,p_full_name:$('lead-name').value,p_email:$('lead-email').value||null,p_phone:$('lead-phone').value||null,p_source:$('lead-source').value||null,p_owner_placement_id:$('lead-owner').value||null,p_stage:$('lead-stage').value,p_notes:$('lead-notes').value||null});
    if(type==='activity')await api.rpc('pravah_revenue_log_activity',{p_client_id:$('activity-client').value,p_lead_id:$('activity-lead').value,p_activity_type:$('activity-type').value,p_occurred_at:new Date($('activity-date').value).toISOString(),p_placement_id:$('activity-owner').value||null,p_outcome:$('activity-outcome').value||null,p_duration_seconds:$('activity-duration').value?Number($('activity-duration').value):null,p_notes:$('activity-notes').value||null});
    if(type==='deal')await api.rpc('pravah_revenue_create_deal',{p_client_id:$('deal-client').value,p_lead_id:$('deal-lead').value,p_title:$('deal-title').value,p_value:Number($('deal-value').value||0),p_currency:$('deal-currency').value||'INR',p_placement_id:$('deal-owner').value||null,p_stage:$('deal-stage').value,p_expected_close_on:$('deal-close').value||null,p_notes:$('deal-notes').value||null});
    if(type==='sale')await api.rpc('pravah_revenue_record_sale',{p_client_id:$('sale-client').value,p_deal_id:$('sale-deal').value||null,p_lead_id:$('sale-lead').value||null,p_placement_id:$('sale-owner').value||null,p_sale_date:$('sale-date').value,p_gross_amount:Number($('sale-gross').value||0),p_discount_amount:Number($('sale-discount').value||0),p_net_amount:Number($('sale-net').value||0),p_currency:$('sale-currency').value||'INR',p_status:$('sale-status').value,p_notes:$('sale-notes').value||null});
    if(type==='payment')await api.rpc('pravah_revenue_record_payment',{p_client_id:$('payment-client').value,p_sale_id:$('payment-sale').value,p_payment_date:$('payment-date').value,p_amount:Number($('payment-amount').value||0),p_currency:$('payment-currency').value||'INR',p_status:'pending',p_evidence_url:$('payment-evidence').value||null,p_evidence_note:$('payment-note').value||null});
    closeModal();await load();toast('Record saved.');
  }catch(e){toast(e.message,true)}finally{setLoading(false)}}
  async function updateLead(id,stage){try{setLoading(true);await api.rpc('pravah_revenue_update_lead',{p_lead_id:id,p_stage:stage});await load();toast('Lead stage updated.')}catch(e){toast(e.message,true)}finally{setLoading(false)}}
  async function updateDeal(id,stage){try{setLoading(true);await api.rpc('pravah_revenue_update_deal',{p_deal_id:id,p_stage:stage});await load();toast('Deal stage updated.')}catch(e){toast(e.message,true)}finally{setLoading(false)}}
  async function verifyPayment(id){const note=prompt('Evidence note for this payment (optional):','Verified against client / CRM evidence');if(note===null)return;const url=prompt('Evidence URL (optional):','');try{setLoading(true);await api.rpc('pravah_revenue_verify_payment',{p_payment_id:id,p_evidence_url:url||null,p_evidence_note:note||null});await load();toast('Payment verified.')}catch(e){toast(e.message,true)}finally{setLoading(false)}}
  /* ── CSV Import ── */
  const importState={csvHeaders:[],csvRows:[],fieldMap:{},stageMap:{},profileId:null,batchId:null,mappingVersionId:null};
  const TARGET_FIELDS=[
    {key:'',label:'— skip —'},
    {key:'full_name',label:'Customer name'},
    {key:'contact_key',label:'Phone / contact key'},
    {key:'email',label:'Email'},
    {key:'crm_status',label:'CRM status'},
    {key:'activity_type',label:'Activity type'},
    {key:'occurred_at',label:'Date / occurred at'},
    {key:'duration_seconds',label:'Duration (seconds)'},
    {key:'note',label:'Notes'},
    {key:'source_record_key',label:'Source record key'}
  ];
  const AUTO_MAP={'name':'full_name','full_name':'full_name','client_name':'full_name','customer':'full_name','customer_name':'full_name',
    'phone':'contact_key','mobile':'contact_key','contact':'contact_key','contact_key':'contact_key','client_number':'contact_key','number':'contact_key',
    'email':'email','email_id':'email','mail':'email',
    'status':'crm_status','crm_status':'crm_status','stage':'crm_status','lead_status':'crm_status',
    'type':'activity_type','activity_type':'activity_type','call_type':'activity_type','activity':'activity_type',
    'date':'occurred_at','occurred_at':'occurred_at','call_date':'occurred_at','created_at':'occurred_at','timestamp':'occurred_at','datetime':'occurred_at',
    'duration':'duration_seconds','duration_seconds':'duration_seconds','call_duration':'duration_seconds',
    'notes':'note','note':'note','remarks':'note','comment':'note','comments':'note',
    'source_record_key':'source_record_key','record_key':'source_record_key','id':'source_record_key','row_id':'source_record_key'};
  function parseCsv(text){
    const rows=[];let row=[],field='',inQuotes=false,i=0;
    while(i<text.length){
      const c=text[i];
      if(inQuotes){
        if(c==='"'&&text[i+1]==='"'){field+='"';i+=2}
        else if(c==='"'){inQuotes=false;i++}
        else{field+=c;i++}
      }else{
        if(c==='"'){inQuotes=true;i++}
        else if(c===','){row.push(field.trim());field='';i++}
        else if(c==='\n'||(c==='\r'&&text[i+1]==='\n')){row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);row=[];field='';i+=c==='\r'?2:1}
        else if(c==='\r'){row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);row=[];field='';i++}
        else{field+=c;i++}
      }
    }
    row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);
    return rows;
  }
  function simpleHash(str){let h=0;for(let i=0;i<str.length;i++){h=((h<<5)-h)+str.charCodeAt(i);h|=0}return Math.abs(h).toString(36)}
  function importSetStep(n){
    [1,2,3].forEach(s=>{const el=$('import-step-'+s);if(el)el.hidden=s!==n});
    document.querySelectorAll('.step-dot').forEach(d=>{const ds=Number(d.dataset.step);d.classList.toggle('active',ds===n);d.classList.toggle('done',ds<n)});
  }
  function importParseAndPreview(){
    const fileInput=$('import-file');const textArea=$('import-csv');
    if(fileInput.files&&fileInput.files.length>0){
      const reader=new FileReader();
      reader.onload=function(e){importProcessCsv(e.target.result)};
      reader.readAsText(fileInput.files[0]);
    }else if(textArea.value.trim()){
      importProcessCsv(textArea.value);
    }else{toast('Please select a CSV file or paste CSV data.',true);return}
  }
  function importProcessCsv(raw){
    const parsed=parseCsv(raw);
    if(parsed.length<2){toast('CSV must have a header row and at least one data row.',true);return}
    importState.csvHeaders=parsed[0].map(h=>h.toLowerCase().replace(/[^a-z0-9_]/g,'_'));
    importState.csvRows=parsed.slice(1);
    importState.rawCsv=raw;
    const thead=$('preview-head');const tbody=$('preview-body');
    thead.innerHTML='<tr>'+importState.csvHeaders.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr>';
    tbody.innerHTML=importState.csvRows.slice(0,5).map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('');
    if(importState.csvRows.length>5)tbody.innerHTML+='<tr><td colspan="'+importState.csvHeaders.length+'"><div class="table-empty">+'+(importState.csvRows.length-5)+' more rows</div></td></tr>';
    const grid=$('field-mapping-grid');
    grid.innerHTML=importState.csvHeaders.map((h,i)=>{
      const guess=AUTO_MAP[h]||'';
      return '<label>'+esc(parsed[0][i]||h)+'<select data-field-map="'+i+'">'+TARGET_FIELDS.map(f=>'<option value="'+esc(f.key)+'"'+(f.key===guess?' selected':'')+'>'+esc(f.label)+'</option>').join('')+'</select></label>';
    }).join('');
    const hasCrmStatus=importState.csvHeaders.some(h=>AUTO_MAP[h]==='crm_status');
    const stageSection=$('stage-mapping-section');
    if(hasCrmStatus){
      const crmIdx=importState.csvHeaders.findIndex(h=>AUTO_MAP[h]==='crm_status');
      const uniqueStatuses=[...new Set(importState.csvRows.map(r=>(r[crmIdx]||'').trim()).filter(Boolean))];
      if(uniqueStatuses.length>0){
        stageSection.hidden=false;
        const stageOpts=state.stages.map(s=>'<option value="'+esc(s.code)+'">'+esc(s.label)+'</option>').join('');
        $('stage-mapping-grid').innerHTML=uniqueStatuses.map(s=>'<label>'+esc(s)+'<select data-stage-map="'+esc(s)+'"><option value="">— unmapped —</option>'+stageOpts+'</select></label>').join('');
      }else{stageSection.hidden=true}
    }else{stageSection.hidden=true}
    importSetStep(2);
  }
  function collectMappings(){
    const fieldMap={};
    document.querySelectorAll('[data-field-map]').forEach(sel=>{
      const idx=Number(sel.dataset.fieldMap);const target=sel.value;
      if(target)fieldMap[importState.csvHeaders[idx]]=target;
    });
    const stageMap={};
    document.querySelectorAll('[data-stage-map]').forEach(sel=>{
      if(sel.value)stageMap[sel.dataset.stageMap.toLowerCase()]=sel.value;
    });
    importState.fieldMap=fieldMap;importState.stageMap=stageMap;
    return{fieldMap,stageMap};
  }
  function mapRow(row,headers,fieldMap){
    const out={};
    headers.forEach((h,i)=>{
      const target=fieldMap[h];
      if(target&&row[i]!==undefined&&row[i]!=='')out[target]=row[i];
    });
    return out;
  }
  function addProgressStep(id,label,status){
    const el=document.createElement('div');el.className='progress-step'+(status==='active'?' active':status==='done'?' done':'');el.id='prog-'+id;
    if(status==='active')el.innerHTML='<span class="spinner"></span> '+esc(label);
    else if(status==='done')el.innerHTML='<span class="check">OK</span> '+esc(label);
    else el.innerHTML='<span></span> '+esc(label);
    $('import-progress').appendChild(el);
  }
  function updateProgressStep(id,label,status){
    const el=$('prog-'+id);if(!el)return;
    el.className='progress-step'+(status==='active'?' active':status==='done'?' done':'');
    if(status==='active')el.innerHTML='<span class="spinner"></span> '+esc(label);
    else if(status==='done')el.innerHTML='<span class="check">OK</span> '+esc(label);
    else el.innerHTML='<span></span> '+esc(label);
  }
  async function importStageAndValidate(){
    const {fieldMap,stageMap}=collectMappings();
    const hasName=Object.values(fieldMap).includes('full_name');
    const hasContact=Object.values(fieldMap).includes('contact_key');
    if(!hasName){toast('Map at least one column to "Customer name".',true);return}
    if(!hasContact){toast('Map at least one column to "Phone / contact key".',true);return}
    const clientId=$('import-client').value;
    const sourceSystem=$('import-source').value.trim();
    const parserKey=$('import-parser').value;
    if(!clientId){toast('Select a client first.',true);importSetStep(1);return}
    if(!sourceSystem){toast('Enter a source system name.',true);importSetStep(1);return}
    importSetStep(3);
    $('import-progress').innerHTML='';
    $('import-results').hidden=true;
    $('import-actions').innerHTML='';
    setLoading(true);
    try{
      addProgressStep('profile','Creating import profile...',  'active');
      const profileName=sourceSystem+'_csv_'+new Date().toISOString().slice(0,10);
      const profileId=await api.rpc('pravah_import_create_profile',{
        p_client_id:clientId,p_source_system:sourceSystem,p_name:profileName,p_parser_key:parserKey,
        p_field_mapping:fieldMap,p_stage_mapping:stageMap
      });
      importState.profileId=profileId;
      updateProgressStep('profile','Import profile created ('+esc(profileName)+')','done');
      const mvRows=await api.fetch('pravah_import_mapping_versions?profile_id=eq.'+profileId+'&active=eq.true&order=version_no.desc&limit=1');
      if(!mvRows||mvRows.length===0)throw new Error('No active mapping version found for profile.');
      importState.mappingVersionId=mvRows[0].id;
      addProgressStep('stage','Staging '+importState.csvRows.length+' rows...','active');
      const checksum=simpleHash(importState.rawCsv);
      const hasRecordKey=Object.values(fieldMap).includes('source_record_key');
      const mappedRows=importState.csvRows.map((row,i)=>{
        const mapped=mapRow(row,importState.csvHeaders,fieldMap);
        if(!hasRecordKey||!mapped.source_record_key){
          const firstVal=row.find(v=>v&&v.trim())||String(i);
          mapped.source_record_key='row_'+(i+1)+'_'+simpleHash(firstVal);
        }
        return mapped;
      });
      const batchId=await api.rpc('pravah_import_stage_rows',{
        p_profile_id:profileId,p_mapping_version_id:importState.mappingVersionId,
        p_source_filename:($('import-file').files&&$('import-file').files[0])?$('import-file').files[0].name:'pasted_csv',
        p_source_checksum:checksum,p_rows:mappedRows
      });
      importState.batchId=batchId;
      updateProgressStep('stage','Staged '+mappedRows.length+' rows','done');
      addProgressStep('validate','Validating batch...','active');
      const result=await api.rpc('pravah_import_validate_batch',{p_batch_id:batchId});
      updateProgressStep('validate','Validation complete','done');
      $('import-results').hidden=false;
      $('import-total').textContent=importState.csvRows.length;
      $('import-valid').textContent=result.valid_count;
      $('import-repair').textContent=result.repair_count;
      $('import-imported').textContent='0';
      if(result.valid_count>0){
        $('import-actions').innerHTML='<button class="button button-primary" id="import-replay" type="button">Import '+result.valid_count+' valid rows now</button>';
      }
      if(result.repair_count>0){
        toast(result.repair_count+' rows need repair. Valid rows can still be imported.',true);
      }else{
        toast('All rows validated successfully.');
      }
    }catch(e){toast(e.message,true);addProgressStep('error','Error: '+e.message,'')}finally{setLoading(false)}
  }
  async function importReplay(){
    if(!importState.batchId){toast('No batch to replay.',true);return}
    setLoading(true);
    try{
      addProgressStep('replay','Importing valid rows...','active');
      const result=await api.rpc('pravah_import_replay_batch',{p_batch_id:importState.batchId});
      updateProgressStep('replay','Import complete','done');
      $('import-imported').textContent=result.imported_count;
      $('import-actions').innerHTML='';
      toast('Imported '+result.imported_count+' rows'+(result.duplicate_count>0?', '+result.duplicate_count+' duplicates skipped':'')+'.');
      await load();
    }catch(e){toast(e.message,true);addProgressStep('replay-err','Error: '+e.message,'')}finally{setLoading(false)}
  }
  function importReset(){
    importState.csvHeaders=[];importState.csvRows=[];importState.fieldMap={};importState.stageMap={};importState.profileId=null;importState.batchId=null;importState.mappingVersionId=null;importState.rawCsv='';
    $('import-file').value='';$('import-csv').value='';$('import-progress').innerHTML='';$('import-results').hidden=true;$('import-actions').innerHTML='';
    importSetStep(1);
    fillSelect('import-client',state.clients,'Select client',x=>x.business_name);
  }

  document.addEventListener('click',e=>{const t=e.target;if(t.matches('[data-modal]'))openModal(t.dataset.modal);if(t.matches('[data-activity]')){const l=state.leads.find(x=>x.id===t.dataset.activity);openModal('activity',{lead:l.id,client:l.client_id})}if(t.matches('[data-deal-from-lead]')){const l=state.leads.find(x=>x.id===t.dataset.dealFromLead);openModal('deal',{lead:l.id,client:l.client_id})}if(t.matches('[data-close-modal]')||t===$('modal'))closeModal();if(t.matches('[data-refresh]'))load();if(t.matches('[data-apply]')){setLoading(true);applyDashboard(true).finally(()=>setLoading(false))}if(t.matches('[data-verify-payment]'))verifyPayment(t.dataset.verifyPayment);if(t.matches('[data-signout]')){api.signOut();showSignedOut()}if(t.id==='import-next-1')importParseAndPreview();if(t.id==='import-next-2')importStageAndValidate();if(t.id==='import-back-2'){importSetStep(1)}if(t.id==='import-back-3'){importReset()}if(t.id==='import-replay')importReplay()});
  document.addEventListener('change',e=>{const t=e.target;if(t.matches('[data-lead-stage]'))updateLead(t.dataset.leadStage,t.value);if(t.matches('[data-deal-stage]'))updateDeal(t.dataset.dealStage,t.value)});
  $('record-form').addEventListener('submit',e=>{e.preventDefault();submitModal()});
  $('signin-form').addEventListener('submit',async e=>{e.preventDefault();$('signin-error').textContent='';try{const f=new FormData(e.currentTarget);await api.signIn(f.get('email'),f.get('password'));await load()}catch(err){$('signin-error').textContent=err.message}});
  document.querySelector('.mobile-nav').addEventListener('click',()=>{const open=document.querySelector('.sidebar').classList.toggle('open');document.querySelector('.mobile-nav').setAttribute('aria-expanded',String(open))});
  window.addEventListener('hashchange',()=>showView(location.hash.slice(1)||'dashboard'));
  if(api.restore())load();else showSignedOut();
})();
