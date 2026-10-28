import { verifyToken, isWorkerAuthorized } from './lib/auth.mjs';
import { readState, writeState, id, nowIso, blockedProduct, randomMinutes } from './lib/state.mjs';
import { searchVerifiedOffers } from './lib/search.mjs';

function json(data,status=200){ return Response.json(data,{status}); }
function auth(request){ const h=request.headers.get('authorization')||''; return verifyToken(h.replace(/^Bearer\s+/i,'')); }
function route(request){ const u=new URL(request.url); return u.pathname.split('/').filter(Boolean).at(-1) || ''; }
function sanitizeOffer(o,state){
  const minSales=Number(state.settings.minimumConfirmedSales||50);
  if (blockedProduct(`${o.name||''} ${o.category||''}`, state.settings.blockedTerms)) throw new Error('Produto bloqueado pelas regras de categoria');
  if (o.salesVerified && Number(o.sales||0)<minSales) throw new Error(`Mínimo: ${minSales} vendas confirmadas`);
  return { ...o, price:Number(o.price||0), originalPrice:Number(o.originalPrice||0), rating:Number(o.rating||0), sales:Number(o.sales||0), updatedAt:nowIso() };
}
function normalizeCampaign(c){
  const min=Math.max(1,Number(c.minInterval||10)); const max=Math.max(min,Number(c.maxInterval||15));
  return { ...c, minInterval:min, maxInterval:max, dailyLimit:Math.max(1,Number(c.dailyLimit||85)), groupIds:Array.isArray(c.groupIds)?c.groupIds:[], nicheIds:Array.isArray(c.nicheIds)?c.nicheIds:[], offerIds:Array.isArray(c.offerIds)?c.offerIds:[], enabled:c.enabled!==false };
}

export default async (request) => {
  const isWorker = isWorkerAuthorized({ headers:Object.fromEntries(request.headers.entries()) });
  if (!isWorker && !auth(request)) return json({ok:false,error:'Não autorizado'},401);
  const r=route(request); const method=request.method; const body=method==='GET'?{}:await request.json().catch(()=>({}));
  const state=await readState();

  if (r==='state' && method==='GET') return json({ok:true,state});
  if (r==='reset' && method==='POST') { const { defaults } = await import('./lib/state.mjs'); const next=defaults(); await writeState(next); return json({ok:true,state:next}); }

  if (r==='search-offers' && method==='POST') {
    const keyword=String(body.keyword||'').trim(); if(!keyword) return json({ok:false,error:'Digite um termo para pesquisar'},400);
    const result=await searchVerifiedOffers({keyword,marketplace:body.marketplace||'all',minSales:Number(state.settings.minimumConfirmedSales||50),limit:Number(body.limit||20)});
    return json({ok:true,...result});
  }
  if (r==='save-captured-offer' && method==='POST') {
    let item={...body,id:body.id||id('offer'),createdAt:nowIso(),updatedAt:nowIso()}; item=sanitizeOffer(item,state);
    const exists=state.offers.find(x=>(x.marketplace===item.marketplace)&&((x.externalId&&x.externalId===item.externalId)||(x.publicLink&&x.publicLink===item.publicLink)));
    if(exists) return json({ok:true,item:exists,duplicate:true}); state.offers.push(item); await writeState(state); return json({ok:true,item},201);
  }
  if (r==='settings' && method==='PUT') { state.settings={...state.settings,...body}; await writeState(state); return json({ok:true,settings:state.settings}); }
  if (r==='marketplaces' && method==='PUT') { state.marketplaces=Array.isArray(body.marketplaces)?body.marketplaces:state.marketplaces; await writeState(state); return json({ok:true,marketplaces:state.marketplaces}); }

  const collections={ niches:'niches', groups:'groups', campaigns:'campaigns', offers:'offers', queues:'queues', coupons:'coupons', templates:'templates' };
  if (collections[r]) {
    const key=collections[r];
    if (method==='GET') return json({ok:true,items:state[key]});
    if (method==='POST') {
      let item={...body,id:body.id||id(r.slice(0,-1)),createdAt:nowIso(),updatedAt:nowIso()};
      if (key==='offers') item=sanitizeOffer(item,state);
      if (key==='campaigns') item=normalizeCampaign(item);
      state[key].push(item); await writeState(state); return json({ok:true,item},201);
    }
    if (method==='PUT') {
      const idx=state[key].findIndex(x=>x.id===body.id); if(idx<0) return json({ok:false,error:'Item não encontrado'},404);
      let item={...state[key][idx],...body,updatedAt:nowIso()}; if(key==='offers') item=sanitizeOffer(item,state); if(key==='campaigns') item=normalizeCampaign(item);
      state[key][idx]=item; await writeState(state); return json({ok:true,item});
    }
    if (method==='DELETE') {
      const u=new URL(request.url); const itemId=u.searchParams.get('id'); state[key]=state[key].filter(x=>x.id!==itemId); await writeState(state); return json({ok:true});
    }
  }

  if (r==='queue-offer' && method==='POST') {
    const offer=state.offers.find(x=>x.id===body.offerId); if(!offer) return json({ok:false,error:'Oferta não encontrada'},404);
    const campaign=body.campaignId?state.campaigns.find(x=>x.id===body.campaignId):null;
    const groupIds=body.groupIds?.length?body.groupIds:(campaign?.groupIds||[]);
    if(!groupIds.length) return json({ok:false,error:'Escolha ao menos um grupo'},400);
    for(const groupId of groupIds) state.queues.push({ id:id('q'), offerId:offer.id, campaignId:campaign?.id||null, groupId, nicheId:body.nicheId||campaign?.nicheIds?.[0]||null, status:'pending', scheduledAt:body.scheduledAt||null, createdAt:nowIso() });
    await writeState(state); return json({ok:true});
  }

  if (r==='next-dispatch' && method==='POST') {
    state.settings.workerOnline=true; state.settings.workerLastSeenAt=nowIso();
    const now=Date.now();
    const activeCampaigns=state.campaigns.filter(c=>c.enabled!==false && (!c.startAt||Date.parse(c.startAt)<=now) && (!c.endAt||Date.parse(c.endAt)>=now));
    const due=state.queues.find(q=>q.status==='pending' && (!q.scheduledAt||Date.parse(q.scheduledAt)<=now) && (!q.nextAttemptAt||Date.parse(q.nextAttemptAt)<=now) && (!q.campaignId||activeCampaigns.some(c=>c.id===q.campaignId)));
    await writeState(state);
    if(!due) return json({ok:true,item:null});
    const offer=state.offers.find(o=>o.id===due.offerId); const group=state.groups.find(g=>g.id===due.groupId); const campaign=state.campaigns.find(c=>c.id===due.campaignId);
    if(!offer||!group) return json({ok:true,item:null});
    return json({ok:true,item:{...due,offer,group,campaign,settings:{linkPreview:state.settings.linkPreview,sendImages:false,safeCouponsOnly:state.settings.safeCouponsOnly}}});
  }

  if (r==='dispatch-result' && method==='POST') {
    state.settings.workerOnline=true; state.settings.workerLastSeenAt=nowIso();
    const q=state.queues.find(x=>x.id===body.queueId); if(!q) return json({ok:false,error:'Fila não encontrada'},404);
    if(body.ok){
      q.status='sent'; q.sentAt=nowIso(); state.history.unshift({id:id('hist'),queueId:q.id,offerId:q.offerId,groupId:q.groupId,campaignId:q.campaignId,sentAt:q.sentAt,ok:true});
      const c=state.campaigns.find(x=>x.id===q.campaignId); if(c){ const mins=randomMinutes(c.minInterval,c.maxInterval); c.nextAt=new Date(Date.now()+mins*60000).toISOString(); const same=state.queues.filter(x=>x.campaignId===c.id&&x.status==='pending'); if(same.length) same[0].nextAttemptAt=c.nextAt; }
    } else { q.lastError=String(body.error||'Falha no envio'); q.nextAttemptAt=new Date(Date.now()+5*60000).toISOString(); }
    await writeState(state); return json({ok:true});
  }

  if (r==='sync-groups' && method==='POST') {
    if(!isWorker) return json({ok:false,error:'Somente worker'},403);
    const incoming=Array.isArray(body.groups)?body.groups:[];
    for(const g of incoming){ const found=state.groups.find(x=>x.jid===g.jid); if(found){found.name=g.name;found.updatedAt=nowIso();} else state.groups.push({id:id('grp'),jid:g.jid,name:g.name,nicheIds:[],enabled:true,createdAt:nowIso()}); }
    state.settings.workerOnline=true; state.settings.workerLastSeenAt=nowIso(); await writeState(state); return json({ok:true,groups:state.groups});
  }

  return json({ok:false,error:'Rota não encontrada'},404);
};
