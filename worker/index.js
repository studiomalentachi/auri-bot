import fs from 'node:fs';
import path from 'node:path';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import makeWASocket,{DisconnectReason,useMultiFileAuthState,fetchLatestBaileysVersion,Browsers} from '@whiskeysockets/baileys';

const SITE=(process.env.AURI_SITE_URL||'').replace(/\/$/,'');
const TOKEN=process.env.AURI_WORKER_TOKEN||'';
const AUTH=path.resolve(process.env.PERSIST_DIR||'.','wa_auth');
const logger=pino({level:'silent'}); let sock=null; let connected=false;
if(!SITE||!TOKEN){console.error('Configure AURI_SITE_URL e AURI_WORKER_TOKEN.');process.exit(1)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(route,body={}){const r=await fetch(`${SITE}/api/${route}`,{method:'POST',headers:{'content-type':'application/json','x-auri-worker-token':TOKEN},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j}
function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function buildText(o){
 const title=o.customTitle||({shopee:'PREÇO DESPENCOU NA SHÔ 👀🔥',mercadolivre:'ACHADINHO NO MERCADO LIVRE 💛',shein:'ACHADINHO NA SHEIN 🖤✨',tiktokshop:'ACHADINHO NO TIKTOK SHOP 🛍️✨'}[o.marketplace]||'ACHADINHO ✨');
 const l=[title,'',o.name,'']; if(Number(o.originalPrice)>Number(o.price))l.push(`De: ~${money(o.originalPrice)}~`); l.push(`Por: *${money(o.price)}* ✅`);
 if(o.discountPct)l.push('',`Desconto: ${o.discountPct}%`); if(o.couponVerified&&o.couponCode)l.push('',`🎟️ Use cupom *${o.couponCode}*`); if(Number(o.rating)>0)l.push('',`Nota: ${Number(o.rating).toFixed(1).replace('.',',')}`);
 l.push('',`🛍️ Compre aqui: ${o.affiliateLink||o.link||o.publicLink||''}`); return l.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
async function syncGroups(){if(!connected)return;const all=await sock.groupFetchAllParticipating();const groups=Object.values(all).map(g=>({jid:g.id,name:g.subject||'Grupo'}));await call('sync-groups',{groups});console.log(`✅ ${groups.length} grupos sincronizados.`)}
async function start(){fs.mkdirSync(AUTH,{recursive:true});const {state,saveCreds}=await useMultiFileAuthState(AUTH);const {version}=await fetchLatestBaileysVersion();sock=makeWASocket({version,auth:state,logger,browser:Browsers.macOS('Chrome'),markOnlineOnConnect:false,syncFullHistory:false,generateHighQualityLinkPreview:true});sock.ev.on('creds.update',saveCreds);sock.ev.on('connection.update',async({connection,lastDisconnect,qr})=>{if(qr){console.log('Leia o QR com o WhatsApp:');qrcode.generate(qr,{small:true})}if(connection==='open'){connected=true;console.log('✅ WhatsApp conectado.');await syncGroups().catch(e=>console.error('Sync grupos:',e.message))}if(connection==='close'){connected=false;const code=lastDisconnect?.error?.output?.statusCode;if(code===DisconnectReason.loggedOut){console.error('Sessão encerrada. Apague wa_auth e conecte novamente.');return}setTimeout(()=>start().catch(console.error),5000)}})}
async function loop(){while(true){try{if(connected){const j=await call('next-dispatch');const item=j.item;if(item){const link=item.offer.affiliateLink||item.offer.link||item.offer.publicLink;if(!link)throw new Error('Oferta sem link');await sock.sendMessage(item.group.jid,{text:buildText(item.offer)});await call('dispatch-result',{queueId:item.id,ok:true});console.log(`✅ Enviado: ${item.offer.name} → ${item.group.name}`)}}}catch(e){console.error('Worker:',e.message)}await sleep(15000)}}
await start();await loop();
