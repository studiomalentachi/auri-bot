import {
  getShopeeProduct,
  getShopeeLiveProduct,
  isShopeeConfigured,
  parseShopeeIds
} from './shopee.js';

function decodeMany(value) {
  let s =
    String(
      value || ''
    )
      .replace(
        /\\u002F/gi,
        '/'
      )
      .replace(
        /\\\//g,
        '/'
      )
      .replace(
        /&amp;/gi,
        '&'
      )
      .replace(
        /&quot;/gi,
        '"'
      )
      .replace(
        /&#39;/gi,
        "'"
      );

  for (
    let i = 0;
    i < 3;
    i += 1
  ) {
    try {
      const decoded =
        decodeURIComponent(
          s
        );

      if (
        decoded === s
      ) {
        break;
      }

      s = decoded;
    } catch {
      break;
    }
  }

  return s;
}

export function looksLikeShopeeLink(
  value
) {
  try {
    const host =
      new URL(
        String(value || '')
      )
        .hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ''
        );

    return Boolean(
      host ===
        'shope.ee' ||
      host ===
        'shp.ee' ||
      host ===
        'shopee.com.br' ||
      host.endsWith(
        '.shopee.com.br'
      )
    );
  } catch {
    return false;
  }
}

function idsFromLooseText(
  value
) {
  const text =
    decodeMany(
      value
    );

  const direct =
    parseShopeeIds(
      text
    );

  if (direct) {
    return direct;
  }

  const pairPatterns = [
    /["']?shopid["']?\s*[:=]\s*["']?(\d+)["']?[\s\S]{0,600}?["']?itemid["']?\s*[:=]\s*["']?(\d+)["']?/i,
    /["']?shop_id["']?\s*[:=]\s*["']?(\d+)["']?[\s\S]{0,600}?["']?item_id["']?\s*[:=]\s*["']?(\d+)["']?/i,
    /["']?shopId["']?\s*[:=]\s*["']?(\d+)["']?[\s\S]{0,600}?["']?itemId["']?\s*[:=]\s*["']?(\d+)["']?/i
  ];

  for (
    const pattern of
    pairPatterns
  ) {
    const m =
      text.match(
        pattern
      );

    if (m) {
      return {
        shopId:
          m[1],
        itemId:
          m[2]
      };
    }
  }

  const reversePatterns = [
    /["']?itemid["']?\s*[:=]\s*["']?(\d+)["']?[\s\S]{0,600}?["']?shopid["']?\s*[:=]\s*["']?(\d+)["']?/i,
    /["']?item_id["']?\s*[:=]\s*["']?(\d+)["']?[\s\S]{0,600}?["']?shop_id["']?\s*[:=]\s*["']?(\d+)["']?/i,
    /["']?itemId["']?\s*[:=]\s*["']?(\d+)["']?[\s\S]{0,600}?["']?shopId["']?\s*[:=]\s*["']?(\d+)["']?/i
  ];

  for (
    const pattern of
    reversePatterns
  ) {
    const m =
      text.match(
        pattern
      );

    if (m) {
      return {
        shopId:
          m[2],
        itemId:
          m[1]
      };
    }
  }

  // URLs da página do produto escondidas no HTML/JSON.
  const urls = [
    ...text.matchAll(
      /https?:\/\/[^"'<>\\\s]+/gi
    )
  ]
    .map(
      (m) =>
        m[0]
    )
    .slice(
      0,
      100
    );

  for (
    const candidate of
    urls
  ) {
    const ids =
      parseShopeeIds(
        decodeMany(
          candidate
        )
      );

    if (ids) {
      return ids;
    }
  }

  return null;
}

async function fetchAffiliateLanding(
  inputUrl
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      18000
    );

  try {
    const res =
      await fetch(
        inputUrl,
        {
          method:
            'GET',
          redirect:
            'follow',
          signal:
            controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
            'Accept':
              'text/html,application/xhtml+xml,application/json,text/plain,*/*',
            'Accept-Language':
              'pt-BR,pt;q=0.9',
            'Referer':
              'https://shopee.com.br/'
          }
        }
      );

    const body =
      await res
        .text()
        .catch(
          () => ''
        );

    return {
      finalUrl:
        res.url ||
        inputUrl,
      body,
      status:
        res.status
    };
  } finally {
    clearTimeout(
      timer
    );
  }
}

function mergeShopeeFacts(
  affiliate,
  live,
  exactAffiliateLink,
  resolvedUrl
) {
  const price =
    Number(
      live?.price ||
      affiliate?.price ||
      0
    );

  const priceMin =
    Number(
      live?.priceMin ||
      affiliate?.priceMin ||
      price ||
      0
    );

  const priceMax =
    Number(
      live?.priceMax ||
      affiliate?.priceMax ||
      priceMin ||
      0
    );

  const originalPrice =
    Number(
      live?.originalPrice ||
      affiliate?.originalPrice ||
      0
    );

  const discountPct =
    Number(
      live?.discountPct ||
      affiliate?.discountPct ||
      0
    );

  const rating =
    Number(
      live?.rating ||
      affiliate?.rating ||
      0
    );

  const sales =
    Number(
      affiliate?.sales ||
      live?.sales ||
      0
    );

  return {
    ...(affiliate || {}),
    ...(live || {}),

    platform:
      'shopee',

    itemId:
      String(
        live?.itemId ||
        affiliate?.itemId ||
        ''
      ),

    shopId:
      String(
        live?.shopId ||
        affiliate?.shopId ||
        ''
      ),

    name:
      live?.name ||
      affiliate?.name ||
      '',

    imageUrl:
      affiliate?.imageUrl ||
      live?.imageUrl ||
      null,

    price,
    priceMin,
    priceMax,
    originalPrice:
      originalPrice >
        price
        ? originalPrice
        : 0,
    discountPct:
      Number.isFinite(
        discountPct
      )
        ? discountPct
        : 0,
    rating:
      Number.isFinite(
        rating
      )
        ? rating
        : 0,
    sales:
      Number.isFinite(
        sales
      )
        ? sales
        : 0,

    productLink:
      affiliate
        ?.productLink ||
      affiliate
        ?.canonicalUrl ||
      resolvedUrl ||
      '',

    canonicalUrl:
      affiliate
        ?.canonicalUrl ||
      affiliate
        ?.productLink ||
      resolvedUrl ||
      '',

    // MUITO IMPORTANTE:
    // usa exatamente o link de afiliada que a usuária colou.
    affiliateLink:
      exactAffiliateLink,

    affiliateLinkVerified:
      true,

    suppliedAffiliateLink:
      true,

    factsVerified:
      Boolean(
        (
          live?.name ||
          affiliate?.name
        ) &&
        price > 0
      ),

    priceSource:
      live?.price > 0
        ? 'shopee-live'
        : 'shopee-affiliate-api'
  };
}

export async function importShopeeAffiliateLink(
  inputUrl
) {
  const exactLink =
    String(
      inputUrl || ''
    ).trim();

  if (
    !looksLikeShopeeLink(
      exactLink
    )
  ) {
    throw new Error(
      'Esse link não parece ser da Shopee.'
    );
  }

  if (
    !isShopeeConfigured()
  ) {
    throw new Error(
      'A Shopee Open API não está configurada.'
    );
  }

  let ids =
    idsFromLooseText(
      exactLink
    );

  let landing = {
    finalUrl:
      exactLink,
    body:
      ''
  };

  if (!ids) {
    try {
      landing =
        await fetchAffiliateLanding(
          exactLink
        );
    } catch {}

    ids =
      idsFromLooseText(
        landing.finalUrl
      ) ||
      idsFromLooseText(
        landing.body
      );
  }

  if (!ids) {
    throw new Error(
      'Não consegui descobrir qual produto existe dentro desse link da Shopee. Gere o link de afiliada novamente a partir da página do produto e envie aqui.'
    );
  }

  const [
    affiliateResult,
    liveResult
  ] =
    await Promise.allSettled([
      getShopeeProduct(
        ids
      ),
      getShopeeLiveProduct(
        ids
      )
    ]);

  const affiliate =
    affiliateResult.status ===
      'fulfilled'
      ? affiliateResult.value
      : null;

  const live =
    liveResult.status ===
      'fulfilled'
      ? liveResult.value
      : null;

  if (
    !affiliate &&
    !live
  ) {
    throw new Error(
      'Encontrei o produto dentro do link, mas a Shopee não devolveu os dados dele agora. Tente novamente em alguns minutos.'
    );
  }

  const product =
    mergeShopeeFacts(
      affiliate,
      live,
      exactLink,
      landing.finalUrl
    );

  if (
    !product.name ||
    Number(
      product.price ||
      0
    ) <= 0
  ) {
    throw new Error(
      'Encontrei o produto, mas não consegui confirmar nome e preço automaticamente.'
    );
  }

  return product;
}
