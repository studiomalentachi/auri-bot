import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Telegraf, Markup } from 'telegraf';
import { availableAIProviders, generateOfferCopy } from './ai.js';
import { config } from './config.js';
import { discoverShopeeOffers } from './discovery.js';
import { importProductFromUrl, searchMarketplace } from './marketplaces.js';
import { getShopeeConversions, isShopeeConfigured } from './shopee.js';
import { enqueue, isDuplicate, readStore, removeFromQueue, setTargetGroups, updateStore } from './store.js';
import { isWhatsAppConnected, listWhatsAppGroups, requestWhatsAppPairingCode } from './whatsapp.js';
import { sendOneNow } from './scheduler.js';

const drafts = new Map();
let lastGroups = [];
let lastSearch = [];

const BTN = {
  newOffer: '➕ Nova oferta', linkOffer: '🔗 Oferta por link', search: '🔎 Buscar ofertas', queue: '📦 Fila',
  whatsapp: '📱 WhatsApp', groups: '👥 Grupos de envio', status: '📊 Status', sendNow: '▶️ Enviar agora',
  ai: '🧠 IA', discovery: '🤖 Auto busca', suggestions: '💡 Sugestões', results: '📈 Resultados',
  pause: '⏸️ Pausar envios', resume: '▶️ Retomar envios', cancel: '❌ Cancelar'
};

function mainMenu() {
  const s = readStore();
  return Markup.keyboard([
    [BTN.newOffer, BTN.linkOffer],
    [BTN.search, BTN.suggestions],
    [BTN.queue, BTN.groups],
    [BTN.whatsapp, BTN.status],
    [BTN.ai, BTN.discovery],
    [BTN.results, BTN.sendNow],
    [s.paused ? BTN.resume : BTN.pause]
  ]).resize();
}

function onlyAdmin(adminId) {
  return async (ctx, next) => {
    if (String(ctx.from?.id) !== String(adminId)) return ctx.reply('⛔ Este bot é privado.');
    return next();
  };
}

function statusText() {
  const s = readStore();
  const ai = availableAIProviders();
  const aiOn = Object.entries(ai).filter(([,v]) => v).map(([k]) => k).join(', ') || 'nenhuma chave';
  return `📊 Status da Auri\n\n` +
    `WhatsApp: ${isWhatsAppConnected() ? '✅ conectado' : '❌ desconectado'}\n` +
    `Grupos: ${s.targetGroups?.length || 0}\n` +
    `Fila: ${s.queue.length}\n` +
    `Automação: ${s.paused ? '⏸️ pausada' : '✅ ativa'}\n` +
    `Horário: 08:00–22:00 | ${config.sendIntervalMinutes} min\n` +
    `IA escolhida: ${s.aiProvider || 'auto'} | disponíveis: ${aiOn}\n` +
    `Shopee Open API: ${isShopeeConfigured() ? '✅' : '⚠️ não configurada'}\n` +
    `Auto busca: ${s.autoDiscovery ? '✅ ligada' : '❌ desligada'} | Auto fila: ${s.autoQueueDiscovery ? '✅' : '❌'}\n` +
    `Enviadas: ${s.metrics.sentOffers} ofertas / ${s.metrics.sentMessages} mensagens`;
}

function queueText() {
  const s = readStore();
  if (!s.queue.length) return '📦 A fila está vazia.';
  const lines = s.queue.slice(0, 15).map((x, i) => `${i+1}. ${(x.product?.name || (x.text || '').split('\n')[0]).slice(0,55)} — ID ${x.id}`);
  return `📦 Fila: ${s.queue.length}\n\n${lines.join('\n')}${s.queue.length > 15 ? '\n…' : ''}`;
}

async function downloadTelegramPhoto(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error('Não consegui baixar a foto.');
  const buf = Buffer.from(await res.arrayBuffer());
  const base = process.env.PERSIST_DIR ? path.resolve(process.env.PERSIST_DIR) : path.resolve('.');
  const dir = path.join(base, 'data', 'uploads'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`);
  fs.writeFileSync(dest, buf); return dest;
}

async function beginManual(ctx) {
  drafts.set(ctx.from.id, { step: 'photo', mode: 'manual', data: {} });
  await ctx.reply('📸 Envie a foto do produto ou toque em “Sem foto”.', Markup.keyboard([['Sem foto'], [BTN.cancel]]).resize());
}

async function beginLink(ctx) {
  drafts.set(ctx.from.id, { step: 'product_url', mode: 'link', data: {} });
  await ctx.reply('🔗 Cole o link do produto.\n\nShopee com Open API: eu busco dados e transformo em link de afiliada automaticamente.\nSHEIN e Mercado Livre: cole o link de afiliada oficial para garantir comissão.', Markup.keyboard([[BTN.cancel]]).resize());
}

async function previewOffer(ctx, d) {
  const product = d.data.product || {};
  const title = product.name ? `\n📦 ${product.name.slice(0,120)}` : '';
  const meta = [product.price ? `R$ ${Number(product.price).toFixed(2).replace('.', ',')}` : '', product.rating ? `⭐ ${product.rating}` : '', product.sales ? `${product.sales} vendidos` : '', product.score ? `score ${product.score}` : ''].filter(Boolean).join(' • ');
  const preview = `🛍️ PRÉVIA${title}${meta ? `\n${meta}` : ''}\n\n${d.data.text}\n\n🛍️ Compre aqui: ${d.data.link}`;
  await ctx.reply(preview, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Salvar na fila', `approve:${d.data.id}`)],
    [Markup.button.callback('✨ Gerar outro texto', `regen:${d.data.id}`)],
    [Markup.button.callback('❌ Cancelar', `reject:${d.data.id}`)]
  ]));
}

async function finalizeFromProduct(ctx, product) {
  const link = product.affiliateLink || product.offerLink || product.canonicalUrl || product.productLink;
  if (isDuplicate(product, link)) {
    updateStore(s => { s.metrics.blockedDuplicates += 1; return s; });
    return ctx.reply('⚠️ Esse produto já está na fila ou foi enviado recentemente. Não adicionei de novo.', mainMenu());
  }
  const copy = await generateOfferCopy(product);
  const d = { step: 'confirm', mode: 'link', data: {
    id: crypto.randomBytes(3).toString('hex'), text: copy.text, link, photoPath: null, product,
    aiGenerated: true, aiProvider: copy.provider
  }};
  drafts.set(ctx.from.id, d);
  await previewOffer(ctx, d);
}

async function showGroups(ctx, page = 0) {
  try {
    if (!lastGroups.length) lastGroups = await listWhatsAppGroups();
    const s = readStore();
    const selected = new Set((s.targetGroups || []).map(g => g.jid));
    const perPage = 12, pages = Math.max(1, Math.ceil(lastGroups.length / perPage));
    page = Math.max(0, Math.min(pages - 1, page));
    const slice = lastGroups.slice(page * perPage, (page + 1) * perPage);
    const rows = slice.map(g => [Markup.button.callback(`${selected.has(g.jid) ? '✅' : '⬜'} ${g.name} (${g.size})`, `gt:${lastGroups.indexOf(g)}:${page}`)]);
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️', `gp:${page-1}`));
    nav.push(Markup.button.callback(`${page+1}/${pages}`, 'noop'));
    if (page < pages - 1) nav.push(Markup.button.callback('➡️', `gp:${page+1}`));
    rows.push(nav);
    rows.push([Markup.button.callback('✅ Concluir', 'groups:done')]);
    await ctx.reply('👥 Marque todos os grupos que devem receber as ofertas:', Markup.inlineKeyboard(rows));
  } catch (e) { await ctx.reply(`⚠️ ${e.message}`, mainMenu()); }
}

async function beginSearch(ctx) {
  drafts.set(ctx.from.id, { step: 'search_platform', mode: 'search', data: {} });
  await ctx.reply('Onde quer buscar?', Markup.inlineKeyboard([
    [Markup.button.callback('🧡 Shopee', 'sp:shopee'), Markup.button.callback('🛒 Amazon', 'sp:amazon')],
    [Markup.button.callback('💛 Mercado Livre', 'sp:mercadolivre')]
  ]));
}

async function showSuggestions(ctx) {
  const s = readStore();
  if (!s.suggestions.length) return ctx.reply('💡 Ainda não há sugestões. Toque em “🔎 Buscar ofertas” ou ligue a Auto busca.', mainMenu());
  const rows = s.suggestions.slice(0, 10).map((x, i) => [Markup.button.callback(`${x.product?.name?.slice(0,45) || 'Oferta'} (${x.product?.score || 0})`, `sug:${i}`)]);
  await ctx.reply('💡 Sugestões encontradas pela Auri:', Markup.inlineKeyboard(rows));
}

async function showAI(ctx) {
  const a = availableAIProviders();
  const s = readStore();
  const rows = [['auto','Automático'],['openai','OpenAI'],['gemini','Gemini'],['anthropic','Claude']].map(([id,name]) => [
    Markup.button.callback(`${s.aiProvider===id?'✅':'⬜'} ${name}${id!=='auto' && !a[id] ? ' (sem chave)' : ''}`, `ai:${id}`)
  ]);
  await ctx.reply('🧠 Escolha qual IA a Auri usa para escrever as ofertas:', Markup.inlineKeyboard(rows));
}

async function showDiscovery(ctx) {
  const s = readStore();
  await ctx.reply(`🤖 Busca automática\n\nBuscar sozinha: ${s.autoDiscovery?'✅':'❌'}\nColocar direto na fila: ${s.autoQueueDiscovery?'✅':'❌'}\nIntervalo: ${config.discoveryEveryMinutes} min\n\nQuando “direto na fila” estiver desligado, eu coloco os produtos em 💡 Sugestões para você aprovar.`,
    Markup.inlineKeyboard([
      [Markup.button.callback(s.autoDiscovery ? '⏹ Desligar busca' : '▶️ Ligar busca', 'disc:toggle')],
      [Markup.button.callback(s.autoQueueDiscovery ? '👀 Mandar para sugestões' : '⚡ Colocar direto na fila', 'disc:queue')],
      [Markup.button.callback('🔎 Buscar agora', 'disc:now')]
    ]));
}

async function showResults(ctx) {
  if (!isShopeeConfigured()) return ctx.reply('📈 Para resultados automáticos, configure a Shopee Open API.');
  try {
    const rows = await getShopeeConversions(7);
    const commissions = rows.reduce((a,x) => a + Number(x.totalCommission || 0), 0);
    const orders = rows.flatMap(x => x.orders || []);
    const completed = orders.filter(x => String(x.orderStatus).toUpperCase() === 'COMPLETED').length;
    await ctx.reply(`📈 Últimos 7 dias — Shopee\n\nConversões: ${rows.length}\nPedidos: ${orders.length}\nConcluídos: ${completed}\nComissão estimada: ${commissions.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`, mainMenu());
  } catch (e) { await ctx.reply(`⚠️ Não consegui consultar os resultados: ${e.message}`, mainMenu()); }
}

export function startTelegram({ token, adminId }) {
  const bot = new Telegraf(token);
  bot.use(onlyAdmin(adminId));

  bot.start(ctx => ctx.reply('Oi! Eu sou a Auri 💜\n\nAgora eu posso cadastrar ofertas manualmente, montar por link com IA, buscar produtos, trabalhar com vários grupos e fazer busca automática.', mainMenu()));
  bot.command('menu', ctx => ctx.reply('💜 Painel da Auri', mainMenu()));
  bot.command('status', ctx => ctx.reply(statusText(), mainMenu()));

  bot.on('photo', async ctx => {
    const d = drafts.get(ctx.from.id);
    if (!d || d.step !== 'photo') return;
    try {
      d.data.photoPath = await downloadTelegramPhoto(ctx, ctx.message.photo.at(-1).file_id);
      d.step = 'text';
      await ctx.reply('✅ Foto recebida. Agora envie o texto da oferta.', Markup.keyboard([[BTN.cancel]]).resize());
    } catch (e) { await ctx.reply(`⚠️ ${e.message}`); }
  });

  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();
    const d = drafts.get(ctx.from.id);

    if (!d) {
      if (text === BTN.newOffer) return beginManual(ctx);
      if (text === BTN.linkOffer) return beginLink(ctx);
      if (text === BTN.search) return beginSearch(ctx);
      if (text === BTN.suggestions) return showSuggestions(ctx);
      if (text === BTN.queue) return ctx.reply(queueText(), mainMenu());
      if (text === BTN.groups) { lastGroups = []; return showGroups(ctx); }
      if (text === BTN.status) return ctx.reply(statusText(), mainMenu());
      if (text === BTN.ai) return showAI(ctx);
      if (text === BTN.discovery) return showDiscovery(ctx);
      if (text === BTN.results) return showResults(ctx);
      if (text === BTN.sendNow) {
        try { const r = await sendOneNow(); return ctx.reply(`✅ Enviado para ${r.sentCount} grupo(s).`, mainMenu()); }
        catch (e) { return ctx.reply(`⚠️ ${e.message}`, mainMenu()); }
      }
      if (text === BTN.pause) { updateStore(s => { s.paused = true; return s; }); return ctx.reply('⏸️ Envios pausados.', mainMenu()); }
      if (text === BTN.resume) { updateStore(s => { s.paused = false; return s; }); return ctx.reply('▶️ Envios retomados.', mainMenu()); }
      if (text === BTN.whatsapp) {
        if (isWhatsAppConnected()) return ctx.reply('✅ WhatsApp conectado.', mainMenu());
        drafts.set(ctx.from.id, { step: 'wa_phone', mode: 'wa', data: {} });
        return ctx.reply('📱 Envie DDI + DDD + número, somente números.', Markup.keyboard([[BTN.cancel]]).resize());
      }
      return ctx.reply('Escolha uma opção no painel 💜', mainMenu());
    }

    if (text === BTN.cancel) { drafts.delete(ctx.from.id); return ctx.reply('Cancelado.', mainMenu()); }

    if (d.step === 'photo' && text.toLowerCase() === 'sem foto') {
      d.data.photoPath = null; d.step = 'text';
      return ctx.reply('✍️ Envie o texto da oferta.', Markup.keyboard([[BTN.cancel]]).resize());
    }
    if (d.step === 'text') { d.data.text = text; d.step = 'link'; return ctx.reply('🔗 Agora envie o link de afiliada.', Markup.keyboard([[BTN.cancel]]).resize()); }
    if (d.step === 'link') {
      d.data.link = text; d.data.id = crypto.randomBytes(3).toString('hex'); d.step = 'confirm';
      d.data.product = { platform: 'manual', name: (d.data.text || '').split('\n')[0], canonicalUrl: text, affiliateLink: text };
      return previewOffer(ctx, d);
    }
    if (d.step === 'product_url') {
      await ctx.reply('⏳ Buscando dados e preparando a oferta…');
      try { const product = await importProductFromUrl(text); drafts.delete(ctx.from.id); return finalizeFromProduct(ctx, product); }
      catch (e) { drafts.delete(ctx.from.id); return ctx.reply(`⚠️ ${e.message}`, mainMenu()); }
    }
    if (d.step === 'wa_phone') {
      try {
        const code = await requestWhatsAppPairingCode(text); drafts.delete(ctx.from.id);
        return ctx.reply(`🔐 Código de pareamento:\n\n${code}\n\nWhatsApp → Aparelhos conectados → Conectar aparelho → Conectar com número.`, mainMenu());
      } catch (e) { return ctx.reply(`⚠️ ${e.message}`); }
    }
    if (d.step === 'search_keyword') {
      const platform = d.data.platform; drafts.delete(ctx.from.id);
      await ctx.reply('🔎 Buscando…');
      try {
        lastSearch = await searchMarketplace(platform, text, 8);
        if (!lastSearch.length) return ctx.reply('Não encontrei produtos.', mainMenu());
        const rows = lastSearch.map((p,i) => [Markup.button.callback(`${p.name.slice(0,48)}${p.score ? ` • ${p.score}` : ''}`, `pick:${i}`)]);
        return ctx.reply('Escolha um produto:', Markup.inlineKeyboard(rows));
      } catch (e) { return ctx.reply(`⚠️ ${e.message}`, mainMenu()); }
    }
  });

  bot.action(/^approve:(.+)$/, async ctx => {
    const d = drafts.get(ctx.from.id), id = ctx.match[1];
    if (!d || d.step !== 'confirm' || d.data.id !== id) return ctx.answerCbQuery('Prévia expirou.');
    if (isDuplicate(d.data.product, d.data.link)) return ctx.answerCbQuery('Produto duplicado.');
    enqueue(d.data); drafts.delete(ctx.from.id); await ctx.answerCbQuery('Salvo!');
    await ctx.editMessageText(`✅ Oferta salva!\n📦 Posição na fila: ${readStore().queue.length}`);
    return ctx.reply('Pode fechar o Telegram. Eu cuido do envio 💜', mainMenu());
  });

  bot.action(/^regen:(.+)$/, async ctx => {
    const d = drafts.get(ctx.from.id), id = ctx.match[1];
    if (!d || d.data.id !== id) return ctx.answerCbQuery('Prévia expirou.');
    await ctx.answerCbQuery('Gerando…');
    const copy = await generateOfferCopy(d.data.product || {}); d.data.text = copy.text; d.data.aiProvider = copy.provider;
    return previewOffer(ctx, d);
  });
  bot.action(/^reject:/, async ctx => { drafts.delete(ctx.from.id); await ctx.answerCbQuery('Cancelado.'); await ctx.editMessageText('❌ Oferta cancelada.'); await ctx.reply('💜 Painel da Auri', mainMenu()); });

  bot.action(/^sp:(.+)$/, async ctx => {
    const platform = ctx.match[1]; await ctx.answerCbQuery();
    drafts.set(ctx.from.id, { step: 'search_keyword', mode: 'search', data: { platform } });
    await ctx.reply('Digite o que quer procurar. Ex.: luminária, vestido, organizador, tablet…', Markup.keyboard([[BTN.cancel]]).resize());
  });

  bot.action(/^pick:(\d+)$/, async ctx => {
    const p = lastSearch[Number(ctx.match[1])]; if (!p) return ctx.answerCbQuery('Busca expirou.');
    await ctx.answerCbQuery('Preparando…');
    if (p.platform === 'shopee' && p.productLink && !p.affiliateLink) p.affiliateLink = p.offerLink || p.productLink;
    return finalizeFromProduct(ctx, p);
  });

  bot.action(/^gt:(\d+):(\d+)$/, async ctx => {
    const idx = Number(ctx.match[1]), page = Number(ctx.match[2]), g = lastGroups[idx];
    if (!g) return ctx.answerCbQuery('Lista expirou.');
    const s = readStore(), current = [...(s.targetGroups || [])];
    const exists = current.some(x => x.jid === g.jid);
    setTargetGroups(exists ? current.filter(x => x.jid !== g.jid) : [...current, g]);
    await ctx.answerCbQuery(exists ? 'Removido' : 'Selecionado');
    try { await ctx.editMessageReplyMarkup((await buildGroupKeyboard(page)).reply_markup); } catch {}
  });

  async function buildGroupKeyboard(page = 0) {
    const s = readStore(), selected = new Set((s.targetGroups || []).map(g => g.jid));
    const perPage = 12, pages = Math.max(1, Math.ceil(lastGroups.length / perPage)); page = Math.max(0, Math.min(pages-1,page));
    const slice = lastGroups.slice(page*perPage,(page+1)*perPage);
    const rows = slice.map(g => [Markup.button.callback(`${selected.has(g.jid)?'✅':'⬜'} ${g.name} (${g.size})`, `gt:${lastGroups.indexOf(g)}:${page}`)]);
    const nav=[]; if(page>0) nav.push(Markup.button.callback('⬅️',`gp:${page-1}`)); nav.push(Markup.button.callback(`${page+1}/${pages}`,'noop')); if(page<pages-1) nav.push(Markup.button.callback('➡️',`gp:${page+1}`));
    rows.push(nav); rows.push([Markup.button.callback('✅ Concluir','groups:done')]); return Markup.inlineKeyboard(rows);
  }
  bot.action(/^gp:(\d+)$/, async ctx => { await ctx.answerCbQuery(); try { await ctx.editMessageReplyMarkup((await buildGroupKeyboard(Number(ctx.match[1]))).reply_markup); } catch {} });
  bot.action('groups:done', async ctx => { await ctx.answerCbQuery(); const n=readStore().targetGroups.length; await ctx.editMessageText(`✅ ${n} grupo(s) selecionado(s).`); await ctx.reply('💜 Painel da Auri', mainMenu()); });
  bot.action('noop', ctx => ctx.answerCbQuery());

  bot.action(/^ai:(.+)$/, async ctx => { const p=ctx.match[1]; updateStore(s=>{s.aiProvider=p;return s;}); await ctx.answerCbQuery('IA atualizada'); await showAI(ctx); });
  bot.action('disc:toggle', async ctx => { updateStore(s=>{s.autoDiscovery=!s.autoDiscovery;return s;}); await ctx.answerCbQuery(); await showDiscovery(ctx); });
  bot.action('disc:queue', async ctx => { updateStore(s=>{s.autoQueueDiscovery=!s.autoQueueDiscovery;return s;}); await ctx.answerCbQuery(); await showDiscovery(ctx); });
  bot.action('disc:now', async ctx => { await ctx.answerCbQuery('Buscando…'); try { const list=await discoverShopeeOffers({force:true}); await ctx.reply(`✅ Encontrei ${list.length} oportunidade(s).`, mainMenu()); } catch(e){ await ctx.reply(`⚠️ ${e.message}`, mainMenu()); } });

  bot.action(/^sug:(\d+)$/, async ctx => {
    const idx=Number(ctx.match[1]), s=readStore(), item=s.suggestions[idx];
    if(!item) return ctx.answerCbQuery('Sugestão expirou.');
    if(isDuplicate(item.product,item.link)) return ctx.answerCbQuery('Já está na fila ou foi enviada.');
    enqueue(item); updateStore(x=>{x.suggestions.splice(idx,1);return x;}); await ctx.answerCbQuery('Adicionada à fila!'); await ctx.reply('✅ Oferta adicionada à fila.', mainMenu());
  });

  bot.command('remover', async ctx => { const id=ctx.message.text.split(/\s+/)[1]; if(!id)return ctx.reply('Use /remover ID'); removeFromQueue(id); return ctx.reply('🗑️ Removida, se o ID existia.', mainMenu()); });

  bot.catch(err => console.error('Telegram:', err));
  bot.launch();
  console.log('🤖 Auri conectada ao Telegram.');
  process.once('SIGINT',()=>bot.stop('SIGINT')); process.once('SIGTERM',()=>bot.stop('SIGTERM'));
  return bot;
}
