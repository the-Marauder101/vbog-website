(function(){
  'use strict';
  const api=window.PravahApi;
  const state={context:null,placements:[],reports:[],checkins:[],actions:[],leads:[],sales:[],stages:[],dashboard:null};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'--').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const today=()=>new Date().toISOString().slice(0,10);
  const money=(v,c='INR')=>v==null?'--':new Intl.NumberFormat('en-IN',{style:'currency',currency:c,maximumFractionDigits:0}).format(Number(v));
  const dateLabel=v=>v?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v)):'--';
  const badge=v=>{const x=String(v||'unknown').replaceAll('_',' ');return `<span class="badge badge-${esc(x.replaceAll(' ','-'))}">${esc(x)}</span>`};
  function setLoading(on){$('loading-bar').hidden=!on;$('sync-state').textContent=on?'Updating...':'Connected'}
  function toast(message,error=false){const t=$('toast');t.textContent=message;t.classList.toggle('error',error);t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  function stageLabel(code){return state.stages.find(s=>s.code===code)?.label||code||'--'}
  function isAdmin(){return state.context?.role==='client_admin'}
  function showSignedOut(){$('auth-screen').hidden=false;$('access-screen').hidden=true;$('app-shell').hidden=true}
  function showAccess(title,message){$('auth-screen').hidden=true;$('app-shell').hidden=true;$('access-screen').hidden=false;$('access-title').textContent=title;$('access-message').textContent=message}
  function showApp(){
    $('auth-screen').hidden=true;$('access-screen').hidden=true;$('app-shell').hidden=false;
    $('account-name').textContent=state.context.display_name||state.context.role;
    $('account-role').textContent=String(state.context.role||'client').replaceAll('_',' ');
    if(isAdmin()){
      const acts=$('revenue-actions');
      if(!acts.querySelector('[data-modal="lead"]'))acts.insertAdjacentHTML('afterbegin','<button class="button button-primary" data-modal="lead">Add lead</button><button class="button button-secondary" data-modal="activity">Log activity</button>');
    }
  }
  function showView(name){const target=$(name)||$('dashboard');document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v===target));document.querySelectorAll('.nav-link').forEach(v=>v.classList.toggle('active',v.dataset.view===target.id));$('view-name').textContent=target.dataset.title;document.querySelector('.sidebar').classList.remove('open')}

  async function load(){setLoading(true);try{
    state.context=await api.rpc('pravah_context');
    if(!state.context?.authorized||!['client_admin','client_viewer'].includes(state.context.role)){showAccess('Client portal unavailable.','Your account does not have client access. Contact your account manager for access.');return}
    showApp();
    const r=await Promise.all([
      api.rpc('pravah_client_portal'),
      api.fetch('pravah_v_placements?select=placement_id,closer_name,business_name,training_status,joined_at,total_sales,verified_cash,reported_cash&order=closer_name'),
      api.fetch('pravah_v_reports?select=*&order=period_end.desc&limit=100'),
      api.fetch('pravah_v_checkins?select=*&order=occurred_at.desc&limit=100'),
      api.fetch('pravah_v_actions?select=*&order=due_on.asc&limit=200'),
      api.fetch('pravah_revenue_leads?select=*&order=created_at.desc&limit=250'),
      api.fetch('pravah_revenue_sales?select=*&order=sale_date.desc&limit=250'),
      api.fetch('pravah_revenue_stages?select=*&active=eq.true&order=sort_order')
    ]);
    [state.dashboard,state.placements,state.reports,state.checkins,state.actions,state.leads,state.sales,state.stages]=r;
    renderAll();showView(location.hash.slice(1)||'dashboard');
  }catch(e){if(String(e.code)==='401'){api.signOut();showSignedOut()}else showAccess('Pravah could not load.',e.message)}finally{setLoading(false)}}

  function renderAll(){renderDashboard();renderClosers();renderReports();renderRevenue();renderActions();renderCheckins()}

  function renderDashboard(){
    const d=state.dashboard||{};
    $('metric-closers').textContent=d.active_closers??0;
    $('metric-revenue').textContent=money(d.booked_revenue);
    $('metric-cash').textContent=money(d.verified_cash);
    $('metric-actions').textContent=d.open_actions??0;
    $('roster-rows').innerHTML=state.placements.map(p=>`<tr><td><strong>${esc(p.closer_name)}</strong></td><td>${badge(p.training_status)}</td><td class="mono">${esc(p.total_sales??0)}</td><td class="mono">${money(p.verified_cash)}</td></tr>`).join('')||'<tr><td colspan="4"><div class="table-empty">No closers assigned yet.</div></td></tr>';
    const recent=state.checkins.slice(0,5);
    $('recent-checkin-rows').innerHTML=recent.map(c=>`<tr><td>${dateLabel(c.occurred_at)}</td><td>${badge(c.health)}</td><td>${esc(c.summary)}</td></tr>`).join('')||'<tr><td colspan="3"><div class="table-empty">No check-ins recorded.</div></td></tr>';
  }

  function renderClosers(){
    $('closer-rows').innerHTML=state.placements.map(p=>`<tr><td><strong>${esc(p.closer_name)}</strong></td><td>${dateLabel(p.joined_at)}</td><td>${badge(p.training_status)}</td><td class="mono">${esc(p.total_sales??0)}</td><td class="mono">${money(p.verified_cash)}</td><td class="mono">${money(p.reported_cash)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="table-empty">No closers assigned yet.</div></td></tr>';
  }

  function renderReports(){
    $('report-rows').innerHTML=state.reports.map(r=>`<tr><td>${dateLabel(r.period_start)} - ${dateLabel(r.period_end)}</td><td>${esc(r.closer_name)}</td><td class="mono">${esc(r.total_calls??0)}</td><td class="mono">${esc(r.total_sales??0)}</td><td class="mono">${money(r.total_cash)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="table-empty">No performance reports yet.</div></td></tr>';
  }

  function renderRevenue(){
    const d=state.dashboard||{};
    $('metric-leads').textContent=d.active_leads??state.leads.length;
    $('metric-pipeline').textContent=money(d.open_pipeline);
    $('metric-rev-booked').textContent=money(d.booked_revenue);
    $('metric-rev-cash').textContent=money(d.verified_cash);
    $('lead-rows').innerHTML=state.leads.map(l=>`<tr><td><div class="customer-name"><strong>${esc(l.full_name)}</strong><small>${esc(l.email||l.phone||'No contact detail')}</small></div></td><td>${badge(stageLabel(l.stage))}</td><td>${dateLabel(l.last_activity_at)}</td></tr>`).join('')||'<tr><td colspan="3"><div class="table-empty">No leads yet.</div></td></tr>';
    $('sale-rows').innerHTML=state.sales.slice(0,100).map(s=>`<tr><td>${dateLabel(s.sale_date)}</td><td>${esc(s.customer_name||s.lead_id||'--')}</td><td class="mono">${money(s.net_amount,s.currency)}</td><td>${badge(s.status)}</td></tr>`).join('')||'<tr><td colspan="4"><div class="table-empty">No sales recorded.</div></td></tr>';
  }

  function renderActions(){
    const open=state.actions.filter(a=>a.status!=='done'&&a.status!=='closed');
    $('action-rows').innerHTML=open.map(a=>`<tr><td><strong>${esc(a.title)}</strong></td><td>${badge(a.priority)}</td><td>${dateLabel(a.due_on)}</td><td>${badge(a.status)}</td><td>${esc(a.owner_name||'--')}</td></tr>`).join('')||'<tr><td colspan="5"><div class="table-empty">No open actions.</div></td></tr>';
  }

  function renderCheckins(){
    $('checkin-rows').innerHTML=state.checkins.map(c=>`<tr><td>${dateLabel(c.occurred_at)}</td><td>${badge(c.health)}</td><td>${esc(c.summary)}</td><td>${c.material_issue?esc(c.material_issue):'--'}</td></tr>`).join('')||'<tr><td colspan="4"><div class="table-empty">No check-in history.</div></td></tr>';
  }

  /* --- Modals (client_admin only) --- */
  function openModal(type){
    if(!isAdmin())return;
    const f=$('record-form');$('modal').hidden=false;f.dataset.type=type;
    const title={lead:'Add lead',activity:'Log activity'}[type];
    $('modal-title').textContent=title;$('modal-eyebrow').textContent=type.toUpperCase();
    if(type==='lead')f.innerHTML=`<div class="form-grid"><label>Customer name<input id="lead-name" required></label><label>Email<input id="lead-email" type="email"></label><label>Phone<input id="lead-phone"></label><label>Source<input id="lead-source" placeholder="Meta, referral, inbound..."></label><label class="full">Notes<textarea id="lead-notes" rows="3"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Save lead</button></div>`;
    if(type==='activity'){
      const leadOpts=state.leads.map(l=>`<option value="${esc(l.id)}">${esc(l.full_name)}</option>`).join('');
      f.innerHTML=`<div class="form-grid"><label>Customer<select id="activity-lead" required><option value="">Select customer</option>${leadOpts}</select></label><label>Type<select id="activity-type"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="follow_up">Follow-up</option><option value="note">Note</option></select></label><label>When<input id="activity-date" type="datetime-local" required></label><label>Outcome<input id="activity-outcome"></label><label class="full">Notes<textarea id="activity-notes" rows="4"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Log activity</button></div>`;
      $('activity-date').value=new Date().toISOString().slice(0,16);
    }
  }
  function closeModal(){$('modal').hidden=true;$('record-form').innerHTML=''}
  async function submitModal(){const type=$('record-form').dataset.type;setLoading(true);try{
    if(type==='lead')await api.rpc('pravah_client_create_lead',{p_full_name:$('lead-name').value,p_email:$('lead-email').value||null,p_phone:$('lead-phone').value||null,p_source:$('lead-source').value||null,p_notes:$('lead-notes').value||null});
    if(type==='activity')await api.rpc('pravah_client_log_activity',{p_lead_id:$('activity-lead').value,p_activity_type:$('activity-type').value,p_occurred_at:new Date($('activity-date').value).toISOString(),p_outcome:$('activity-outcome').value||null,p_notes:$('activity-notes').value||null});
    closeModal();await load();toast('Record saved.');
  }catch(e){toast(e.message,true)}finally{setLoading(false)}}

  /* --- Event delegation --- */
  document.addEventListener('click',e=>{const t=e.target;if(t.matches('[data-modal]')&&isAdmin())openModal(t.dataset.modal);if(t.matches('[data-close-modal]')||t===$('modal'))closeModal();if(t.matches('[data-refresh]'))load();if(t.matches('[data-signout]')){api.signOut();showSignedOut()}});
  $('record-form').addEventListener('submit',e=>{e.preventDefault();submitModal()});
  $('signin-form').addEventListener('submit',async e=>{e.preventDefault();$('signin-error').textContent='';try{const f=new FormData(e.currentTarget);await api.signIn(f.get('email'),f.get('password'));window.location.href='../home/'}catch(err){$('signin-error').textContent=err.message}});
  document.querySelector('.mobile-nav').addEventListener('click',()=>{const open=document.querySelector('.sidebar').classList.toggle('open');document.querySelector('.mobile-nav').setAttribute('aria-expanded',String(open))});
  window.addEventListener('hashchange',()=>showView(location.hash.slice(1)||'dashboard'));
  if(api.restore())load();else showSignedOut();
})();
