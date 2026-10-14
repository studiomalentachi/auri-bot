const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
let state=null;
let groupsCache=[];
let key=sessionStorage.getItem('auriKey')||'';
let approvalFilter='Todos';
let queueFilter='Todos';

const platformInfo={
  shopee:{name:'Shopee',icon:'🧡'},
  mercadolivre:{name:'Mercado Livre',icon:'💛'},
  shein:{name:'SHEIN',icon:'🖤'}
};

const categoryOrder=['Todos','Casa & organização','Beleza','Moda','Tecnologia','Mercado','Pet','Infantil','Outros'];

function toast(msg,bad=false){
  const el=$('#toast');
  el.textContent=msg;
  el.style.background=bad?'#8f2938':'#3b2928';
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2800);
}

async function api(url,opts={}){
  const headers={...(opts.headers||{}),'x-auri-key':key};
  if(opts.body&&!(opts.body instanceof FormData))headers['content-type']='application/json';
  const res=await fetch(url,{...opts,headers});
  const data=await res.json().catch(()=>({}));
  if(res.status===401){showLogin(data.error||'Senha inválida.');throw new Error(data.error||'Não autorizado');}
  if(!res.ok||data.ok===false)throw new Error(data.error||`Erro ${res.status}`);
  return data;
}

async function login(){
  key=$('#password').value.trim();
  if(!key)return;
  try{
    const d=await api('/api/state');
    sessionStorage.setItem('auriKey',key);
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    state=d.state;
    render();
  }catch(e){$('#loginMsg').textContent=e.message;}
}

function showLogin(msg=''){
  sessionStorage.removeItem('auriKey');key='';
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#loginMsg').textContent=msg;
}

async function refresh(){
  const d=await api('/api/state');state=d.state;render();
}

function fmtMoney(n){
  const x=Number(n||0);
  return x?x.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
}
function fmtDate(v){
  if(!v)return '—';
  try{return new Date(v).toLocaleString('pt-BR');}catch{return v;}
}
function minsToTime(v){
  const n=Number(v||0),h=Math.floor(n/60),m=n%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function timeToMins(v){
  const[h,m]=String(v||'00:00').split(':').map(Number);return h*60+m;
}
function affiliate(item){return item?.product?.affiliateLink||item?.link||'';}
function linkPending(item){
  const a=String(affiliate(item)||'').trim();
  const p=String(item?.product?.publicLink||item?.product?.canonicalUrl||item?.product?.productLink||'').trim();
  return !a||(a===p&&item?.product?.affiliateLinkVerified!==true);
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}

function categoryOf(item){
  const p=item?.product||{};
  const t=norm([p.name,p.categoryName,p.shopName].filter(Boolean).join(' '));
  if(/pet|cachorr|gato|areia sanit|coleira|ração|racao/.test(t))return 'Pet';
  if(/brinquedo|infantil|criança|crianca|menina|menino|escolar/.test(t))return 'Infantil';
  if(/perfume|maquiagem|skincare|pele|cabelo|shampoo|condicionador|hidratante|serum|sérum|batom|base/.test(t))return 'Beleza';
  if(/vestido|blusa|camiseta|camisa|calça|calca|short|bermuda|saia|bolsa|sapato|sandalia|sandália|tênis|tenis|look|alfaiataria|moletom|jaqueta|acessorio|acessório/.test(t))return 'Moda';
  if(/fone|bluetooth|celular|smartphone|smartwatch|carregador|cabo usb|eletron|eletrôn|teclado|mouse|monitor|notebook|tablet|caixa de som|power bank/.test(t))return 'Tecnologia';
  if(/café|cafe|chocolate|biscoito|bebida|suco|refrigerante|alimento|comida|doce|snack|mercado/.test(t))return 'Mercado';
  if(/casa|cozinha|organiza|pote|toalha|cama|lençol|lencol|decora|móvel|movel|cadeira|mesa|armario|armário|luminaria|luminária|cafeteira|air fryer|liquidificador|eletrodom|aspirador|limpeza|tapete|cortina|banheiro/.test(t))return 'Casa & organização';
  return 'Outros';
}

function todayCount(){
  const today=new Date().toLocaleDateString('pt-BR');
  return (state.history||[]).filter(x=>{
    try{return new Date(x.sentAt).toLocaleDateString('pt-BR')===today;}catch{return false;}
  }).length;
}

function setStatus(id,on,labelOn,labelOff){
  const el=$(id);if(!el)return;
  el.classList.toggle('ok',on);
  el.classList.toggle('warn',!on);
  const text=el.childNodes[el.childNodes.length-1];
  if(text)text.textContent=` ${on?labelOn:labelOff}`;
}

function render(){
  if(!state)return;
  $('#navApproval').textContent=state.suggestions.length;
  $('#navQueue').textContent=state.queue.length;
  $('#statApproval').textContent=state.suggestions.length;
  $('#statQueue').textContent=state.queue.length;
  $('#statSent').textContent=todayCount();
  $('#sentLabel').textContent=`${state.history.length} no histórico recente`;
  $('#statAuto').textContent=state.autoDiscovery?'ON':'OFF';
  $('#statAuto').style.color=state.autoDiscovery?'#2b9563':'#8f2938';
  $('#lastDiscovery').textContent=state.lastDiscoveryAt?`última: ${fmtDate(state.lastDiscoveryAt)}`:'ainda não rodou';
  $('#autoDiscovery').checked=state.autoDiscovery;
  $('#autoQueue').checked=state.autoQueueDiscovery;
  $('#paused').checked=state.paused;

  $('#waDot').classList.toggle('ok',state.whatsappConnected);
  $('#waStatus').textContent=state.whatsappConnected?'WhatsApp conectado':'WhatsApp desconectado';
  $('#waDetail').textContent=state.targetGroups.length?`${state.targetGroups.length} grupo(s) selecionado(s)`:'nenhum grupo selecionado';

  setStatus('#statusWhats',state.whatsappConnected,'WhatsApp conectado','WhatsApp desconectado');
  setStatus('#statusSearch',state.autoDiscovery,'Auto busca ligada','Auto busca desligada');
  setStatus('#statusQueue',state.autoQueueDiscovery,'Auto fila ligada','Auto fila desligada');
  setStatus('#statusPause',!state.paused,'Envios ativos','Envios pausados');

  const settings=state.dashboardSettings||{};
  $('#sendStart').value=minsToTime(settings.sendStartMinutes??480);
  $('#sendEnd').value=minsToTime(settings.sendEndMinutes??1320);
  $('#sendInterval').value=String(settings.sendIntervalMinutes||10);
  $('#discoveryInterval').value=String(settings.discoveryEveryMinutes||120);
  const f=state.searchFilters||{};
  $('#minSales').value=String(f.minSales||50);
  $('#resultLimit').value=String(f.resultLimit||20);
  $('#sortBy').value=f.sortBy||'sales';
  $('#broadSearch').checked=f.broadSearch!==false;

  renderMarkets();
  renderCategorySummary();
  renderCategoryFilters('approvalFilters',state.suggestions,'approval');
  renderCategoryFilters('queueFilters',state.queue,'queue');
  renderOffers('approvalList',state.suggestions,'suggestions',approvalFilter);
  renderOffers('queueList',state.queue,'queue',queueFilter);
  renderHomeQueue();
  renderHistory();
  renderTrends();
}

function platformCounts(){
  const all=[...(state.suggestions||[]),...(state.queue||[])];
  return Object.fromEntries(Object.keys(platformInfo).map(id=>[id,all.filter(x=>x.product?.platform===id).length]));
}

function renderMarkets(){
  const enabled=new Set(state.enabledMarketplaces||[]);
  const counts=platformCounts();
  const html=Object.entries(platformInfo).map(([id,p])=>`
    <div class="market ${enabled.has(id)?'active':''}">
      <div><div class="icon">${p.icon}</div><strong>${p.name}</strong><small>${enabled.has(id)?'Ativo na pesquisa':'Desativado'}</small></div>
      <div style="text-align:right"><div class="market-count">${counts[id]||0}</div><small>no painel</small><label class="switch"><input class="marketToggle" data-market="${id}" type="checkbox" ${enabled.has(id)?'checked':''}><span></span></label></div>
    </div>`).join('');
  $('#marketCards').innerHTML=html;
  $('#marketSettings').innerHTML=html;
  $$('.marketToggle').forEach(el=>el.onchange=()=>setMarketplace(el.dataset.market,el.checked));
}

async function setMarketplace(id,checked){
  try{
    const enabled=new Set(state.enabledMarketplaces||[]);
    checked?enabled.add(id):enabled.delete(id);
    const d=await api('/api/settings',{method:'PATCH',body:JSON.stringify({enabledMarketplaces:[...enabled]})});
    state=d.state;render();toast(`${platformInfo[id]?.name||id} ${checked?'ativado':'desativado'}.`);
  }catch(e){toast(e.message,true);render();}
}

function renderCategorySummary(){
  const all=[...(state.suggestions||[]),...(state.queue||[])];
  const cats=categoryOrder.filter(x=>x!=='Todos').map(name=>({name,count:all.filter(x=>categoryOf(x)===name).length})).sort((a,b)=>b.count-a.count);
  $('#categorySummary').innerHTML=cats.slice(0,6).map(x=>`<div class="category-tile"><strong>${x.count}</strong><span>${esc(x.name)}</span></div>`).join('');
}

function renderCategoryFilters(id,list,type){
  const counts={Todos:list.length};
  list.forEach(x=>{const c=categoryOf(x);counts[c]=(counts[c]||0)+1;});
  const active=type==='approval'?approvalFilter:queueFilter;
  const html=categoryOrder.filter(c=>c==='Todos'||counts[c]).map(c=>`<button class="${active===c?'active':''}" data-filter="${esc(c)}" data-filter-type="${type}">${esc(c)} · ${counts[c]||0}</button>`).join('');
  $('#'+id).innerHTML=html;
  $$(`[data-filter-type="${type}"]`).forEach(b=>b.onclick=()=>{
    if(type==='approval')approvalFilter=b.dataset.filter;else queueFilter=b.dataset.filter;
    renderCategoryFilters(id,list,type);
    renderOffers(type==='approval'?'approvalList':'queueList',list,type==='approval'?'suggestions':'queue',b.dataset.filter);
  });
}

function card(item,index,kind){
  const p=item.product||{},info=platformInfo[p.platform]||{name:p.platform||'Oferta',icon:'🛍️'};
  const img=p.imageUrl||'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#f7efec"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="48">🛍️</text></svg>`);
  const pending=linkPending(item);
  const old=Number(p.originalPrice||0)>Number(p.price||0)?`<span class="old">${fmtMoney(p.originalPrice)}</span>`:'';
  const coupon=String(p.couponCode||p.coupon||'').trim();
  const cat=categoryOf(item);
  const actions=kind==='suggestions'
    ?`<button class="primary" data-action="approve" data-kind="${kind}" data-index="${index}">✓ Fila</button>
      <button class="ghost" data-action="preview" data-kind="${kind}" data-index="${index}">👁 Prévia</button>
      <button class="ghost" data-action="edit" data-kind="${kind}" data-index="${index}">✎ Editar campos</button>
      <button class="danger ghost" data-action="delete" data-kind="${kind}" data-index="${index}">Excluir</button>`
    :`<button class="primary" data-action="send" data-kind="${kind}" data-index="${index}">▶ Enviar</button>
      <button class="ghost" data-action="preview" data-kind="${kind}" data-index="${index}">👁 Prévia</button>
      <button class="ghost" data-action="edit" data-kind="${kind}" data-index="${index}">✎ Editar campos</button>
      <button class="ghost" data-action="up" data-kind="${kind}" data-index="${index}">↑</button>
      <button class="ghost" data-action="down" data-kind="${kind}" data-index="${index}">↓</button>
      <button class="danger ghost" data-action="delete" data-kind="${kind}" data-index="${index}">Excluir</button>`;
  return `<article class="offer-card">
    <img src="${esc(img)}" onerror="this.style.visibility='hidden'">
    <div class="body">
      <div class="offer-top"><div class="badges"><span class="badge ${esc(p.platform)}">${info.icon} ${esc(info.name)}</span><span class="badge category">${esc(cat)}</span></div>${pending?'<span class="badge warn">link pendente</span>':'<span class="badge">afiliado ✓</span>'}</div>
      <h3>${esc(p.name||'Produto')}</h3>
      <div class="meta"><span>🛒 ${Number(p.sales||0).toLocaleString('pt-BR')} vendas</span><span>⭐ ${Number(p.rating||0)?Number(p.rating).toFixed(1).replace('.',','):'—'}</span>${Number(p.discountPct||0)>0?`<span>🔥 ${Math.round(Number(p.discountPct))}%</span>`:''}</div>
      <div class="price">${old} ${fmtMoney(p.price)}</div>
      ${coupon&&p.couponVerified===true?`<div class="coupon-line">🎟️ Cupom ${esc(coupon)}</div>`:''}
      <div class="preview">${esc(item.text||'')}</div>
      <div class="card-actions">${actions}</div>
    </div>
  </article>`;
}

function renderOffers(id,list,kind,filter='Todos'){
  const el=$('#'+id);
  const pairs=list.map((item,index)=>({item,index})).filter(x=>filter==='Todos'||categoryOf(x.item)===filter);
  el.innerHTML=pairs.length?pairs.map(x=>card(x.item,x.index,kind)).join(''):`<div class="panel"><p class="hint">Nenhuma oferta nesta categoria.</p></div>`;
  $$('[data-action]',el).forEach(b=>b.onclick=()=>handleAction(b.dataset.action,b.dataset.kind,Number(b.dataset.index)));
}

function renderHomeQueue(){
  const el=$('#homeQueue');
  el.innerHTML=state.queue.length?state.queue.slice(0,6).map((item,i)=>{
    const p=item.product||{};
    return `<div class="mini-item"><img src="${esc(p.imageUrl||'')}"><div><strong>${esc(p.name||'Produto')}</strong><small>${platformInfo[p.platform]?.icon||'🛍️'} ${platformInfo[p.platform]?.name||p.platform||''} · ${esc(categoryOf(item))}</small></div><div class="right">#${i+1}<br>${fmtMoney(p.price)}</div></div>`;
  }).join(''):'<p class="hint">A fila está vazia. Aprove ofertas para começar.</p>';
}

function renderHistory(){
  $('#historyList').innerHTML=state.history.length?state.history.map(x=>`<div class="history-row"><div><strong>${esc(x.title||'Oferta')}</strong><small>${platformInfo[x.platform]?.icon||'🛍️'} ${esc(platformInfo[x.platform]?.name||x.platform||'')}</small></div><small>${fmtDate(x.sentAt)}</small></div>`).join(''):'<div class="panel"><p class="hint">Nenhum envio no histórico.</p></div>';
}

function renderTrends(){
  const d=state.dailyTrendTerms||{};
  $('#trendTerms').innerHTML=(d.terms||[]).map(x=>`<span class="chip">${esc(x)}</span>`).join('')||'<span class="hint">Sem tendências carregadas.</span>';
}

async function handleAction(action,kind,index){
  try{
    if(action==='delete'){
      if(!confirm('Excluir esta oferta?'))return;
      const d=await api(`/api/${kind}/${index}`,{method:'DELETE'});state=d.state;render();return;
    }
    if(action==='approve'){
      const d=await api(`/api/suggestions/${index}/approve`,{method:'POST'});state=d.state;render();toast('Oferta salva na fila.');return;
    }
    if(action==='preview'){
      const d=await api(`/api/${kind}/${index}/preview`);openPreview(d.preview);return;
    }
    if(action==='edit'){openEdit(kind,index);return;}
    if(action==='up'||action==='down'){
      const to=Math.max(0,Math.min(state.queue.length-1,index+(action==='up'?-1:1)));
      const d=await api(`/api/queue/${index}/move`,{method:'POST',body:JSON.stringify({to})});state=d.state;render();return;
    }
    if(action==='send'){
      if(!confirm('Enviar esta oferta agora para os grupos selecionados?'))return;
      const d=await api(`/api/queue/${index}/send`,{method:'POST'});state=d.state;render();toast('Oferta enviada.');return;
    }
  }catch(e){toast(e.message,true);}
}

function openPreview(text){
  $('#modalTitle').textContent='Prévia final do WhatsApp';
  $('#modalBody').innerHTML=`<pre class="trend-text">${esc(text)}</pre>`;
  $('#modal').classList.remove('hidden');
}

function openEdit(kind,index){
  const item=(kind==='queue'?state.queue:state.suggestions)[index],p=item.product||{};
  $('#modalTitle').textContent='Editar campos da oferta';
  $('#modalBody').innerHTML=`
    <div class="form-grid">
      <label class="field full">Título<input id="eTitle" value="${esc(p.customTitle||String(item.text||'').split('\n').find(x=>x.trim())||'')}"></label>
      <label class="field full">Nome do produto<input id="eName" value="${esc(p.name||'')}"></label>
      <label class="field">De:<input id="eOld" value="${p.originalPrice||''}" inputmode="decimal"></label>
      <label class="field">Por:<input id="ePrice" value="${p.price||''}" inputmode="decimal"></label>
      <label class="field">Desconto %<input id="eDiscount" value="${p.discountPct||''}" inputmode="decimal"></label>
      <label class="field">Nota<input id="eRating" value="${p.rating||''}" inputmode="decimal"></label>
      <label class="field">Cupom<input id="eCoupon" value="${esc(p.couponCode||p.coupon||'')}"></label>
      <label class="field">Link afiliado<input id="eAffiliate" value="${esc(affiliate(item))}"></label>
      <label class="field full">URL da foto<input id="eImage" value="${esc(p.imageUrl||'')}"></label>
      <label class="field full">Texto inteiro<textarea id="eText">${esc(item.text||'')}</textarea></label>
    </div>
    <div class="notice">Você pode corrigir só um campo e tocar em <strong>Salvar campos e regenerar</strong>. O texto inteiro só é usado quando você escolhe salvar exatamente como escreveu.</div>
    <div class="modal-actions"><button id="saveFields" class="secondary">Salvar campos e regenerar</button><button id="saveText" class="primary">Salvar texto exatamente assim</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#saveFields').onclick=()=>saveEdit(kind,index,false);
  $('#saveText').onclick=()=>saveEdit(kind,index,true);
}

async function saveEdit(kind,index,keepText){
  try{
    const body={title:$('#eTitle').value,name:$('#eName').value,oldPrice:$('#eOld').value,price:$('#ePrice').value,discount:$('#eDiscount').value,rating:$('#eRating').value,coupon:$('#eCoupon').value,affiliateLink:$('#eAffiliate').value,imageUrl:$('#eImage').value};
    if(keepText)body.text=$('#eText').value;
    const d=await api(`/api/${kind}/${index}`,{method:'PATCH',body:JSON.stringify(body)});
    state=d.state;render();$('#modal').classList.add('hidden');toast('Oferta atualizada.');
  }catch(e){toast(e.message,true);}
}

async function doSearch(){
  const keyword=$('#searchKeyword').value.trim();
  const platforms=$$('.searchPlatform').filter(x=>x.checked).map(x=>x.value);
  if(!keyword)return toast('Digite o que quer procurar.',true);
  if(!platforms.length)return toast('Escolha pelo menos um marketplace.',true);
  $('#searchMsg').textContent='Garimpando ofertas…';
  try{
    const d=await api('/api/search/manual',{method:'POST',body:JSON.stringify({keyword,platforms})});
    state=d.state;render();$('#searchMsg').textContent=`${d.found} oportunidade(s) nova(s) foram para a Caixa de aprovação.`;
    if(d.errors&&Object.keys(d.errors).length)toast('Um marketplace respondeu com erro; os demais continuaram.',true);
  }catch(e){$('#searchMsg').textContent=e.message;toast(e.message,true);}
}

async function toggle(field,el){
  try{await api('/api/toggle',{method:'POST',body:JSON.stringify({field,value:el.checked})});await refresh();}
  catch(e){el.checked=!el.checked;toast(e.message,true);}
}

async function autoSearchNow(){
  try{
    toast('Auto busca iniciada…');
    const d=await api('/api/search/auto',{method:'POST'});state=d.state;render();toast(`Busca concluída: ${d.found} oportunidade(s).`);
  }catch(e){toast(e.message,true);}
}

async function saveSchedule(){
  try{
    const dashboardSettings={sendStartMinutes:timeToMins($('#sendStart').value),sendEndMinutes:timeToMins($('#sendEnd').value),sendIntervalMinutes:Number($('#sendInterval').value),discoveryEveryMinutes:Number($('#discoveryInterval').value)};
    const d=await api('/api/settings',{method:'PATCH',body:JSON.stringify({dashboardSettings})});state=d.state;render();toast('Horários salvos.');
  }catch(e){toast(e.message,true);}
}

async function saveFilters(){
  try{
    const searchFilters={minSales:Number($('#minSales').value),resultLimit:Number($('#resultLimit').value),sortBy:$('#sortBy').value,broadSearch:$('#broadSearch').checked};
    const d=await api('/api/settings',{method:'PATCH',body:JSON.stringify({searchFilters})});state=d.state;render();toast('Filtros salvos.');
  }catch(e){toast(e.message,true);}
}

async function loadGroups(){
  try{
    const d=await api('/api/groups');groupsCache=d.groups||[];
    const selected=new Set((state.targetGroups||[]).map(x=>x.jid));
    $('#groupsList').innerHTML=groupsCache.map((g,i)=>`<label class="group-row"><input class="groupCheck" type="checkbox" data-index="${i}" ${selected.has(g.jid)?'checked':''}><span><strong>${esc(g.name||'Grupo')}</strong><small>${esc(g.jid||'')}</small></span></label>`).join('')||'<p class="hint">Nenhum grupo encontrado.</p>';
  }catch(e){toast(e.message,true);}
}

async function saveGroups(){
  try{
    const groups=$$('.groupCheck').filter(x=>x.checked).map(x=>groupsCache[Number(x.dataset.index)]);
    const d=await api('/api/groups',{method:'POST',body:JSON.stringify({groups})});state=d.state;render();toast('Grupos salvos.');
  }catch(e){toast(e.message,true);}
}

async function pair(){
  try{
    const d=await api('/api/whatsapp/pair',{method:'POST',body:JSON.stringify({phone:$('#phone').value})});
    $('#pairCode').textContent=d.code||'';toast('Código gerado.');
  }catch(e){toast(e.message,true);}
}

async function trends(){
  try{
    const d=await api('/api/trends/refresh',{method:'POST'});state=d.state;render();$('#trendText').textContent=d.text||'';toast('Tendências atualizadas.');
  }catch(e){toast(e.message,true);}
}

function go(view){
  $$('.nav-main button,.mobile-nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  $$('.view').forEach(x=>x.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  const titles={home:'Visão geral',approval:'Caixa de aprovação',queue:'Fila de envio',history:'Enviados',automation:'Automação',marketplaces:'Marketplaces',groups:'Grupos e WhatsApp',settings:'Configurações'};
  const subtitles={home:'Pesquise, aprove, organize e envie sem sair da Auri.',approval:'Revise os produtos antes de irem para a fila.',queue:'Controle a ordem real dos disparos do WhatsApp.',history:'Veja o que a Auri já enviou.',automation:'Defina horários, intervalos e filtros.',marketplaces:'Controle as fontes de pesquisa.',groups:'Escolha onde os achadinhos serão enviados.',settings:'Tendências e segurança do painel.'};
  $('#pageTitle').textContent=titles[view]||'Auri';
  $('#pageSub').textContent=subtitles[view]||'';
  if(view==='groups')loadGroups();
  window.scrollTo({top:0,behavior:'smooth'});
}

$('#loginBtn').onclick=login;
$('#password').onkeydown=e=>{if(e.key==='Enter')login();};
$('#refreshBtn').onclick=()=>refresh().catch(e=>toast(e.message,true));
$('#searchBtn').onclick=doSearch;
$('#searchKeyword').onkeydown=e=>{if(e.key==='Enter')doSearch();};
$('#autoDiscovery').onchange=e=>toggle('autoDiscovery',e.target);
$('#autoQueue').onchange=e=>toggle('autoQueueDiscovery',e.target);
$('#paused').onchange=e=>toggle('paused',e.target);
$('#autoSearchNow').onclick=autoSearchNow;
$('#autoSearchApproval').onclick=autoSearchNow;
$('#sendNowBtn').onclick=async()=>{try{const d=await api('/api/queue/send-next',{method:'POST'});state=d.state;render();toast('Próxima oferta enviada.');}catch(e){toast(e.message,true);}};
$('#saveSchedule').onclick=saveSchedule;
$('#saveFilters').onclick=saveFilters;
$('#loadGroups').onclick=loadGroups;
$('#saveGroups').onclick=saveGroups;
$('#pairBtn').onclick=pair;
$('#refreshTrends').onclick=trends;
$('#clearApproval').onclick=async()=>{if(!confirm('Apagar toda a Caixa de aprovação?'))return;try{const d=await api('/api/suggestions',{method:'DELETE'});state=d.state;render();}catch(e){toast(e.message,true);}};
$('#clearQueue').onclick=async()=>{if(!confirm('Esvaziar toda a fila?'))return;try{const d=await api('/api/queue',{method:'DELETE'});state=d.state;render();}catch(e){toast(e.message,true);}};
$('#logoutBtn').onclick=()=>showLogin();
$('#closeModal').onclick=()=>$('#modal').classList.add('hidden');
$('#modal').onclick=e=>{if(e.target.id==='modal')$('#modal').classList.add('hidden');};
$$('.nav-main button,.mobile-nav button').forEach(b=>b.onclick=()=>go(b.dataset.view));
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));

(async()=>{
  try{
    const h=await fetch('/api/health').then(r=>r.json());
    if(!h.passwordConfigured)$('#loginMsg').textContent='Configure DASHBOARD_PASSWORD no Railway antes de usar.';
    if(key){
      const d=await api('/api/state');state=d.state;
      $('#login').classList.add('hidden');$('#app').classList.remove('hidden');render();
    }
  }catch(e){}
})();
