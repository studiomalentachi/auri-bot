import cron from 'node-cron';
import { readStore, markSent, peekNext } from './store.js';
import { isWhatsAppConnected, sendOfferToGroup } from './whatsapp.js';

let job10 = null;
let job22 = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const store = readStore();
    if (store.paused) return;
    if (!store.targetGroupJid) return;
    if (!isWhatsAppConnected()) return;

    const item = peekNext();
    if (!item) return;

    await sendOfferToGroup(store.targetGroupJid, item);
    markSent(item.id);
    console.log(`✅ Oferta ${item.id} enviada para ${store.targetGroupName || 'grupo'}.`);
  } catch (err) {
    console.error('Erro no envio agendado:', err?.message || err);
  } finally {
    running = false;
  }
}

export function startScheduler({ timezone, include22 }) {
  // 08:00, 08:10 ... 21:50 = 84 envios possíveis por dia.
  job10 = cron.schedule('*/10 8-21 * * *', tick, { timezone });

  // Opcional: também envia exatamente às 22:00.
  if (include22) {
    job22 = cron.schedule('0 22 * * *', tick, { timezone });
  }

  console.log(`⏰ Agendador ativo: a cada 10 min, 08:00–21:50${include22 ? ' + 22:00' : ''} (${timezone}).`);
}

export async function sendOneNow() {
  return tick();
}

export function stopScheduler() {
  job10?.stop();
  job22?.stop();
}
