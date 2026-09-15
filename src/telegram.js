import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Telegraf, Markup } from 'telegraf';
import { enqueue, readStore, removeFromQueue, updateStore } from './store.js';
import { isWhatsAppConnected, listWhatsAppGroups, requestWhatsAppPairingCode } from './whatsapp.js';
import { sendOneNow } from './scheduler.js';

const drafts = new Map();
let lastGroups = [];

const BTN = {
  newOffer: '➕ Nova oferta',
  queue: '📦 Fila',
  whatsapp: '📱 WhatsApp',
  groups: '👥 Escolher grupo',
  status: '📊 Status',
  sendNow: '▶️ Enviar agora',
  pause: '⏸️ Pausar envios',
  resume: '▶️ Retomar envios',
  cancel: '❌ Cancelar'
};

function mainMenu() {
  const s = readStore();
  return Markup.keyboard([
    [BTN.newOffer, BTN.queue],
    [BTN.whatsapp, BTN.groups],
    [BTN.status, BTN.sendNow],
    [s.paused ? BTN.resume : BTN.pause]
  ]).resize();
}

function onlyAdmin(adminId) {
  return async (ctx, next) => {
    if (String(ctx.from?.id) !== String(adminId)) {
      await ctx.reply('⛔ Este bot é privado.');
      return;
    }
    return next();
  };
}

function queueText() {
  const s = readStore();
  if (!s.queue.length) return '📦 A fila está vazia.\n\nQuando você salvar uma oferta, ela entra aqui e será enviada automaticamente no próximo horário disponível.';
  const lines = s.queue.slice(0, 12).map((x, i) => {
    const first = (x.text || '').split('\n')[0].slice(0, 50);
    return `${i + 1}. ${first || 'Oferta'} — ID ${x.id}`;
  });
  return `📦 Fila: ${s.queue.length} oferta(s)\n\n${lines.join('\n')}${s.queue.length > 12 ? '\n…' : ''}\n\n⏰ Auri envia 1 oferta a cada 10 minutos, das 08:00 às 22:00.`;
}

function statusText() {
  const s = readStore();
  return (
    `📊 Status da Auri\n\n` +
    `WhatsApp: ${isWhatsAppConnected() ? '✅ conectado' : '❌ desconectado'}\n` +
    `Grupo: ${s.targetGroupName || 'não escolhido'}\n` +
    `Fila: ${s.queue.length} oferta(s)\n` +
    `Automação: ${s.paused ? '⏸️ pausada' : '✅ ativa'}\n` +
    `Horário: 08:00–22:00\n` +
    `Intervalo: 10 minutos`
  );
}

async function downloadTelegramPhoto(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error('Não consegui baixar a foto do Telegram.');
  const buf = Buffer.from(await res.arrayBuffer());
  const baseDir = process.env.PERSIST_DIR ? path.resolve(process.env.PERSIST_DIR) : path.resolve('.');
  const uploads = path.join(baseDir, 'data', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  const dest = path.join(uploads, filename);
  fs.writeFileSync(dest, buf);
  return dest;
}

async function beginOffer(ctx) {
  drafts.set(ctx.from.id, { step: 'photo', data: {} });
  await ctx.reply(
    '📸 Envie a foto do produto.\n\nSe quiser cadastrar sem foto, toque em “Sem foto”.',
    Markup.keyboard([['Sem foto'], [BTN.cancel]]).resize()
  );
}

async function showGroups(ctx) {
  try {
    lastGroups = await listWhatsAppGroups();
    if (!lastGroups.length) return ctx.reply('Não encontrei grupos nesta conta.', mainMenu());

    const buttons = lastGroups.map((g, i) => [
      Markup.button.callback(`${g.name} (${g.size})`, `group:${i}`)
    ]);
    await ctx.reply('👥 Toque no grupo que receberá as ofertas:', Markup.inlineKeyboard(buttons));
  } catch (e) {
    await ctx.reply(`⚠️ ${e.message}\n\nPrimeiro conecte o WhatsApp em “📱 WhatsApp”.`, mainMenu());
  }
}

async function sendNext(ctx) {
  const s = readStore();
  if (!s.queue.length) return ctx.reply('📦 A fila está vazia.', mainMenu());
  await ctx.reply('Enviando a próxima oferta…');
  try {
    await sendOneNow();
    await ctx.reply('✅ Pronto. Confira o grupo do WhatsApp.', mainMenu());
  } catch (e) {
    await ctx.reply(`⚠️ ${e.message}`, mainMenu());
  }
}

export function startTelegram({ token, adminId }) {
  const bot = new Telegraf(token);
  bot.use(onlyAdmin(adminId));

  bot.start(async (ctx) => {
    await ctx.reply(
      'Oi! Eu sou a Auri 💜\n\nVocê só precisa salvar suas ofertas aqui. Eu organizo a fila e envio automaticamente para o grupo do WhatsApp a cada 10 minutos, das 08h às 22h.\n\nO que você quer fazer?',
      mainMenu()
    );
  });

  bot.command('menu', async (ctx) => ctx.reply('💜 Painel da Auri', mainMenu()));
  bot.command('oferta', beginOffer);
  bot.command('fila', async (ctx) => ctx.reply(queueText(), mainMenu()));
  bot.command('status', async (ctx) => ctx.reply(statusText(), mainMenu()));
  bot.command('grupos', showGroups);
  bot.command('enviaragora', sendNext);

  bot.command('semfoto', async (ctx) => {
    const d = drafts.get(ctx.from.id);
    if (!d || d.step !== 'photo') return ctx.reply('Toque em “➕ Nova oferta” primeiro.', mainMenu());
    d.data.photoPath = null;
    d.step = 'text';
    await ctx.reply('✍️ Agora envie o texto da oferta exatamente como quer que apareça.', Markup.keyboard([[BTN.cancel]]).resize());
  });

  bot.command('cancelar', async (ctx) => {
    drafts.delete(ctx.from.id);
    await ctx.reply('Cadastro cancelado.', mainMenu());
  });

  bot.command('pausar', async (ctx) => {
    updateStore((s) => { s.paused = true; return s; });
    await ctx.reply('⏸️ Envios automáticos pausados.', mainMenu());
  });

  bot.command('retomar', async (ctx) => {
    updateStore((s) => { s.paused = false; return s; });
    await ctx.reply('▶️ Envios automáticos retomados.', mainMenu());
  });

  bot.command('conectarwhatsapp', async (ctx) => {
    if (isWhatsAppConnected()) return ctx.reply('✅ O WhatsApp já está conectado.', mainMenu());
    drafts.set(ctx.from.id, { step: 'wa_phone', data: {} });
    await ctx.reply(
      '📱 Envie o número do WhatsApp que será usado pela Auri.\n\nUse DDI + DDD + número, somente números.\nExemplo: 5544999999999',
      Markup.keyboard([[BTN.cancel]]).resize()
    );
  });

  bot.command('usargrupo', async (ctx) => {
    const arg = ctx.message.text.split(/\s+/)[1];
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > lastGroups.length) {
      return ctx.reply('Use “👥 Escolher grupo” primeiro.', mainMenu());
    }
    const g = lastGroups[n - 1];
    updateStore((s) => { s.targetGroupJid = g.jid; s.targetGroupName = g.name; return s; });
    await ctx.reply(`✅ Grupo escolhido: ${g.name}`, mainMenu());
  });

  bot.command('remover', async (ctx) => {
    const id = ctx.message.text.split(/\s+/)[1];
    if (!id) return ctx.reply('Use /remover ID', mainMenu());
    const before = readStore().queue.length;
    removeFromQueue(id);
    const after = readStore().queue.length;
    await ctx.reply(before === after ? 'Não encontrei esse ID.' : `🗑️ Oferta ${id} removida.`, mainMenu());
  });

  bot.on('photo', async (ctx) => {
    const d = drafts.get(ctx.from.id);
    if (!d || d.step !== 'photo') return;
    try {
      const photos = ctx.message.photo;
      const best = photos[photos.length - 1];
      d.data.photoPath = await downloadTelegramPhoto(ctx, best.file_id);
      d.step = 'text';
      await ctx.reply('✅ Foto recebida. Agora envie o texto da oferta.', Markup.keyboard([[BTN.cancel]]).resize());
    } catch (e) {
      await ctx.reply(`⚠️ ${e.message}`);
    }
  });

  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();

    const d = drafts.get(ctx.from.id);

    if (!d) {
      if (text === BTN.newOffer) return beginOffer(ctx);
      if (text === BTN.queue) return ctx.reply(queueText(), mainMenu());
      if (text === BTN.status) return ctx.reply(statusText(), mainMenu());
      if (text === BTN.groups) return showGroups(ctx);
      if (text === BTN.sendNow) return sendNext(ctx);
      if (text === BTN.pause) {
        updateStore((s) => { s.paused = true; return s; });
        return ctx.reply('⏸️ Envios automáticos pausados.', mainMenu());
      }
      if (text === BTN.resume) {
        updateStore((s) => { s.paused = false; return s; });
        return ctx.reply('▶️ Envios automáticos retomados.', mainMenu());
      }
      if (text === BTN.whatsapp) {
        if (isWhatsAppConnected()) return ctx.reply('✅ WhatsApp conectado. Se quiser conferir o grupo, toque em “👥 Escolher grupo”.', mainMenu());
        drafts.set(ctx.from.id, { step: 'wa_phone', data: {} });
        return ctx.reply(
          '📱 Envie o número do WhatsApp com DDI + DDD + número, somente números.\n\nExemplo: 5544999999999',
          Markup.keyboard([[BTN.cancel]]).resize()
        );
      }
      return ctx.reply('Escolha uma opção no painel abaixo 💜', mainMenu());
    }

    if (text === BTN.cancel) {
      drafts.delete(ctx.from.id);
      return ctx.reply('Cadastro cancelado.', mainMenu());
    }

    if (d.step === 'photo' && text.toLowerCase() === 'sem foto') {
      d.data.photoPath = null;
      d.step = 'text';
      return ctx.reply('✍️ Agora envie o texto da oferta exatamente como quer que apareça.', Markup.keyboard([[BTN.cancel]]).resize());
    }

    if (d.step === 'wa_phone') {
      try {
        const code = await requestWhatsAppPairingCode(text);
        drafts.delete(ctx.from.id);
        return ctx.reply(
          `🔐 Seu código de pareamento é:\n\n${code}\n\nNo WhatsApp: Aparelhos conectados → Conectar aparelho → Conectar com número de telefone → digite o código.\n\nDepois volte e toque em “📊 Status”.`,
          mainMenu()
        );
      } catch (e) {
        return ctx.reply(`⚠️ ${e.message}`);
      }
    }

    if (d.step === 'text') {
      d.data.text = text;
      d.step = 'link';
      return ctx.reply('🔗 Agora envie seu link de afiliada da oferta.', Markup.keyboard([[BTN.cancel]]).resize());
    }

    if (d.step === 'link') {
      d.data.link = text;
      d.data.id = crypto.randomBytes(3).toString('hex');
      d.step = 'confirm';
      const preview = `🛍️ PRÉVIA\n\n${d.data.text}\n\n${d.data.link}`;
      return ctx.reply(
        preview,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Salvar e colocar na fila', `approve:${d.data.id}`)],
          [Markup.button.callback('❌ Cancelar', `reject:${d.data.id}`)]
        ])
      );
    }
  });

  bot.action(/^approve:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const d = drafts.get(ctx.from.id);
    if (!d || d.step !== 'confirm' || d.data.id !== id) {
      return ctx.answerCbQuery('Essa prévia expirou.');
    }
    enqueue(d.data);
    drafts.delete(ctx.from.id);
    const position = readStore().queue.length;
    await ctx.answerCbQuery('Salvo!');
    await ctx.editMessageText(`✅ Oferta salva!\n\n📦 Posição na fila: ${position}\n⏰ A Auri vai enviar automaticamente no próximo horário disponível entre 08h e 22h.`);
    await ctx.reply(
      'Pode fechar o Telegram. Eu cuido do envio 💜',
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Adicionar outra oferta', 'quick:new')],
        [Markup.button.callback('📦 Ver fila', 'quick:queue')]
      ])
    );
    await ctx.reply('💜 Painel da Auri', mainMenu());
  });

  bot.action(/^reject:(.+)$/, async (ctx) => {
    drafts.delete(ctx.from.id);
    await ctx.answerCbQuery('Cancelado.');
    await ctx.editMessageText('❌ Oferta cancelada.');
    await ctx.reply('💜 Painel da Auri', mainMenu());
  });

  bot.action('quick:new', async (ctx) => {
    await ctx.answerCbQuery();
    await beginOffer(ctx);
  });

  bot.action('quick:queue', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(queueText(), mainMenu());
  });

  bot.action(/^group:(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    const g = lastGroups[idx];
    if (!g) return ctx.answerCbQuery('Essa lista expirou. Toque em Escolher grupo novamente.');
    updateStore((s) => { s.targetGroupJid = g.jid; s.targetGroupName = g.name; return s; });
    await ctx.answerCbQuery('Grupo escolhido!');
    await ctx.editMessageText(`✅ Grupo escolhido: ${g.name}\n\nAs ofertas da fila serão enviadas para este grupo.`);
    await ctx.reply('💜 Painel da Auri', mainMenu());
  });

  bot.catch((err) => console.error('Erro no Telegram:', err));
  bot.launch();
  console.log('🤖 Auri conectada ao Telegram.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}
