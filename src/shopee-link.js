import {
  getShopeeProduct,
  getShopeeLiveProduct,
  isShopeeConfigured,
  parseShopeeIds,
  searchShopeeOffers
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


function decodeHtmlEntities(value) {
  return decodeMany(
    String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#x27;/gi, "'")
      .replace(/&#34;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  );
}

function metaContent(html, key) {
  const text =
    String(html || '');

  const escaped =
    String(key)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`,
      'i'
    )
  ];

  for (
    const pattern of
    patterns
  ) {
    const m =
      text.match(
        pattern
      );

    if (m?.[1]) {
      return decodeHtmlEntities(
        m[1]
      ).trim();
    }
  }

  return '';
}

function titleFromHtml(html) {
  const og =
    metaContent(
      html,
      'og:title'
    ) ||
    metaContent(
      html,
      'twitter:title'
    );

  if (og) {
    return cleanLandingTitle(
      og
    );
  }

  const m =
    String(html || '')
      .match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      );

  return cleanLandingTitle(
    decodeHtmlEntities(
      m?.[1] ||
      ''
    )
  );
}

function imageFromHtml(html) {
  return (
    metaContent(
      html,
      'og:image'
    ) ||
    metaContent(
      html,
      'twitter:image'
    ) ||
    ''
  );
}

function priceFromHtml(html) {
  const direct = [
    metaContent(
      html,
      'product:price:amount'
    ),
    metaContent(
      html,
      'og:price:amount'
    ),
    metaContent(
      html,
      'price'
    )
  ];

  for (
    const value of direct
  ) {
    const n =
      Number(
        String(value || '')
          .replace(
            /[^0-9.,]/g,
            ''
          )
          .replace(
            /\./g,
            ''
          )
          .replace(
            ',',
            '.'
          )
      );

    if (
      Number.isFinite(n) &&
      n > 0
    ) {
      return n;
    }
  }

  const text =
    decodeHtmlEntities(
      html
    );

  const patterns = [
    /"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /"price_min"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
    /"priceMin"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i
  ];

  for (
    const pattern of
    patterns
  ) {
    const m =
      text.match(
        pattern
      );

    if (m?.[1]) {
      let n =
        Number(
          m[1]
        );

      if (
        n >= 100000
      ) {
        n =
          n / 100000;
      }

      if (
        Number.isFinite(n) &&
        n > 0
      ) {
        return n;
      }
    }
  }

  return 0;
}

function cleanLandingTitle(value) {
  return String(value || '')
    .replace(
      /\s*[|•-]\s*Shopee(?:\s+Brasil)?[\s\S]*$/i,
      ''
    )
    .replace(
      /^\s*Compre\s+/i,
      ''
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function normalizeWords(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9\s]/g,
      ' '
    )
    .split(/\s+/)
    .filter(
      (x) =>
        x.length >= 2
    );
}

function titleSimilarity(a, b) {
  const A =
    new Set(
      normalizeWords(
        a
      )
    );

  const B =
    new Set(
      normalizeWords(
        b
      )
    );

  if (
    !A.size ||
    !B.size
  ) {
    return 0;
  }

  let common =
    0;

  for (
    const token of A
  ) {
    if (
      B.has(token)
    ) {
      common += 1;
    }
  }

  return common /
    Math.max(
      A.size,
      B.size
    );
}

function searchTermsFromTitle(title) {
  const words =
    String(title || '')
      .replace(
        /\s+/g,
        ' '
      )
      .trim()
      .split(' ')
      .filter(Boolean);

  const terms = [
    String(title || '')
      .trim(),
    words
      .slice(0, 12)
      .join(' '),
    words
      .slice(0, 8)
      .join(' '),
    words
      .slice(0, 6)
      .join(' ')
  ]
    .filter(Boolean);

  return [
    ...new Set(
      terms
    )
  ];
}

async function findShopeeByLandingTitle(
  title
) {
  const cleanTitle =
    cleanLandingTitle(
      title
    );

  if (
    !cleanTitle
  ) {
    return null;
  }

  let best =
    null;

  let bestScore =
    0;

  for (
    const term of
    searchTermsFromTitle(
      cleanTitle
    )
  ) {
    for (
      let page = 1;
      page <= 3;
      page += 1
    ) {
      let rows =
        [];

      try {
        rows =
          await searchShopeeOffers(
            term,
            {
              page,
              limit:
                20,
              sortType:
                5
            }
          );
      } catch {
        rows =
          [];
      }

      for (
        const product of
        rows
      ) {
        const score =
          titleSimilarity(
            cleanTitle,
            product.name
          );

        if (
          score >
          bestScore
        ) {
          bestScore =
            score;

          best =
            product;
        }
      }

      if (
        best &&
        bestScore >=
          0.82
      ) {
        return {
          product:
            best,
          score:
            bestScore
        };
      }
    }
  }

  if (
    best &&
    bestScore >=
      0.5
  ) {
    return {
      product:
        best,
      score:
        bestScore
    };
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

  let landing = {
    finalUrl:
      exactLink,
    body:
      ''
  };

  try {
    landing =
      await fetchAffiliateLanding(
        exactLink
      );
  } catch {}

  let ids =
    idsFromLooseText(
      exactLink
    ) ||
    idsFromLooseText(
      landing.finalUrl
    ) ||
    idsFromLooseText(
      landing.body
    );

  const landingTitle =
    titleFromHtml(
      landing.body
    );

  const landingImage =
    imageFromHtml(
      landing.body
    );

  const landingPrice =
    priceFromHtml(
      landing.body
    );

  let matchedByTitle =
    null;

  // Muitos links s.shopee.com.br não expõem itemId/shopId no redirecionamento.
  // Nesse caso, usamos o mesmo título que aparece no preview do Telegram
  // para localizar o produto na Shopee Open API.
  if (
    !ids &&
    landingTitle
  ) {
    matchedByTitle =
      await findShopeeByLandingTitle(
        landingTitle
      );

    if (
      matchedByTitle
        ?.product
    ) {
      ids = {
        itemId:
          matchedByTitle
            .product
            .itemId,
        shopId:
          matchedByTitle
            .product
            .shopId
      };
    }
  }

  let affiliate =
    matchedByTitle
      ?.product ||
    null;

  let live =
    null;

  if (ids) {
    const [
      affiliateResult,
      liveResult
    ] =
      await Promise.allSettled([
        affiliate ||
        getShopeeProduct(
          ids
        ),
        getShopeeLiveProduct(
          ids
        )
      ]);

    affiliate =
      affiliateResult.status ===
        'fulfilled'
        ? affiliateResult.value
        : affiliate;

    live =
      liveResult.status ===
        'fulfilled'
        ? liveResult.value
        : null;
  }

  if (
    affiliate ||
    live
  ) {
    const product =
      mergeShopeeFacts(
        affiliate,
        live,
        exactLink,
        landing.finalUrl
      );

    if (
      !product.imageUrl &&
      landingImage
    ) {
      product.imageUrl =
        landingImage;
    }

    if (
      Number(
        product.price ||
        0
      ) <= 0 &&
      landingPrice > 0
    ) {
      product.price =
        landingPrice;

      product.priceMin =
        landingPrice;

      product.priceMax =
        landingPrice;
    }

    if (
      landingTitle &&
      (
        !product.name ||
        String(
          product.name
        ).length < 5
      )
    ) {
      product.name =
        landingTitle;
    }

    product.affiliateLink =
      exactLink;

    product.affiliateLinkVerified =
      true;

    product.suppliedAffiliateLink =
      true;

    product.resolutionMethod =
      ids
        ? (
            matchedByTitle
              ? 'landing-title-search'
              : 'ids'
          )
        : 'metadata';

    if (
      product.name &&
      Number(
        product.price ||
        0
      ) > 0
    ) {
      return product;
    }
  }

  // Último fallback: se o próprio link curto trouxe metadata suficiente,
  // usamos isso sem pedir nome/preço manualmente.
  if (
    landingTitle &&
    landingPrice > 0
  ) {
    return {
      platform:
        'shopee',
      itemId:
        ids?.itemId
          ? String(
              ids.itemId
            )
          : '',
      shopId:
        ids?.shopId
          ? String(
              ids.shopId
            )
          : '',
      name:
        landingTitle,
      imageUrl:
        landingImage ||
        null,
      price:
        landingPrice,
      priceMin:
        landingPrice,
      priceMax:
        landingPrice,
      discountPct:
        0,
      rating:
        0,
      sales:
        0,
      productLink:
        landing.finalUrl ||
        exactLink,
      canonicalUrl:
        landing.finalUrl ||
        exactLink,
      affiliateLink:
        exactLink,
      affiliateLinkVerified:
        true,
      suppliedAffiliateLink:
        true,
      factsVerified:
        true,
      resolutionMethod:
        'landing-metadata'
    };
  }

  throw new Error(
    'Consegui abrir seu link de afiliada, mas a Shopee não expôs dados suficientes para confirmar o produto automaticamente. Não vou pedir para você preencher tudo manualmente: tente outro link do mesmo produto ou use o link completo da página da Shopee.'
  );
}

