(function(){
  'use strict';
  const api=window.PravahApi;
  const state={context:null,stages:[],leads:[],deals:[],placements:[],reports:[],targets:[],history:[],dashboard:null,submissions:[],scorecard:null,slot:'midday'};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const today=()=>new Date().toISOString().slice(0,10);
  const money=(v,c='INR')=>v==null?'—':new Intl.NumberFormat('en-IN',{style:'currency',currency:c,maximumFractionDigits:0}).format(Number(v));
  const dateLabel=v=>v?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v)):'—';
  const badge=v=>{const x=String(v||'unknown').replaceAll('_',' ');return `<span class="badge badge-${esc(x.replaceAll(' ','-'))}">${esc(x)}</span>`};
  const pct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;

  function setLoading(on){$('loading-bar').hidden=!on;$('sync-state').textContent=on?'Updating…':'Connected'}
  function toast(message,error=false){const t=$('toast');t.textContent=message;t.classList.toggle('error',error);t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  function leadName(id){return state.leads.find(l=>l.id===id)?.full_name||'Unknown customer'}
  function stageLabel(code){return state.stages.find(s=>s.code===code)?.label||code||'—'}

  function showSignedOut(){$('auth-screen').hidden=false;$('access-screen').hidden=true;$('app-shell').hidden=true}
  function showAccess(title,message){$('auth-screen').hidden=true;$('app-shell').hidden=true;$('access-screen').hidden=false;$('access-title').textContent=title;$('access-message').textContent=message}
  function showApp(){$('auth-screen').hidden=true;$('access-screen').hidden=true;$('app-shell').hidden=false;$('account-name').textContent=state.context.display_name||state.context.role;$('account-role').textContent=String(state.context.role||'closer').replaceAll('_',' ')}
  function showView(name){const target=$(name)||$('dashboard');document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v===target));document.querySelectorAll('.nav-link').forEach(v=>v.classList.toggle('active',v.dataset.view===target.id));$('view-name').textContent=target.dataset.title;document.querySelector('.sidebar').classList.remove('open')}

  async function load(){
    setLoading(true);
    try{
      state.context=await api.rpc('pravah_context');
      if(!state.context?.authorized||state.context.role!=='closer'){
        showAccess('Closer workspace unavailable.','Your closer workspace is not ready. Ask your account manager to activate your access.');
        return;
      }
      showApp();
      const r=await Promise.all([
        api.rpc('pravah_closer_portal'),
        api.fetch('pravah_revenue_stages?select=*&active=eq.true&order=sort_order'),
        api.fetch('pravah_revenue_leads?select=*&order=created_at.desc&limit=250'),
        api.fetch('pravah_revenue_deals?select=*&order=created_at.desc&limit=250'),
        api.fetch('pravah_v_placements?select=*&order=joined_on.desc&limit=10'),
        api.fetch('pravah_v_reports?select=*&order=period_start.desc&limit=50'),
        api.fetch('pravah_targets?select=*&order=period_start.desc&limit=50'),
        api.fetch('pravah_performance_reports?select=*&submitted_by_role=eq.closer&order=period_start.desc&limit=30'),
        api.rpc('pravah_closer_scorecard')
      ]);
      state.dashboard=r[0];
      state.stages=r[1];
      state.leads=r[2];
      state.deals=r[3];
      state.placements=r[4];
      state.reports=r[5];
      state.targets=r[6];
      state.submissions=r[7]||[];
      state.scorecard=r[8]||null;
      renderAll();
      showView(location.hash.slice(1)||'dashboard');
    }catch(e){
      if(String(e.code)==='401'){api.signOut();showSignedOut()}
      else showAccess('Pravah could not load.',e.message);
    }finally{setLoading(false)}
  }

  function renderAll(){renderDashboard();renderLeads();renderDeals();renderTargets();renderReportView();renderScorecard()}

  /* ── Daily report ────────────────────────────────────────────── */
  const NUMS=[['rep-calls','calls_attempted'],['rep-connected','connected_calls'],
    ['rep-qualified','qualified_opportunities'],['rep-meetings','meetings_booked'],
    ['rep-followups','followups_completed'],['rep-sales','sales_count']];
  const MONEY=[['rep-revenue','revenue_generated'],['rep-cash','cash_collected'],['rep-pipeline','pipeline_value']];
  const TEXTS=[['rep-blocker','blocker'],['rep-support','support_required'],['rep-plan','next_period_plan']];

  function submissionFor(date,slot){
    return state.submissions.find(s=>s.period_start===date&&s.report_slot===slot)||null;
  }
  function setSlot(slot){
    state.slot=slot;
    document.querySelectorAll('.slot-btn').forEach(b=>{
      const on=b.dataset.slot===slot;
      b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));
    });
    fillReportForm();
  }
  function fillReportForm(){
    const date=$('rep-date').value||today();
    const existing=submissionFor(date,state.slot);
    NUMS.concat(MONEY).forEach(([id,col])=>{$(id).value=existing&&existing[col]!=null?existing[col]:''});
    TEXTS.forEach(([id,col])=>{$(id).value=existing&&existing[col]?existing[col]:''});
    if(existing&&existing.currency)$('rep-currency').value=existing.currency;
    renderSlotStatus();
  }
  function renderSlotStatus(){
    const date=$('rep-date').value||today();
    const parts=['midday','eod'].map(slot=>{
      const s=submissionFor(date,slot);
      const label=slot==='midday'?'Midday':'End of day';
      if(!s)return `<span class="slot-chip pending">${label} · not submitted</span>`;
      if(s.discrepancy_status==='flagged')return `<span class="slot-chip flagged">${label} · figures disputed</span>`;
      return `<span class="slot-chip done">${label} · submitted</span>`;
    });
    $('slot-status').innerHTML=parts.join('');
  }
  function renderReportView(){
    if(!$('rep-date').value)$('rep-date').value=today();
    fillReportForm();
    const rows=state.submissions.slice(0,20).map(s=>{
      const st=s.discrepancy_status==='flagged'?'<span class="status-cancelled">Disputed</span>'
        :s.discrepancy_status==='resolved'?'<span class="status-pending">Resolved</span>'
        :'<span class="status-verified">Submitted</span>';
      return `<tr><td>${dateLabel(s.period_start)}</td><td>${esc(s.report_slot)}</td><td class="mono">${esc(s.calls_attempted??'—')}</td><td class="mono">${esc(s.sales_count??'—')}</td><td class="mono">${money(s.cash_collected,s.currency)}</td><td>${st}</td></tr>`;
    }).join('');
    $('submission-rows').innerHTML=rows||'<tr><td colspan="6"><div class="table-empty">No reports submitted yet.</div></td></tr>';
  }
  function whatsappMessage(){
    const date=$('rep-date').value||today();
    const slotName=state.slot==='midday'?'MIDDAY REPORT':'EOD REPORT';
    const name=state.context?.display_name||'Closer';
    const client=state.context?.client_name||'';
    const v=id=>{const x=$(id).value;return x===''?null:x};
    const line=(label,val)=>val==null?null:`${label}: ${val}`;
    const cur=$('rep-currency').value||'INR';
    const fmt=n=>n==null?null:new Intl.NumberFormat('en-IN',{style:'currency',currency:cur,maximumFractionDigits:0}).format(Number(n));
    const lines=[
      `*${slotName}* — ${dateLabel(date)}`,
      `${name}${client?' · '+client:''}`,
      '',
      line('Calls made',v('rep-calls')),
      line('Connected',v('rep-connected')),
      line('Positive leads',v('rep-qualified')),
      line('Meetings booked',v('rep-meetings')),
      line('Follow-ups',v('rep-followups')),
      line('Closed deals',v('rep-sales')),
      line('Revenue',fmt(v('rep-revenue'))),
      line('Cash collected',fmt(v('rep-cash'))),
      line('Pipeline',fmt(v('rep-pipeline')))
    ].filter(Boolean);
    const blocker=v('rep-blocker'),support=v('rep-support'),plan=v('rep-plan');
    if(blocker)lines.push('',`*Blocker:* ${blocker}`);
    if(support)lines.push(`*Support needed:* ${support}`);
    if(plan)lines.push(`*Next:* ${plan}`);
    return lines.join('\n');
  }
  function showWhatsapp(){
    $('wa-output').textContent=whatsappMessage();
    $('wa-panel').hidden=false;
  }
  async function copyWhatsapp(){
    const text=$('wa-output').textContent;
    try{
      if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text)}
      else{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
        document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)}
      toast('Message copied. Paste it into WhatsApp.');
    }catch(e){toast('Could not copy automatically — select the text and copy.',true)}
  }
  async function submitReport(){
    const num=id=>{const v=$(id).value;return v===''?null:Number(v)};
    const txt=id=>$(id).value.trim()||null;
    setLoading(true);
    try{
      await api.rpc('pravah_closer_submit_report',{
        p_report_slot:state.slot,
        p_report_date:$('rep-date').value||today(),
        p_calls_attempted:num('rep-calls'),
        p_connected_calls:num('rep-connected'),
        p_qualified_opportunities:num('rep-qualified'),
        p_meetings_booked:num('rep-meetings'),
        p_followups_completed:num('rep-followups'),
        p_sales_count:num('rep-sales'),
        p_revenue_generated:num('rep-revenue'),
        p_cash_collected:num('rep-cash'),
        p_pipeline_value:num('rep-pipeline'),
        p_currency:$('rep-currency').value||'INR',
        p_blocker:txt('rep-blocker'),
        p_support_required:txt('rep-support'),
        p_next_period_plan:txt('rep-plan')
      });
      showWhatsapp();
      await load();
      toast('Report submitted. Copy the WhatsApp message below.');
    }catch(e){toast(e.message,true)}finally{setLoading(false)}
  }

  /* ── Scorecard ───────────────────────────────────────────────── */
  function scoreClass(v){return v==null?'na':Number(v)>=100?'good':Number(v)>=80?'':'bad'}
  function renderScorecard(){
    const sc=state.scorecard;
    if(!sc){$('score-overall').textContent='—';$('kra-grid').innerHTML='';return}
    $('score-overall').textContent=sc.overall_score==null?'—':Number(sc.overall_score).toFixed(1);
    $('score-overall').className='score-big '+scoreClass(sc.overall_score);
    $('kra-grid').innerHTML=(sc.kras||[]).map(k=>{
      const d=k.detail||{};
      const detail=Object.entries(d).map(([key,val])=>
        `<div class="kra-detail"><span>${esc(key.replaceAll('_',' '))}</span><strong>${val==null?'—':esc(val)}</strong></div>`).join('');
      return `<article class="kra-card"><div class="kra-head"><h3>${esc(k.name)}</h3><span class="kra-weight">${esc(k.weight_pct)}%</span></div>
        <strong class="kra-score ${scoreClass(k.score)}">${k.score==null?'—':Number(k.score).toFixed(1)}</strong>
        <div class="kra-bar"><i style="width:${Math.min(100,Math.max(0,Number(k.score||0)/1.2))}%"></i></div>
        ${detail}</article>`;
    }).join('');
    const warn=(sc.data_warnings||[]);
    $('score-warnings').innerHTML=warn.length?warn.map(w=>`<div class="score-warning">${esc(w)}</div>`).join(''):'';
  }

  function renderDashboard(){
    const d=state.dashboard||{};
    $('metric-sales').textContent=d.total_sales??0;
    $('metric-cash').textContent=money(d.total_cash);
    const firstTarget=Array.isArray(d.current_targets)&&d.current_targets[0];
    $('metric-target').textContent=firstTarget?money(firstTarget.target_value):'—';
    const achv=firstTarget&&firstTarget.target_value&&d.total_revenue?((Number(d.total_revenue)/Number(firstTarget.target_value))*100):null;
    $('metric-achievement').textContent=pct(achv);

    // Placement info
    const p=state.placements[0];
    if(p){
      $('placement-info').innerHTML=`<div class="placement-detail"><div class="detail-row"><span class="detail-label">Client</span><span class="detail-value">${esc(p.business_name||'—')}</span></div><div class="detail-row"><span class="detail-label">Joined</span><span class="detail-value">${dateLabel(p.joined_on)}</span></div><div class="detail-row"><span class="detail-label">Training</span><span class="detail-value">${badge(p.training_status||'active')}</span></div><div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${badge(p.placement_state||'active')}</span></div></div>`;
    }else{
      $('placement-info').innerHTML='<div class="table-empty">No active placement found.</div>';
    }

    // Recent reports
    const reports=state.reports.slice(0,5);
    if(reports.length){
      $('report-list').innerHTML=reports.map(r=>`<div class="data-item"><div><strong>${dateLabel(r.period_start)} — ${dateLabel(r.period_end)}</strong></div><div><span class="mono">${esc(r.calls_attempted??'—')} calls</span><span class="mono">${esc(r.sales_count??'—')} sales</span><span class="mono">${money(r.cash_collected||r.verified_cash_collected)}</span></div></div>`).join('');
    }else{
      $('report-list').innerHTML='<div class="table-empty">No performance reports yet.</div>';
    }
  }

  function renderLeads(){
    $('lead-rows').innerHTML=state.leads.map(l=>`<tr><td><div class="customer-name"><strong>${esc(l.full_name)}</strong><small>${esc(l.email||'No email')}</small></div></td><td>${esc(l.phone||'—')}</td><td><select class="inline-select" data-lead-stage="${esc(l.id)}">${state.stages.map(s=>`<option value="${esc(s.code)}"${s.code===l.stage?' selected':''}>${esc(s.label)}</option>`).join('')}</select></td><td>${esc(l.source||'—')}</td><td>${dateLabel(l.last_activity_at)}</td><td class="row-action"><button class="text-button" data-activity="${esc(l.id)}">Log activity</button></td></tr>`).join('')||'<tr><td colspan="6"><div class="table-empty">No leads assigned to you yet.</div></td></tr>';
  }

  function renderDeals(){
    $('deal-rows').innerHTML=state.deals.filter(d=>d.status==='open').map(d=>`<tr><td><strong>${esc(d.title)}</strong><small>${esc(d.notes||'')}</small></td><td>${esc(leadName(d.lead_id))}</td><td><select class="inline-select" data-deal-stage="${esc(d.id)}">${state.stages.map(s=>`<option value="${esc(s.code)}"${s.code===d.stage?' selected':''}>${esc(s.label)}</option>`).join('')}</select></td><td class="mono">${money(d.value,d.currency)}</td><td>${dateLabel(d.expected_close_on)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="table-empty">No open deals.</div></td></tr>';
  }

  function renderTargets(){
    // Active targets
    const active=state.targets||[];
    $('target-rows').innerHTML=active.map(t=>{
      return `<tr><td>${dateLabel(t.period_start)} — ${dateLabel(t.period_end)}</td><td>${esc(t.target_unit||'—')}</td><td class="mono">${money(t.target_value)}</td><td class="mono">—</td><td class="mono">—</td></tr>`;
    }).join('')||'<tr><td colspan="5"><div class="table-empty">No active targets.</div></td></tr>';

    // Performance history from reports
    const history=state.reports||[];
    $('history-rows').innerHTML=history.map(r=>`<tr><td>${dateLabel(r.period_start)} — ${dateLabel(r.period_end)}</td><td class="mono">${esc(r.calls_attempted??'—')}</td><td class="mono">${esc(r.connected_calls??'—')}</td><td class="mono">${esc(r.sales_count??'—')}</td><td class="mono">${money(r.revenue_generated)}</td><td class="mono">${money(r.verified_cash_collected||r.cash_collected)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="table-empty">No performance history yet.</div></td></tr>';
  }

  /* --- Modals --- */
  function openModal(type,seed){
    const f=$('record-form');
    $('modal').hidden=false;
    f.dataset.type=type;

    if(type==='activity'){
      $('modal-title').textContent='Log activity';
      $('modal-eyebrow').textContent='ACTIVITY';
      const lead=seed?state.leads.find(x=>x.id===seed.lead):null;
      f.innerHTML=`<div class="form-grid">${lead?`<div class="full"><div class="record-context"><strong>${esc(lead.full_name)}</strong><span>${esc(lead.phone||lead.email||'No contact detail')}</span></div></div>`:''}<input type="hidden" id="activity-lead" value="${esc(seed?.lead||'')}"><label>Type<select id="activity-type"><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="follow_up">Follow-up</option><option value="note">Note</option></select></label><label>When<input id="activity-date" type="datetime-local" required></label><label>Duration (seconds)<input id="activity-duration" type="number" min="0"></label><label>Outcome<input id="activity-outcome"></label><label class="full">Notes<textarea id="activity-notes" rows="4"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Save activity</button></div>`;
      $('activity-date').value=new Date().toISOString().slice(0,16);
    }

    if(type==='deal'){
      $('modal-title').textContent='Create deal';
      $('modal-eyebrow').textContent='DEAL';
      const leadOpts=state.leads.map(l=>`<option value="${esc(l.id)}"${seed?.lead===l.id?' selected':''}>${esc(l.full_name)}</option>`).join('');
      const stageOpts=state.stages.map(s=>`<option value="${esc(s.code)}">${esc(s.label)}</option>`).join('');
      f.innerHTML=`<div class="form-grid"><label>Customer<select id="deal-lead" required><option value="">Select customer</option>${leadOpts}</select></label><label>Deal title<input id="deal-title" required></label><label>Value<input id="deal-value" type="number" min="0" step="0.01" required></label><label>Currency<input id="deal-currency" value="INR"></label><label>Stage<select id="deal-stage">${stageOpts}</select></label><label>Expected close<input id="deal-close" type="date"></label><label class="full">Notes<textarea id="deal-notes" rows="3"></textarea></label></div><div class="form-footer"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Create deal</button></div>`;
    }
  }

  function closeModal(){$('modal').hidden=true;$('record-form').innerHTML=''}

  async function submitModal(){
    const type=$('record-form').dataset.type;
    setLoading(true);
    try{
      if(type==='activity'){
        await api.rpc('pravah_revenue_log_activity',{
          p_client_id:state.context.client_id,
          p_lead_id:$('activity-lead').value,
          p_activity_type:$('activity-type').value,
          p_occurred_at:new Date($('activity-date').value).toISOString(),
          p_outcome:$('activity-outcome').value||null,
          p_duration_seconds:$('activity-duration').value?Number($('activity-duration').value):null,
          p_notes:$('activity-notes').value||null
        });
      }
      if(type==='deal'){
        await api.rpc('pravah_revenue_create_deal',{
          p_client_id:state.context.client_id,
          p_lead_id:$('deal-lead').value,
          p_placement_id:state.context.placement_id,
          p_title:$('deal-title').value,
          p_value:Number($('deal-value').value||0),
          p_currency:$('deal-currency').value||'INR',
          p_stage:$('deal-stage').value,
          p_expected_close_on:$('deal-close').value||null,
          p_notes:$('deal-notes').value||null
        });
      }
      closeModal();
      await load();
      toast('Record saved.');
    }catch(e){toast(e.message,true)}finally{setLoading(false)}
  }

  async function updateLeadStage(id,stage){
    try{setLoading(true);await api.rpc('pravah_revenue_update_lead',{p_lead_id:id,p_stage:stage});await load();toast('Lead stage updated.')}catch(e){toast(e.message,true)}finally{setLoading(false)}
  }

  async function updateDealStage(id,stage){
    try{setLoading(true);await api.rpc('pravah_revenue_update_deal',{p_deal_id:id,p_stage:stage});await load();toast('Deal stage updated.')}catch(e){toast(e.message,true)}finally{setLoading(false)}
  }

  /* --- Events --- */
  document.addEventListener('click',e=>{
    const t=e.target;
    if(t.matches('[data-modal]'))openModal(t.dataset.modal);
    if(t.matches('[data-activity]')){const l=state.leads.find(x=>x.id===t.dataset.activity);if(l)openModal('activity',{lead:l.id})}
    if(t.matches('[data-close-modal]')||t===$('modal'))closeModal();
    if(t.matches('[data-refresh]'))load();
    if(t.matches('[data-signout]')){api.signOut();showSignedOut()}
    if(t.matches('[data-change-password]')){$('pw-error').textContent='';$('pw-new').value='';$('pw-confirm').value='';$('pw-modal').hidden=false}
    if(t.matches('[data-close-pw]')||t===$('pw-modal')){$('pw-modal').hidden=true}
    const slotBtn=t.closest('.slot-btn');
    if(slotBtn)setSlot(slotBtn.dataset.slot);
    if(t.id==='wa-copy')copyWhatsapp();
  });

  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.matches('[data-lead-stage]'))updateLeadStage(t.dataset.leadStage,t.value);
    if(t.matches('[data-deal-stage]'))updateDealStage(t.dataset.dealStage,t.value);
    if(t.id==='rep-date')fillReportForm();
  });

  $('record-form').addEventListener('submit',e=>{e.preventDefault();submitModal()});

  $('pw-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const a=$('pw-new').value, b=$('pw-confirm').value, err=$('pw-error');
    err.textContent='';
    if(a!==b){err.textContent='Passwords do not match.';return}
    setLoading(true);
    try{
      await api.changePassword(a);
      $('pw-modal').hidden=true;
      toast('Password updated.');
    }catch(ex){err.textContent=ex.message}
    finally{setLoading(false)}
  });  $('report-form').addEventListener('submit',e=>{e.preventDefault();submitReport()});

  $('signin-form').addEventListener('submit',async e=>{
    e.preventDefault();
    $('signin-error').textContent='';
    try{
      const f=new FormData(e.currentTarget);
      await api.signIn(f.get('email'),f.get('password'));
      window.location.href='../home/';
    }catch(err){$('signin-error').textContent=err.message}
  });

  document.querySelector('.mobile-nav').addEventListener('click',()=>{
    const open=document.querySelector('.sidebar').classList.toggle('open');
    document.querySelector('.mobile-nav').setAttribute('aria-expanded',String(open));
  });

  window.addEventListener('hashchange',()=>showView(location.hash.slice(1)||'dashboard'));

  if(api.restore())load();else showSignedOut();
})();
