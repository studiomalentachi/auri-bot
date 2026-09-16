import { config } from './config.js';
import { generateOfferCopy } from './ai.js';
import { discoverWebOffers } from './discovery.js';
import {
  getShopeeProduct,
  generateShopeeShortLink,
  isShopeeConfigured
} from './shopee.js';
import {
  markSent,
  readStore,
  updateStore
} from './store.js';
import { sendOfferToGroups } from './whatsapp.js';

let busy = false;
let lastSlot = '';
let lastDiscoverySlot = '';

function nowParts() {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }
  )
    .formatToParts(new Date())
    .reduce(
      (a, p) => (
        a[p.type] = p.value,
        a
      ),
      {}
    );

  return {
    date:
      `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function eligibleTime() {
  const { hour, minute } = nowParts();
  const maxHour = config.include22 ? 22 : 21;

  if (hour < 8 || hour > maxHour) {
    return false;
  }

  if (
    hour === 22 &&
    minute > 0 &&
    config.include22
  ) {
    return false;
  }

  return (
    minute % config.sendIntervalMinutes === 0
  );
}

function discoverySlot() {
  const p = nowParts();

  // Pesquisa apenas no período útil.
  if (p.hour < 8 || p.hour > 22) {
    return null;
  }

  const minutes =
    p.hour * 60 + p.minute;

  const index = Math.floor(
    minutes /
    config.discoveryEveryMinutes
  );

  return `${p.date}-${index}`;
}

function removeUnverifiedCouponClaims(item) {
  const s = readStore();

  if (
    !s.safeCouponsOnly ||
    item.couponVerified ||
    item.product?.couponVerified
  ) {
    return item;
  }

  const original = String(item.text || '');
  const lines = original.split('\n');

  const safe = lines.filter(
    (line) =>
      !/\b(cupom|voucher|c[oó]digo promocional|use o c[oó]digo)\b/i.test(
        line
      )
  );

  if (safe.length !== lines.length) {
    item.text = safe
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    updateStore((x) => {
      x.metrics.blockedCoupons += 1;
      return x;
    });
  }

  return item;
}

async function refreshBeforeSend(item) {
  item = removeUnverifiedCouponClaims(item);

  if (
    item.product?.platform !== 'shopee' ||
    !isShopeeConfigured() ||
    !item.product.itemId ||
    !item.product.shopId
  ) {
    return item;
  }

  try {
    const fresh = await getShopeeProduct({
      itemId: item.product.itemId,
      shopId: item.product.shopId
    });

    if (!fresh) {
      throw new Error(
        'Produto não encontrado na API'
      );
    }

    fresh.affiliateLink =
      await generateShopeeShortLink(
        fresh.productLink,
        ['whatsapp', 'auri']
      );

    const oldPrice = Number(
      item.product.price || 0
    );

    const newPrice = Number(
      fresh.price || 0
    );

    const changed =
      oldPrice > 0 &&
      newPrice > 0 &&
      Math.abs(newPrice - oldPrice) >= 0.01;

    item.product = fresh;
    item.link =
      fresh.affiliateLink ||
      item.link;

    if (
      changed &&
      item.aiGenerated
    ) {
      const copy =
        await generateOfferCopy(
          fresh,
          'O preço foi atualizado antes do envio.'
        );

      item.text = copy.text;
      item.aiProvider = copy.provider;
    }
  } catch (e) {
    item.refreshWarning = e.message;
  }

  return item;
}

export async function sendOneNow() {
  if (busy) {
    throw new Error(
      'Já existe um envio em andamento.'
    );
  }

  busy = true;

  try {
    const s = readStore();

    if (!s.queue.length) {
      throw new Error(
        'A fila está vazia.'
      );
    }

    const groups =
      s.targetGroups?.length
        ? s.targetGroups
        : (
            s.targetGroupJid
              ? [
                  {
                    jid: s.targetGroupJid,
                    name:
                      s.targetGroupName ||
                      'Grupo'
                  }
                ]
              : []
          );

    if (!groups.length) {
      throw new Error(
        'Escolha pelo menos um grupo.'
      );
    }

    const item =
      await refreshBeforeSend({
        ...s.queue[0]
      });

    const sentCount =
      await sendOfferToGroups(
        groups,
        item
      );

    updateStore((x) => {
      x.queue.shift();
      x.metrics.sentMessages += sentCount;
      return x;
    });

    markSent(item);

    return {
      item,
      sentCount
    };
  } finally {
    busy = false;
  }
}

async function tick() {
  const p = nowParts();
  const slot =
    `${p.date}-${p.hour}:${p.minute}`;
  const s = readStore();

  if (
    !s.paused &&
    eligibleTime() &&
    slot !== lastSlot &&
    s.queue.length
  ) {
    lastSlot = slot;

    try {
      await sendOneNow();
    } catch (e) {
      console.error(
        'Envio automático:',
        e.message
      );
    }
  }

  const ds = discoverySlot();

  if (
    s.autoDiscovery &&
    ds &&
    ds !== lastDiscoverySlot
  ) {
    lastDiscoverySlot = ds;

    discoverWebOffers().catch(
      (e) =>
        console.error(
          'Busca automática:',
          e.message
        )
    );
  }
}

export function startScheduler() {
  setInterval(
    () => tick().catch(console.error),
    15000
  );

  setTimeout(
    () => tick().catch(console.error),
    3000
  );

  console.log(
    `⏰ Scheduler ativo: ${config.sendIntervalMinutes} min, 08h–${config.include22 ? '22h' : '21h'}; até 85 envios/dia com fila cheia.`
  );

  console.log(
    `🔎 Pesquisa web: até ${config.discoveryMaxPerRun} produtos por rodada, a cada ${config.discoveryEveryMinutes} min.`
  );
}
