import { config } from './config.js';
import { generateOfferCopy } from './ai.js';
import { discoverWebOffers, refreshSheinProduct } from './discovery.js';
import {
  getShopeeProduct,
  getShopeeLiveProduct,
  generateShopeeShortLink,
  isShopeeConfigured
} from './shopee.js';
import {
  getMeliProduct,
  getMeliProductFromUrl
} from './mercadolivre.js';
import {
  markSent,
  readStore,
  updateStore
} from './store.js';
import { sendOfferToGroups } from './whatsapp.js';
import { buildTrendDigest } from './trends.js';

let busy = false;
let lastSlot = '';
let lastDiscoverySlot = '';
let lastTrendSlot = '';

function nowParts() {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          config.timezone,
        year:
          'numeric',
        month:
          '2-digit',
        day:
          '2-digit',
        hour:
          '2-digit',
        minute:
          '2-digit',
        hour12:
          false
      }
    )
      .formatToParts(
        new Date()
      )
      .reduce(
        (a, p) => (
          a[p.type] =
            p.value,
          a
        ),
        {}
      );

  return {
    date:
      `${parts.year}-${parts.month}-${parts.day}`,
    hour:
      Number(
        parts.hour
      ),
    minute:
      Number(
        parts.minute
      )
  };
}

function eligibleTime() {
  const {
    hour,
    minute
  } =
    nowParts();

  const maxHour =
    config.include22
      ? 22
      : 21;

  if (
    hour < 8 ||
    hour > maxHour
  ) {
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
    minute %
    config.sendIntervalMinutes ===
    0
  );
}

function discoverySlot() {
  const p =
    nowParts();

  if (
    p.hour < 8 ||
    p.hour > 22
  ) {
    return null;
  }

  const minutes =
    p.hour * 60 +
    p.minute;

  const index =
    Math.floor(
      minutes /
      config.discoveryEveryMinutes
    );

  return `${p.date}-${index}`;
}

function trendSlot() {
  const p =
    nowParts();

  if (
    !config.trendsEnabled ||
    p.hour !==
      config.trendsHour ||
    p.minute !==
      config.trendsMinute
  ) {
    return null;
  }

  return p.date;
}

function removeUnverifiedCouponClaims(
  item
) {
  const s =
    readStore();

  if (
    !s.safeCouponsOnly ||
    item.couponVerified ||
    item.product?.couponVerified
  ) {
    return item;
  }

  const original =
    String(
      item.text || ''
    );

  const lines =
    original.split(
      '\n'
    );

  const safe =
    lines.filter(
      (line) =>
        !/\b(cupom|voucher|c[oó]digo promocional|use o c[oó]digo)\b/i.test(
          line
        )
    );

  if (
    safe.length !==
    lines.length
  ) {
    item.text =
      safe
        .join('\n')
        .replace(
          /\n{3,}/g,
          '\n\n'
        )
        .trim();

    updateStore((x) => {
      x.metrics
        .blockedCoupons +=
        1;

      return x;
    });
  }

  return item;
}

function stableShopeePrice(product) {
  const min =
    Number(
      product?.priceMin ||
      product?.price ||
      0
    );

  const max =
    Number(
      product?.priceMax ||
      min
    );

  return (
    min > 0 &&
    max > 0 &&
    Math.abs(
      max - min
    ) < 0.01
  );
}

function mergeFreshProduct(
  oldProduct,
  fresh
) {
  return {
    ...oldProduct,
    ...fresh,
    affiliateLink:
      oldProduct?.affiliateLink ||
      fresh?.affiliateLink ||
      null,
    publicLink:
      fresh?.publicLink ||
      oldProduct?.publicLink ||
      fresh?.canonicalUrl ||
      oldProduct?.canonicalUrl ||
      null
  };
}

async function refreshBeforeSend(
  item
) {
  item =
    removeUnverifiedCouponClaims(
      item
    );

  const platform =
    item.product?.platform;

  // Oferta aprovada manualmente com preço corrigido por você:
  // não sobrescreve esse preço com uma fonte automática depois.
  if (
    !item.autoQueued &&
    item.product
      ?.priceManuallyConfirmed ===
      true
  ) {
    const copy =
      await generateOfferCopy(
        item.product,
        'Preço confirmado manualmente pela usuária.'
      );

    item.text =
      copy.text;

    return {
      item,
      verified:
        true,
      manual:
        true
    };
  }

  let fresh =
    null;

  try {
    if (
      platform ===
        'shopee'
    ) {
      if (
        !isShopeeConfigured() ||
        !item.product?.itemId ||
        !item.product?.shopId
      ) {
        throw new Error(
          'Shopee sem dados suficientes para revalidar.'
        );
      }

      const [
        affiliateResult,
        liveResult
      ] =
        await Promise.allSettled([
          getShopeeProduct({
            itemId:
              item.product
                .itemId,
            shopId:
              item.product
                .shopId
          }),
          getShopeeLiveProduct({
            itemId:
              item.product
                .itemId,
            shopId:
              item.product
                .shopId
          })
        ]);

      const affiliateFresh =
        affiliateResult.status ===
          'fulfilled'
          ? affiliateResult.value
          : null;

      const liveFresh =
        liveResult.status ===
          'fulfilled'
          ? liveResult.value
          : null;

      if (
        !affiliateFresh &&
        !liveFresh
      ) {
        throw new Error(
          'Shopee não confirmou o produto em nenhuma das duas fontes.'
        );
      }

      fresh = {
        ...(
          affiliateFresh ||
          {}
        ),
        ...(
          liveFresh ||
          {}
        ),
        productLink:
          affiliateFresh
            ?.productLink ||
          item.product
            ?.productLink ||
          item.product
            ?.canonicalUrl ||
          '',
        affiliateLink:
          affiliateFresh
            ?.affiliateLink ||
          item.product
            ?.affiliateLink ||
          null
      };

      if (
        affiliateFresh
          ?.productLink
      ) {
        fresh.affiliateLink =
          await generateShopeeShortLink(
            affiliateFresh
              .productLink,
            [
              'whatsapp',
              'auri'
            ]
          );
      }

      if (
        item.autoQueued &&
        config
          .autoQueueStrictValidation
      ) {
        if (!liveFresh) {
          throw new Error(
            'Auto fila bloqueada: preço ao vivo da Shopee não pôde ser confirmado.'
          );
        }

        if (
          !stableShopeePrice(
            liveFresh
          )
        ) {
          throw new Error(
            'Auto fila bloqueada: produto tem variações com preços diferentes.'
          );
        }

        const affiliatePrice =
          Number(
            affiliateFresh
              ?.price ||
            0
          );

        const livePrice =
          Number(
            liveFresh
              ?.price ||
            0
          );

        if (
          affiliatePrice <= 0 ||
          livePrice <= 0 ||
          Math.abs(
            affiliatePrice -
            livePrice
          ) >= 0.01
        ) {
          throw new Error(
            'Auto fila bloqueada: as fontes da Shopee estão mostrando preços diferentes.'
          );
        }
      }
    } else if (
      platform ===
        'mercadolivre'
    ) {
      if (
        item.product?.itemId
      ) {
        fresh =
          await getMeliProduct(
            item.product.itemId
          );
      } else {
        fresh =
          await getMeliProductFromUrl(
            item.product?.canonicalUrl ||
            item.publicLink ||
            item.link
          );
      }

      if (
        !fresh ||
        Number(
          fresh.price || 0
        ) <= 0
      ) {
        throw new Error(
          'Mercado Livre não confirmou o preço atual.'
        );
      }
    } else if (
      platform ===
        'shein'
    ) {
      fresh =
        await refreshSheinProduct(
          item.product?.canonicalUrl ||
          item.publicLink ||
          item.link
        );

      if (
        !fresh ||
        Number(
          fresh.price || 0
        ) <= 0
      ) {
        throw new Error(
          'SHEIN não confirmou o preço atual.'
        );
      }
    } else {
      // Ofertas manuais continuam como estão.
      return {
        item,
        verified:
          false,
        manual:
          true
      };
    }

    const merged =
      mergeFreshProduct(
        item.product,
        fresh
      );

    if (
      Number(
        merged.price || 0
      ) <= 0
    ) {
      throw new Error(
        'Preço atual inválido.'
      );
    }

    item.product =
      merged;

    item.link =
      merged.affiliateLink ||
      item.link;

    // Sempre recria o texto com os números acabados de validar.
    const copy =
      await generateOfferCopy(
        merged,
        'Revalidação imediatamente antes do envio.'
      );

    item.text =
      copy.text;

    item.aiProvider =
      copy.provider;

    item.verifiedAt =
      new Date()
        .toISOString();

    item.verificationStatus =
      'fresh-before-send';

    updateStore((x) => {
      x.metrics
        .refreshedBeforeSend +=
        1;

      return x;
    });

    return {
      item,
      verified:
        true,
      manual:
        false
    };
  } catch (e) {
    return {
      item,
      verified:
        false,
      manual:
        false,
      error:
        e.message
    };
  }
}

export async function sendOneNow() {
  if (busy) {
    throw new Error(
      'Já existe um envio em andamento.'
    );
  }

  busy = true;

  try {
    const s =
      readStore();

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
                    jid:
                      s.targetGroupJid,
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

    const refreshed =
      await refreshBeforeSend({
        ...s.queue[0]
      });

    // Auto fila: se não conseguir confirmar o valor atual,
    // NÃO envia um texto potencialmente errado.
    if (
      refreshed.item?.autoQueued &&
      !refreshed.verified
    ) {
      updateStore((x) => {
        const blocked =
          x.queue.shift();

        if (blocked) {
          x.suggestions.unshift({
            ...blocked,
            autoQueued:
              false,
            needsReview:
              true,
            verificationWarning:
              refreshed.error ||
              'Não consegui revalidar os dados antes do envio.'
          });

          x.suggestions =
            x.suggestions.slice(
              0,
              config.discoverySuggestionCap
            );
        }

        x.metrics
          .quarantinedBeforeSend +=
          1;

        return x;
      });

      return {
        item:
          refreshed.item,
        sentCount:
          0,
        skipped:
          true,
        reason:
          refreshed.error ||
          'Revalidação falhou.'
      };
    }

    const item =
      refreshed.item;

    const sentCount =
      await sendOfferToGroups(
        groups,
        item
      );

    updateStore((x) => {
      x.queue.shift();

      x.metrics
        .sentMessages +=
        sentCount;

      return x;
    });

    markSent(item);

    return {
      item,
      sentCount,
      skipped:
        false
    };
  } finally {
    busy = false;
  }
}

async function maybeSendDailyTrends(
  telegram,
  adminId
) {
  const slot =
    trendSlot();

  if (
    !slot ||
    slot ===
      lastTrendSlot
  ) {
    return;
  }

  const store =
    readStore();

  if (
    store
      .lastTrendsSentDate ===
    slot
  ) {
    lastTrendSlot =
      slot;

    return;
  }

  lastTrendSlot =
    slot;

  try {
    const digest =
      await buildTrendDigest();

    await telegram.sendMessage(
      adminId,
      digest.text
    );

    updateStore((s) => {
      s.lastTrendsSentDate =
        slot;

      return s;
    });
  } catch (e) {
    console.error(
      'Tendências diárias:',
      e.message
    );
  }
}

async function ensureDailyTrendData() {
  const today =
    nowParts().date;

  const s =
    readStore();

  if (
    s.dailyTrendTerms?.date ===
      today &&
    Array.isArray(
      s.dailyTrendTerms?.terms
    ) &&
    s.dailyTrendTerms.terms.length
  ) {
    return;
  }

  try {
    await buildTrendDigest();
  } catch (e) {
    console.error(
      'Tendências para Auto busca:',
      e.message
    );
  }
}

async function tick({
  telegram,
  adminId
} = {}) {
  const p =
    nowParts();

  const slot =
    `${p.date}-${p.hour}:${p.minute}`;

  const s =
    readStore();

  if (
    !s.paused &&
    eligibleTime() &&
    slot !== lastSlot &&
    s.queue.length
  ) {
    lastSlot =
      slot;

    try {
      await sendOneNow();
    } catch (e) {
      console.error(
        'Envio automático:',
        e.message
      );
    }
  }

  if (
    telegram &&
    adminId
  ) {
    await maybeSendDailyTrends(
      telegram,
      adminId
    );
  }

  const ds =
    discoverySlot();

  if (
    s.autoDiscovery &&
    ds &&
    ds !==
      lastDiscoverySlot
  ) {
    lastDiscoverySlot =
      ds;

    await ensureDailyTrendData();

    discoverWebOffers()
      .catch(
        (e) =>
          console.error(
            'Busca automática:',
            e.message
          )
      );
  }
}

export function startScheduler({
  telegram,
  adminId
} = {}) {
  setInterval(
    () =>
      tick({
        telegram,
        adminId
      }).catch(
        console.error
      ),
    15000
  );

  setTimeout(
    () =>
      tick({
        telegram,
        adminId
      }).catch(
        console.error
      ),
    3000
  );

  console.log(
    `⏰ Scheduler ativo: ${config.sendIntervalMinutes} min, 08h–${config.include22 ? '22h' : '21h'}; até 85 envios/dia com fila cheia.`
  );

  console.log(
    `🔎 Pesquisa web: até ${config.discoveryMaxPerRun} produtos por rodada, a cada ${config.discoveryEveryMinutes} min.`
  );

  if (
    config.trendsEnabled
  ) {
    console.log(
      `📈 Tendências Telegram: diariamente às ${String(config.trendsHour).padStart(2, '0')}:${String(config.trendsMinute).padStart(2, '0')}.`
    );
  }
}
