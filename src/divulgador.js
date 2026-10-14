import { config } from './config.js';
import { readStore, updateStore } from './store.js';
import { sendPreparedItemNow } from './scheduler.js';

let running = false;

function nowMinutes() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date()).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function due(q, now) {
  if (!q.active || !q.items?.length || !q.groups?.length) return false;
  const current = nowMinutes();
  const start = Number(q.startMinutes ?? 480);
  const end = Number(q.endMinutes ?? 1320);
  if (current < start || current > end) return false;

  const ref = q.lastSentAt || q.lastAttemptAt;
  if (!ref) return true;

  return ((now.getTime() - new Date(ref).getTime()) / 60000) >= Number(q.intervalMinutes || 10);
}

function addLog(s, entry) {
  s.divulgadorLog.unshift({ at: new Date().toISOString(), ...entry });
  s.divulgadorLog = s.divulgadorLog.slice(0, 400);
}

export async function sendOfferQueueNow(queueId) {
  const before = readStore();
  const q = before.offerQueues?.find(x => String(x.id) === String(queueId));

  if (!q) throw new Error('Fila não encontrada.');
  if (!q.items?.length) throw new Error('Essa fila está vazia.');
  if (!q.groups?.length) throw new Error('Escolha pelo menos um grupo para essa fila.');

  const sourceItem = {
    ...q.items[0],
    autoQueued: true,
    divulgadorQueueId: q.id,
    divulgadorQueueName: q.name
  };

  updateStore((s) => {
    const current = s.offerQueues.find(x => String(x.id) === String(queueId));
    if (current) current.lastAttemptAt = new Date().toISOString();
    s.divulgador.lastRunAt = new Date().toISOString();
    return s;
  });

  try {
    const result = await sendPreparedItemNow(sourceItem, q.groups);

    updateStore((s) => {
      const current = s.offerQueues.find(x => String(x.id) === String(queueId));
      if (!current) return s;

      const [removed] = current.items.splice(0, 1);

      if (result.skipped) {
        current.blockedCount += 1;
        s.divulgador.blocked += 1;

        if (removed) {
          s.suggestions.unshift({
            ...removed,
            autoQueued: false,
            needsReview: true,
            verificationWarning: result.reason || 'O Divulgador bloqueou a oferta porque não conseguiu revalidar os dados.'
          });
          s.suggestions = s.suggestions.slice(0, config.discoverySuggestionCap);
        }

        addLog(s, {
          queueId: current.id,
          queueName: current.name,
          status: 'blocked',
          title: removed?.product?.name || 'Oferta',
          message: result.reason || 'Revalidação bloqueada.'
        });
      } else {
        current.sentCount += 1;
        current.lastSentAt = new Date().toISOString();
        s.divulgador.sentOffers += 1;
        s.divulgador.sentMessages += Number(result.sentCount || 0);
        s.divulgador.lastSuccessAt = new Date().toISOString();

        addLog(s, {
          queueId: current.id,
          queueName: current.name,
          status: 'sent',
          title: result.item?.product?.name || removed?.product?.name || 'Oferta',
          message: `${Number(result.sentCount || 0)} envio(s) concluído(s).`
        });
      }

      return s;
    });

    return result;
  } catch (e) {
    updateStore((s) => {
      const current = s.offerQueues.find(x => String(x.id) === String(queueId));
      if (current) current.errorCount += 1;
      s.divulgador.errors += 1;
      addLog(s, {
        queueId: q.id,
        queueName: q.name,
        status: 'error',
        title: q.items?.[0]?.product?.name || 'Oferta',
        message: e.message
      });
      return s;
    });
    throw e;
  }
}

async function tick() {
  if (running) return;
  running = true;

  try {
    const s = readStore();
    if (!s.divulgador?.enabled || s.paused) return;

    const now = new Date();
    const q = (s.offerQueues || [])
      .filter(x => due(x, now))
      .sort((a,b) => new Date(a.lastSentAt || a.lastAttemptAt || 0) - new Date(b.lastSentAt || b.lastAttemptAt || 0))[0];

    if (q) await sendOfferQueueNow(q.id);
  } catch (e) {
    if (!/envio em andamento/i.test(String(e?.message || ''))) {
      console.error('Divulgador:', e.message);
    }
  } finally {
    running = false;
  }
}

export function startDivulgador() {
  setInterval(() => tick().catch(console.error), 15000);
  setTimeout(() => tick().catch(console.error), 5000);
  console.log('📣 Divulgador da Auri ativo.');
}
