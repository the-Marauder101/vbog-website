(function(){
  'use strict';
  const api=window.PravahApi;
  const state={context:null,placements:[],reports:[],checkins:[],actions:[],leads:[],deals:[],sales:[],stages:[],dashboard:null};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'--').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const today=()=>new Date().toISOString().slice(0,10);
  const money=(v,c='INR')=>v==null?'--':new Intl.NumberFormat('en-IN',{style:'currency',currency:c,maximumFractionDigits:0}).format(Number(v));
  const dateLabel=v=>v?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v)):'--';
  const dtLabel=v=>v?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'--';
  const badge=v=>{const x=String(v||'unknown').replaceAll('_',' ');return `<span class="badge badge-${esc(x.replaceAll(' ','-'))}">${esc(x)}</span>`};
  function setLoading(on){$('loading-bar').hidden=!on;$('sync-state').textContent=on?'Updating...':'Connected'}
  function toast(message,error=false){const t=$('toast');t.textContent=message;t.classList.toggle('error',error);t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  function stageLabel(code){return state.stages.find(s=>s.code===code)?.label||code||'--'}
  function isAdmin(){return state.context?.role==='client_admin'}
  function leadName(id){return state.leads.find(l=>l.id===id)?.full_name||'--'}
  function showSignedOut(){$('auth-screen').hidden=false;$('access-screen').hidden=true;$('app-shell').hidden=true}
  function showAccess(title,message){$('auth-screen').hidden=true;$('app-shell').hidden=true;$('access-screen').hidden=false;$('access-title').textContent=title;$('access-message').textContent=message}
  function showApp(){
    $('auth-screen').hidden=true;$('access-screen').hidden=true;$('app-shell').hidden=false;
    $('account-name').textContent=state.context.display_name||state.context.role;
    $('account-role').textContent=String(state.context.role||'client').replaceAll('_',' ');
    if(isAdmin()){
      const la=$('lead-actions');
      if(!la.querySelector('[data-modal="lead"]'))la.insertAdjacentHTML('afterbegin','<button class="button button-primary" data-modal="lead">Add lead</button>');
      const da=$('deal-actions');
      if(!da.querySelector('[data-modal="deal"]'))da.insertAdjacentHTML('afterbegin','<button class="button button-primary" data-modal="deal">Create deal</button>');
      const sa=$('sales-actions');
      if(!sa.querySelector('[data-modal="sale"]'))sa.insertAdjacentHTML('afterbegin','<button class="button button-primary" data-modal="sale">Record sale</button>');
    }
  }
  function showView(name){const target=$(name)||$('dashboard');document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v===target));document.querySelectorAll('.nav-link').forEach(v=>v.classList.toggle('active',v.dataset.view===target.id));$('view-name').textContent=target.dataset.title;document.querySelector('.sidebar').classList.remove('open')}

  async function load(){setLoading(true);try{
    state.context=await api.rpc('pravah_context');
    if(!state.context?.authorized||!['client_admin','client_viewer'].includes(state.context.role)){showAccess('Client portal unavailable.','Your account does not have client access. Contact your account manager for access.');return}
    showApp();
    const r=await Promise.all([
      api.rpc('pravah_client_portal'),
      api.fetch('pravah_v_placements?select=placement_id,closer_name,business_name,training_status,joined_on,total_sales,verified_cash,reported_cash&order=closer_name'),
      api.fetch('pravah_v_reports?select=*&order=period_end.desc&limit=100'),
      api.fetch('pravah_v_checkins?select=*&order=occurred_at.desc&limit=100'),
      api.fetch('pravah_v_actions?select=*&order=due_on.asc&limit=200'),
      api.fetch('pravah_revenue_leads?select=*&order=created_at.desc&limit=500'),
      api.fetch('pravah_revenue_deals?select=*&order=created_at.desc&limit=250'),
      api.fetch('pravah_revenue_sales?select=*&order=sale_date.desc&limit=250'),
      api.fetch('pravah_revenue_stages?select=*&active=eq.true&order=sort_order')
    ]);
    [state.dashboard,state.placements,state.reports,state.checkins,state.actions,state.leads,state.deals,state.sales,state.stages]=r;
    populateStageFilter();
    renderAll();showView(location.hash.slice(1)||'dashboard');
  }catch(e){if(String(e.code)==='401'){api.signOut();showSignedOut()}else showAccess('Pravah could not load.',e.message)}finally{setLoading(false)}}

  function populateStageFilter(){
    const sel=$('lead-stage-filter');
    sel.innerHTML='<option value="">All stages</option>'+state.stages.map(s=>`<option value="${esc(s.code)}">${esc(s.label)}</option>`).join('');
  }

  function renderAll(){renderDashboard();renderLeads();renderDeals();renderSales();renderClosers();renderReports();renderActions();renderCheckins()}

  /* ── 01 DASHBOARD ── */
  function renderDashboard(){
    const d=state.dashboard||{};
    $('metric-closers').textContent=d.active_closers??0;
    $('metric-leads').textContent=d.active_leads??state.leads.length;
    $('metric-revenue').textContent=money(d.total_revenue);
    $('metric-cash').textContent=money(d.total_cash);
    $('metric-pipeline').textContent=d.open_deals??0;
    $('metric-actions').textContent=d.open_actions??0;
    renderFunnel();
    $('roster-rows').innerHTML=state.placements.map(p=>`<tr><td><strong>${esc(p.closer_name)}</strong></td><td>${badge(p.training_status)}</td><td class="mono">${esc(p.total_sales??0)}</td><td class="mono">${money(p.verified_cash)}</td></tr>`).join('')||'<tr><td colspan="4"><div class="table-empty">No closers assigned yet.</div></td></tr>';
    const recent=state.checkins.slice(0,5);
    $('recent-checkin-rows').innerHTML=recent.map(c=>`<tr><td>${dateLabel(c.occurred_at)}</td><td>${badge(c.health)}</td><td>${esc(c.summary)}</td></tr>`).join('')||'<tr><td colspan="3"><div class="table-empty">No check-ins recorded.</div></td></tr>';
  }

  function renderFunnel(){
    const counts={};
    state.leads.forEach(l=>{const s=l.stage||'new';counts[s]=(counts[s]||0)+1});
    const funnel=state.stages.map(s=>({label:s.label,count:counts[s.code]||0}));
    const max=Math.max(1,...funnel.map(x=>x.count));
    $('dash-funnel').innerHTML=funnel.map(x=>`<div class="funnel-row"><span class="funnel-label">${esc(x.label)}</span><span class="funnel-track"><span class="funnel-fill" style="width:${Math.max(2,x.count/max*100)}%"></span></span><span class="funnel-count">${esc(x.count)}</span></div>`).join('')||'<div class="table-empty">No lead records yet.</div>';
  }

  /* ── 02 LEADS ── */
  function filteredLeads(){
    let list=state.leads;
    const q=($('lead-search').value||'').toLowerCase().trim();
    const stage=$('lead-stage-filter').value;
    if(q)list=list.filter(l=>(l.full_name||'').toLowerCase().includes(q)||(l.email||'').toLowerCase().includes(q)||(l.phone||'').toLowerCase().includes(q));
    if(stage)list=list.filter(l=>l.stage===stage);
    return list;
  }
  function renderLeads(){
    const list=filteredLeads();
    $('lead-count').textContent=list.length+' of '+state.leads.length+' leads';
    const admin=isAdmin();
    $('lead-rows').innerHTML=list.map(l=>{
      const stageSelect=admin?`<select class="inline-select" data-lead-stage="${esc(l.id)}">${state.stages.map(s=>`<option value="${esc(s.code)}"${s.code===l.stage?' selected':''}>${esc(s.label)}</option>`).join('')}</select>`:badge(stageLabel(l.stage));
      const actions=admin?`<button class="text-button" data-activity="${esc(l.id)}">Log</button><button class="text-button" data-deal-from-lead="${esc(l.id)}">Deal</button>`:'';
      return `<tr data-lead-row="${esc(l.id)}"><td><div class="customer-name"><strong class="lead-link" data-lead-detail="${esc(l.id)}">${esc(l.full_name)}</strong><small>${esc(l.email||l.phone||'No contact detail')}</small></div></td><td>${stageSelect}</td><td>${esc(l.source||'--')}</td><td>${dateLabel(l.last_activity_at)}</td><td class="row-action">${actions}</td></tr>`;
    }).join('')||'<tr><td colspan="5"><div class="table-empty">No leads yet. Add the first customer record.</div></td></tr>';
  }

  /* ── 03 PIPELINE ── */
  function renderDeals(){
    const open=state.deals.filter(d=>d.status==='open');
    const admin=isAdmin();
    $('deal-rows').innerHTML=open.map(d=>{
      const stageSelect=admin?`<select class="inline-select" data-deal-stage="${esc(d.id)}">${state.stages.map(s=>`<option value="${esc(s.code)}"${s.code===d.stage?' selected':''}>${esc(s.label)}</option>`).join('')}</select>`:badge(stageLabel(d.stage));
      const actions=admin?`<button class="text-button" data-sale-from-deal="${esc(d.id)}">Record sale</button>`:'';
      return `<tr><td><strong>${esc(d.title)}</strong><small>${esc(d.notes||'')}</small></td><td>${esc(leadName(d.lead_id))}</td><td>${stageSelect}</td><td class="mono">${money(d.value,d.currency)}</td><td>${dateLabel(d.expected_close_on)}</td><td class="row-action">${actions}</td></tr>`;
    }).join('')||'<tr><td colspan="6"><div class="table-empty">No open deals.</div></td></tr>';
  }

  /* ── 04 SALES & CASH ── */
  function renderSales(){
    const d=state.dashboard||{};
    $('metric-sales-rev').textContent=money(d.total_revenue);
    $('metric-sales-mtd').textContent=money(d.mtd_revenue);
    $('metric-sales-cash').textContent=money(d.total_cash);
    $('metric-sales-mtd-cash').textContent=money(d.mtd_cash);
    $('sale-rows').innerHTML=state.sales.slice(0,100).map(s=>`<tr><td>${dateLabel(s.sale_date)}</td><td>${esc(leadName(s.lead_id))}</td><td class="mono">${money(s.net_amount,s.currency)}</td><td>${badge(s.status)}</td></tr>`).join('')||'<tr><td colspan="4"><div class="table-empty">No sales recorded.</div></td></tr>';
  }

  /* ── 06 CLOSERS ── */
  function renderClosers(){
    $('closer-rows').innerHTML=state.placements.map(p=>`<tr><td><strong>${esc(p.closer_name)}</strong></td><td>${dateLabel(p.joined_on)}</td><td>${badge(p.training_status)}</td><td class="mono">${esc(p.total_sales??0)}</td><td class="mono">${money(p.verified_cash)}</td><td class="mono">${money(p.reported_cash)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="table-empty">No closers assigned yet.</div></td></tr>';
  }
  function renderReports(){
    $('report-rows').innerHTML=state.reports.map(r=>`<tr><td>${dateLabel(r.period_start)} - ${dateLabel(r.period_end)}</td><td>${esc(r.closer_name)}</td><td class="mono">${esc(r.calls_attempted??0)}</td><td class="mono">${esc(r.sales_count??0)}</td><td class="mono">${money(r.cash_collected)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="table-empty">No performance reports yet.</div></td></tr>';
  }

  /* ── 07 ACTIONS & HISTORY ── */
  function renderActions(){
    const open=state.actions.filter(a=>a.status!=='done'&&a.status!=='closed');
    $('action-rows').innerHTML=open.map(a=>`<tr><td><strong>${esc(a.title)}</strong></td><td>${badge(a.priority)}</td><td>${dateLabel(a.due_on)}</td><td>${badge(a.status)}</td><td>${esc(a.owner_name||'--')}</td></tr>`).join('')||'<tr><td colspan="5"><div class="table-empty">No open actions.</div></td></tr>';
  }
  function renderCheckins(){
    $('checkin-rows').innerHTML=state.checkins.map(c=>`<tr><td>${dateLabel(c.occurred_at)}</td><td>${badge(c.health)}</td><td>${esc(c.summary)}</td><td>${c.material_issue?esc(c.material_issue):'--'}</td></tr>`).join('')||'<tr><td colspan="4"><div class="table-empty">No check-in history.</div></td></tr>';
  }

  /* ── Lead detail slide-out ── */
  async function openLeadDetail(leadId){
    const lead=state.leads.find(l=>l.id===leadId);
    if(!lead)return;
    $('lead-detail-backdrop').hidden=false;
    $('lead-detail-name').textContent=lead.full_name;
    $('lead-detail-eyebrow').textContent=stageLabel(lead.stage).toUpperCase();
    const body=$('lead-detail-body');
    body.innerHTML='<div class="detail-loading">Loading...</div>';
    const admin=isAdmin();
    let contactHtml=`<div class="detail-section"><h3>Contact</h3><div class="detail-grid">`;
    contactHtml+=`<div class="detail-field"><small>Name</small><span>${esc(lead.full_name)}</span></div>`;
    contactHtml+=`<div class="detail-field"><small>Email</small><span>${esc(lead.email||'--')}</span></div>`;
    contactHtml+=`<div class="detail-field"><small>Phone</small><span>${esc(lead.phone||'--')}</span></div>`;
    contactHtml+=`<div class="detail-field"><small>Source</small><span>${esc(lead.source||'--')}</span></div>`;
    contactHtml+=`<div class="detail-field"><small>Stage</small><span>${badge(stageLabel(lead.stage))}</span></div>`;
    contactHtml+=`<div class="detail-field"><small>Created</small><span>${dateLabel(lead.created_at)}</span></div>`;
    contactHtml+=`</div>`;
    if(lead.notes)contactHtml+=`<div class="detail-notes"><small>Notes</small><p>${esc(lead.notes)}</p></div>`;
    contactHtml+=`</div>`;
    if(admin){
      contactHtml+=`<div class="detail-section detail-actions-bar"><button class="button button-primary button-sm" data-modal="activity" data-seed-lead="${esc(lead.id)}">Log activity</button><button class="button button-secondary button-sm" data-modal="deal" data-seed-lead="${esc(lead.id)}">Create deal</button><button class="button button-secondary button-sm" data-modal="edit-lead" data-seed-lead="${esc(lead.id)}">Edit lead</button></div>`;
    }

    let dealsHtml='';
    const leadDeals=state.deals.filter(d=>d.lead_id===leadId);
    if(leadDeals.length){
      dealsHtml=`<div class="detail-section"><h3>Deals (${leadDeals.length})</h3><div class="detail-table"><table><thead><tr><th>Deal</th><th>Stage</th><th>Value</th></tr></thead><tbody>${leadDeals.map(d=>`<tr><td>${esc(d.title)}</td><td>${badge(stageLabel(d.stage))}</td><td class="mono">${money(d.value,d.currency)}</td></tr>`).join('')}</tbody></table></div></div>`;
    }

    let salesHtml='';
    const leadSales=state.sales.filter(s=>s.lead_id===leadId);
    if(leadSales.length){
      salesHtml=`<div class="detail-section"><h3>Sales (${leadSales.length})</h3><div class="detail-table"><table><thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${leadSales.map(s=>`<tr><td>${dateLabel(s.sale_date)}</td><td class="mono">${money(s.net_amount,s.currency)}</td><td>${badge(s.status)}</td></tr>`).join('')}</tbody></table></div></div>`;
    }

    let activitiesHtml='<div class="detail-section"><h3>Activity timeline</h3><div class="detail-loading">Loading activities...</div></div>';
    body.innerHTML=contactHtml+dealsHtml+salesHtml+activitiesHtml;

    try{
      const activities=await api.fetch('pravah_revenue_activities?lead_id=eq.'+leadId+'&select=*&order=occurred_at.desc&limit=50');
      const timelineEl=body.querySelector('.detail-section:last-child');
      if(activities&&activities.length>0){
        timelineEl.innerHTML=`<h3>Activity timeline (${activities.length})</h3><div class="timeline">${activities.map(a=>`<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><div class="timeline-head"><span>${badge(a.activity_type)}</span><small>${dtLabel(a.occurred_at)}</small></div>${a.outcome?`<p class="timeline-outcome">${esc(a.outcome)}</p>`:''}${a.notes?`<p class="timeline-notes">${esc(a.notes)}</p>`:''}${a.duration_seconds?`<small class="mono">${a.duration_seconds}s</small>`:''}</div></div>`).join('')}</div>`;
      }else{
        timelineEl.innerHTML='<h3>Activity timeline</h3><div class="table-empty">No activities recorded.</div>';
      }
    }catch(e){
      const timelineEl=body.querySelector('.detail-section:last-child');
      if(timelineEl)timelineEl.innerHTML='<h3>Activity timeline</h3><div class="table-empty">Could not load activities.</div>';
    }
  }
  function closeDetail(){$('lead-detail-backdrop').hidden=true;$('lead-detail-body').innerHTML=''}

  /* ── Inline stage updates ── */
  async function updateLeadStage(id,stage){try{setLoading(true);await api.rpc('pravah_client_update_lead',{p_lead_id:id,p_stage:stage});await load();toast('Lead stage updated.')}catch(e){toast(e.message,true)}finally{setLoading(false)}}
  async function updateDealStage(id,stage){try{setLoading(true);await api.rpc('pravah_client_update_deal',{p_deal_id:id,p_stage:stage});await load();toast('Deal stage updated.')}catch(e){toast(e.message,true)}finally{setLoading(false)}}

  /* ── Modals (client_admin only) ── */
  function openModal(type,seed){
    if(!isAdmin())return;
    const f=$('record-form');$('modal').hidden=false;f.dataset.type=type;
    const title={lead:'Add lead',activity:'Log activity',deal:'Create deal',sale:'Record sale','edit-lead':'Edit lead'}[type];
    $('modal-title').textContent=title;$('modal-eyebrow').textContent=type.replace('-',' ').toUpperCase();

    if(type==='lead'){
      f.innerHTML=`<div class="form-grid"><label>Customer name<input id="lead-name" required></label><label>Email<input id="lead-email" type="email"></label><label>Phone<input id="lead-phone"></label><label>Source<input id="lead-source" placeholder="Meta, referral, inbound..."></label><label class="full">Notes<textarea id="lead-notes" rows="3"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Save lead</button></div>`;
    }

    if(type==='edit-lead'){
      const lead=seed?.lead?state.leads.find(l=>l.id===seed.lead):null;
      if(!lead){closeModal();return}
      f.innerHTML=`<div class="form-grid"><label>Email<input id="edit-lead-email" type="email" value="${esc(lead.email||'')}"></label><label>Phone<input id="edit-lead-phone" value="${esc(lead.phone||'')}"></label><label>Stage<select id="edit-lead-stage">${state.stages.map(s=>`<option value="${esc(s.code)}"${s.code===lead.stage?' selected':''}>${esc(s.label)}</option>`).join('')}</select></label><label class="full">Notes<textarea id="edit-lead-notes" rows="3">${esc(lead.notes||'')}</textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Update lead</button></div>`;
      f.dataset.leadId=lead.id;
    }

    if(type==='activity'){
      const leadOpts=state.leads.map(l=>`<option value="${esc(l.id)}">${esc(l.full_name)}</option>`).join('');
      f.innerHTML=`<div class="form-grid"><label>Customer<select id="activity-lead" required><option value="">Select customer</option>${leadOpts}</select></label><label>Type<select id="activity-type"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="follow_up">Follow-up</option><option value="note">Note</option></select></label><label>When<input id="activity-date" type="datetime-local" required></label><label>Duration (seconds)<input id="activity-duration" type="number" min="0"></label><label>Outcome<input id="activity-outcome"></label><label class="full">Notes<textarea id="activity-notes" rows="4"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Log activity</button></div>`;
      $('activity-date').value=new Date().toISOString().slice(0,16);
      if(seed?.lead)$('activity-lead').value=seed.lead;
    }

    if(type==='deal'){
      const leadOpts=state.leads.map(l=>`<option value="${esc(l.id)}">${esc(l.full_name)}</option>`).join('');
      const stageOpts=state.stages.map(s=>`<option value="${esc(s.code)}">${esc(s.label)}</option>`).join('');
      f.innerHTML=`<div class="form-grid"><label>Customer<select id="deal-lead" required><option value="">Select customer</option>${leadOpts}</select></label><label>Deal title<input id="deal-title" required></label><label>Value<input id="deal-value" type="number" min="0" step="0.01"></label><label>Currency<input id="deal-currency" value="INR"></label><label>Stage<select id="deal-stage">${stageOpts}</select></label><label>Expected close<input id="deal-close" type="date"></label><label class="full">Notes<textarea id="deal-notes" rows="3"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Create deal</button></div>`;
      if(seed?.lead)$('deal-lead').value=seed.lead;
    }

    if(type==='sale'){
      const leadOpts=state.leads.map(l=>`<option value="${esc(l.id)}">${esc(l.full_name)}</option>`).join('');
      const dealOpts=state.deals.filter(d=>d.status==='open').map(d=>`<option value="${esc(d.id)}">${esc(d.title)} · ${esc(leadName(d.lead_id))}</option>`).join('');
      f.innerHTML=`<div class="form-grid"><label>Customer<select id="sale-lead"><option value="">Select customer</option>${leadOpts}</select></label><label>Deal<select id="sale-deal"><option value="">No deal</option>${dealOpts}</select></label><label>Sale date<input id="sale-date" type="date" value="${today()}"></label><label>Currency<input id="sale-currency" value="INR"></label><label>Gross amount<input id="sale-gross" type="number" min="0" step="0.01" required></label><label>Discount<input id="sale-discount" type="number" min="0" step="0.01" value="0"></label><label>Net amount<input id="sale-net" type="number" min="0" step="0.01" required></label><label class="full">Notes<textarea id="sale-notes" rows="3"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Record sale</button></div>`;
      const sync=()=>{$('sale-net').value=Math.max(0,Number($('sale-gross').value||0)-Number($('sale-discount').value||0)).toFixed(2)};
      $('sale-gross').addEventListener('input',sync);$('sale-discount').addEventListener('input',sync);
      if(seed?.deal){
        $('sale-deal').value=seed.deal;
        const d=state.deals.find(x=>x.id===seed.deal);
        if(d&&d.lead_id)$('sale-lead').value=d.lead_id;
      }
    }
  }
  function closeModal(){$('modal').hidden=true;$('record-form').innerHTML=''}
  async function submitModal(){const type=$('record-form').dataset.type;setLoading(true);try{
    if(type==='lead')await api.rpc('pravah_client_create_lead',{p_full_name:$('lead-name').value,p_email:$('lead-email').value||null,p_phone:$('lead-phone').value||null,p_source:$('lead-source').value||null,p_notes:$('lead-notes').value||null});
    if(type==='edit-lead')await api.rpc('pravah_client_update_lead',{p_lead_id:$('record-form').dataset.leadId,p_stage:$('edit-lead-stage').value,p_notes:$('edit-lead-notes').value||null,p_email:$('edit-lead-email').value||null,p_phone:$('edit-lead-phone').value||null});
    if(type==='activity')await api.rpc('pravah_client_log_activity',{p_lead_id:$('activity-lead').value,p_activity_type:$('activity-type').value,p_occurred_at:new Date($('activity-date').value).toISOString(),p_outcome:$('activity-outcome').value||null,p_duration_seconds:$('activity-duration').value?Number($('activity-duration').value):null,p_notes:$('activity-notes').value||null});
    if(type==='deal')await api.rpc('pravah_client_create_deal',{p_lead_id:$('deal-lead').value,p_title:$('deal-title').value,p_value:Number($('deal-value').value||0),p_currency:$('deal-currency').value||'INR',p_stage:$('deal-stage').value,p_expected_close_on:$('deal-close').value||null,p_notes:$('deal-notes').value||null});
    if(type==='sale')await api.rpc('pravah_client_record_sale',{p_lead_id:$('sale-lead').value||null,p_deal_id:$('sale-deal').value||null,p_sale_date:$('sale-date').value,p_gross_amount:Number($('sale-gross').value||0),p_discount_amount:Number($('sale-discount').value||0),p_net_amount:Number($('sale-net').value||0),p_currency:$('sale-currency').value||'INR',p_notes:$('sale-notes').value||null});
    closeModal();closeDetail();await load();toast('Record saved.');
  }catch(e){toast(e.message,true)}finally{setLoading(false)}}

  /* ── CSV Import ── */
  const importState={csvHeaders:[],csvRows:[],rawCsv:'',fieldMap:{},stageMap:{},profileId:null,batchId:null,mappingVersionId:null};
  const TARGET_FIELDS=[
    {key:'',label:'-- skip --'},
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
      if(inQuotes){if(c==='"'&&text[i+1]==='"'){field+='"';i+=2}else if(c==='"'){inQuotes=false;i++}else{field+=c;i++}}
      else{if(c==='"'){inQuotes=true;i++}else if(c===','){row.push(field.trim());field='';i++}else if(c==='\n'||(c==='\r'&&text[i+1]==='\n')){row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);row=[];field='';i+=c==='\r'?2:1}else if(c==='\r'){row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);row=[];field='';i++}else{field+=c;i++}}
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
    if(fileInput.files&&fileInput.files.length>0){const reader=new FileReader();reader.onload=function(e){importProcessCsv(e.target.result)};reader.readAsText(fileInput.files[0])}
    else if(textArea.value.trim()){importProcessCsv(textArea.value)}
    else{toast('Please select a CSV file or paste CSV data.',true);return}
  }
  function importProcessCsv(raw){
    const parsed=parseCsv(raw);
    if(parsed.length<2){toast('CSV must have a header row and at least one data row.',true);return}
    importState.csvHeaders=parsed[0].map(h=>h.toLowerCase().replace(/[^a-z0-9_]/g,'_'));
    importState.csvRows=parsed.slice(1);
    importState.rawCsv=raw;
    $('preview-head').innerHTML='<tr>'+importState.csvHeaders.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr>';
    $('preview-body').innerHTML=importState.csvRows.slice(0,5).map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+(importState.csvRows.length>5?'<tr><td colspan="'+importState.csvHeaders.length+'"><div class="table-empty">+'+(importState.csvRows.length-5)+' more rows</div></td></tr>':'');
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
        $('stage-mapping-grid').innerHTML=uniqueStatuses.map(s=>'<label>'+esc(s)+'<select data-stage-map="'+esc(s)+'"><option value="">-- unmapped --</option>'+stageOpts+'</select></label>').join('');
      }else{stageSection.hidden=true}
    }else{stageSection.hidden=true}
    importSetStep(2);
  }
  function collectMappings(){
    const fieldMap={};
    document.querySelectorAll('[data-field-map]').forEach(sel=>{const idx=Number(sel.dataset.fieldMap);const target=sel.value;if(target)fieldMap[importState.csvHeaders[idx]]=target});
    const stageMap={};
    document.querySelectorAll('[data-stage-map]').forEach(sel=>{if(sel.value)stageMap[sel.dataset.stageMap.toLowerCase()]=sel.value});
    importState.fieldMap=fieldMap;importState.stageMap=stageMap;
    return{fieldMap,stageMap};
  }
  function mapRow(row,headers,fieldMap){
    const out={};headers.forEach((h,i)=>{const target=fieldMap[h];if(target&&row[i]!==undefined&&row[i]!=='')out[target]=row[i]});return out;
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
    if(!Object.values(fieldMap).includes('full_name')){toast('Map at least one column to "Customer name".',true);return}
    if(!Object.values(fieldMap).includes('contact_key')){toast('Map at least one column to "Phone / contact key".',true);return}
    const clientId=state.context.client_id;
    if(!clientId){toast('Client ID not found in your account context.',true);return}
    const sourceSystem=$('import-source').value.trim();
    const parserKey=$('import-parser').value;
    if(!sourceSystem){toast('Enter a source system name.',true);importSetStep(1);return}
    importSetStep(3);
    $('import-progress').innerHTML='';$('import-results').hidden=true;$('import-actions').innerHTML='';
    setLoading(true);
    try{
      addProgressStep('profile','Creating import profile...','active');
      const profileName=sourceSystem+'_csv_'+today();
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
      if(result.valid_count>0)$('import-actions').innerHTML='<button class="button button-primary" id="import-replay" type="button">Import '+result.valid_count+' valid rows now</button>';
      if(result.repair_count>0)toast(result.repair_count+' rows need repair. Valid rows can still be imported.',true);
      else toast('All rows validated successfully.');
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
    importState.csvHeaders=[];importState.csvRows=[];importState.rawCsv='';importState.fieldMap={};importState.stageMap={};importState.profileId=null;importState.batchId=null;importState.mappingVersionId=null;
    $('import-file').value='';$('import-csv').value='';$('import-progress').innerHTML='';$('import-results').hidden=true;$('import-actions').innerHTML='';
    importSetStep(1);
  }

  /* ── Search and filter ── */
  let searchTimer=null;
  $('lead-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderLeads,200)});
  $('lead-stage-filter').addEventListener('change',renderLeads);

  /* ── Event delegation ── */
  document.addEventListener('click',e=>{
    const t=e.target;
    if(t.matches('[data-modal]')&&isAdmin()){
      const seedLead=t.dataset.seedLead;
      openModal(t.dataset.modal,seedLead?{lead:seedLead}:undefined);
    }
    if(t.matches('[data-activity]')&&isAdmin())openModal('activity',{lead:t.dataset.activity});
    if(t.matches('[data-deal-from-lead]')&&isAdmin())openModal('deal',{lead:t.dataset.dealFromLead});
    if(t.matches('[data-sale-from-deal]')&&isAdmin())openModal('sale',{deal:t.dataset.saleFromDeal});
    if(t.matches('[data-lead-detail]'))openLeadDetail(t.dataset.leadDetail);
    if(t.matches('[data-close-detail]')||t===$('lead-detail-backdrop'))closeDetail();
    if(t.matches('[data-close-modal]')||t===$('modal'))closeModal();
    if(t.matches('[data-refresh]'))load();
    if(t.matches('[data-signout]')){api.signOut();showSignedOut()}
    if(t.id==='import-next-1')importParseAndPreview();
    if(t.id==='import-next-2')importStageAndValidate();
    if(t.id==='import-back-2')importSetStep(1);
    if(t.id==='import-back-3')importReset();
    if(t.id==='import-replay')importReplay();
  });
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.matches('[data-lead-stage]'))updateLeadStage(t.dataset.leadStage,t.value);
    if(t.matches('[data-deal-stage]'))updateDealStage(t.dataset.dealStage,t.value);
  });
  $('record-form').addEventListener('submit',e=>{e.preventDefault();submitModal()});
  $('signin-form').addEventListener('submit',async e=>{e.preventDefault();$('signin-error').textContent='';try{const f=new FormData(e.currentTarget);await api.signIn(f.get('email'),f.get('password'));window.location.href='../home/'}catch(err){$('signin-error').textContent=err.message}});
  document.querySelector('.mobile-nav').addEventListener('click',()=>{const open=document.querySelector('.sidebar').classList.toggle('open');document.querySelector('.mobile-nav').setAttribute('aria-expanded',String(open))});
  window.addEventListener('hashchange',()=>showView(location.hash.slice(1)||'dashboard'));
  if(api.restore())load();else showSignedOut();
})();
