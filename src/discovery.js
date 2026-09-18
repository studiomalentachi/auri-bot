import crypto from 'node:crypto';
import { config } from './config.js';
import { generateOfferCopy } from './ai.js';
import {
  generateShopeeShortLink,
  isShopeeConfigured,
  searchShopeeOffersBroad
} from './shopee.js';
import { importProductFromUrl } from './marketplaces.js';
import {
  isDuplicate,
  productKey,
  readStore,
  updateStore
} from './store.js';

const MIN_SALES = () => {
  const s =
    readStore();

  return Math.max(
    50,
    Number(
      s.searchFilters?.minSales ||
      config.discoveryMinSales ||
      50
    )
  );
};

function nextCategories() {
  const s = readStore();
  const list =
    config.discoveryKeywords.length
      ? config.discoveryKeywords
      : ['achadinhos'];

  let idx =
    Number(s.discoveryKeywordIndex || 0);

  const picked = [];

  for (
    let i = 0;
    i < config.discoveryCategoriesPerRun;
    i += 1
  ) {
    picked.push(
      list[idx % list.length]
    );
    idx += 1;
  }

  updateStore((x) => {
    x.discoveryKeywordIndex =
      idx % list.length;
    return x;
  });

  return picked;
}

function countNumber(v) {
  const n = Number(v || 0);

  return Number.isFinite(n)
    ? Math.max(0, Math.floor(n))
    : 0;
}

function verifiedFacts(product) {
  const f = [];

  if (product.name) {
    f.push(
      `Nome do anúncio: ${product.name}`
    );
  }

  if (Number(product.price || 0) > 0) {
    f.push(
      `Preço atual confirmado: R$ ${Number(product.price)
        .toFixed(2)
        .replace('.', ',')}`
    );
  }

  if (
    Number(product.originalPrice || 0) >
    Number(product.price || 0)
  ) {
    f.push(
      `Preço anterior confirmado: R$ ${Number(product.originalPrice)
        .toFixed(2)
        .replace('.', ',')}`
    );
  }

  if (Number(product.discountPct || 0) > 0) {
    f.push(
      `Desconto confirmado: ${Math.round(
        Number(product.discountPct)
      )}%`
    );
  }

  if (Number(product.sales || 0) > 0) {
    f.push(
      `Vendas confirmadas: ${Number(product.sales)
        .toLocaleString('pt-BR')}`
    );
  }

  if (Number(product.rating || 0) > 0) {
    f.push(
      `Nota confirmada: ${Number(product.rating)
        .toFixed(1)
        .replace('.', ',')}`
    );
  }

  if (product.shopName) {
    f.push(
      `Loja confirmada: ${product.shopName}`
    );
  }

  return f;
}

function scoreProduct(p) {
  return (
    Math.log10(
      Math.max(
        0,
        Number(p.sales || 0)
      ) + 1
    ) * 100 +
    Math.max(
      0,
      Number(p.rating || 0)
    ) * 8 +
    Math.min(
      Math.max(
        0,
        Number(p.discountPct || 0)
      ),
      70
    )
  );
}

async function discoverShopee(categories) {
  if (!isShopeeConfigured()) {
    return [];
  }

  const all = [];
  const seen = new Set();

  for (const keyword of categories) {
    try {
      const filters =
        readStore()
          .searchFilters ||
        {};

      const found =
        await searchShopeeOffersBroad(
          keyword,
          {
            minSales:
              MIN_SALES(),
            desired:
              Math.max(
                20,
                Number(
                  filters.resultLimit ||
                  20
                )
              ),
            pages:
              filters.broadSearch ===
              false
                ? 2
                : 4,
            limitPerPage:
              20,
            sortType:
              5,
            broadSearch:
              filters.broadSearch !==
              false,
            sortBy:
              filters.sortBy ||
              'sales'
          }
        );

      for (const row of found) {
        const sales =
          countNumber(row.sales);

        // Pelo menos 50 vendas = 50 ou mais.
        if (sales < MIN_SALES()) {
          continue;
        }

        if (
          !row.itemId ||
          !row.shopId ||
          !row.productLink ||
          !row.name ||
          Number(row.price || 0) <= 0
        ) {
          continue;
        }

        const key =
          `shopee:${row.shopId}:${row.itemId}`;

        if (
          seen.has(key) ||
          isDuplicate(
            row,
            row.affiliateLink ||
            row.productLink
          )
        ) {
          continue;
        }

        seen.add(key);

        const publicProductLink =
          String(
            row.productLink || ''
          ).trim();

        const offerLink =
          String(
            row.affiliateLink || ''
          ).trim();

        let affiliateLink =
          offerLink &&
          offerLink !== publicProductLink
            ? offerLink
            : '';

        let affiliateLinkSource =
          affiliateLink
            ? 'offerLink'
            : '';

        try {
          const generated =
            String(
              await generateShopeeShortLink(
                publicProductLink,
                [
                  'whatsapp',
                  'auri',
                  keyword
                    .replace(/\s+/g, '-')
                    .slice(0, 20)
                ]
              ) || ''
            ).trim();

          // A função pode devolver o link público como fallback.
          // Nesse caso NÃO tratamos como link de afiliada confirmado.
          if (
            generated &&
            generated !== publicProductLink
          ) {
            affiliateLink =
              generated;
            affiliateLinkSource =
              'generateShortLink';
          }
        } catch {}

        const product = {
          ...row,
          platform: 'shopee',
          sales,
          affiliateLink,
          affiliateLinkVerified:
            Boolean(
              affiliateLink &&
              affiliateLinkSource
            ),
          affiliateLinkSource,
          publicLink:
            publicProductLink,
          dataSource:
            'Shopee Affiliate Open API',
          salesVerified: true,
          factsVerified: true,
          discoveryKeyword:
            keyword
        };

        product.verifiedFacts =
          verifiedFacts(product);

        product.verifiedScore =
          scoreProduct(product);

        all.push(product);
      }
    } catch (e) {
      console.error(
        `Shopee ${keyword}:`,
        e.message
      );
    }
  }

  return all;
}

function directUrl(platform, url) {
  const s =
    String(url || '')
      .toLowerCase();

  if (
    platform ===
    'mercadolivre'
  ) {
    return (
      /mercadolivre\.com\.br\/.+\/p\/mlb\d+/i.test(s) ||
      /produto\.mercadolivre\.com\.br\/mlb-?\d+/i.test(s) ||
      /mercadolivre\.com\.br\/mlb-?\d+/i.test(s)
    );
  }

  if (platform === 'shein') {
    return (
      /(?:br\.)?shein\.com\/.+-p-\d+(?:\.html)?/i.test(s) ||
      /shein\.com\.br\/.+-p-\d+(?:\.html)?/i.test(s)
    );
  }

  return false;
}

async function tavily(
  query,
  domains,
  maxResults = 18
) {
  const key =
    process.env.TAVILY_API_KEY;

  if (!key) {
    return [];
  }

  const res = await fetch(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${key}`,
        'Content-Type':
          'application/json'
      },
      body: JSON.stringify({
        query,
        topic: 'general',
        search_depth:
          'basic',
        max_results:
          maxResults,
        include_answer:
          false,
        include_raw_content:
          false,
        include_images:
          false,
        include_domains:
          domains,
        country:
          'brazil',
        include_usage:
          true,
        safe_search:
          true
      })
    }
  );

  const json =
    await res.json().catch(
      () => ({})
    );

  if (!res.ok) {
    return [];
  }

  return Array.isArray(
    json?.results
  )
    ? json.results
    : [];
}

async function discoverMercadoLivre(
  categories
) {
  const theme =
    categories
      .slice(0, 4)
      .join(' ou ');

  const results =
    await tavily(
      `${theme} Mercado Livre Brasil mais vendidos produto`,
      ['mercadolivre.com.br'],
      18
    );

  const out = [];
  const seen = new Set();

  for (const r of results) {
    const url =
      String(r?.url || '')
        .trim();

    if (
      !directUrl(
        'mercadolivre',
        url
      )
    ) {
      continue;
    }

    try {
      // O URL é descoberto pela Tavily,
      // mas os dados finais vêm da integração/API do ML.
      const product =
        await importProductFromUrl(
          url
        );

      if (
        !product ||
        product.platform !==
          'mercadolivre' ||
        !product.name ||
        Number(product.price || 0) <=
          0 ||
        Number(product.sales || 0) <
          MIN_SALES() ||
        !product.canonicalUrl
      ) {
        continue;
      }

      const key =
        `mercadolivre:${
          product.itemId ||
          product.productId ||
          product.canonicalUrl
        }`;

      if (
        seen.has(key) ||
        isDuplicate(
          product,
          product.canonicalUrl
        )
      ) {
        continue;
      }

      seen.add(key);

      product.publicLink =
        product.canonicalUrl;

      // Link afiliado do ML continua manual.
      product.affiliateLink =
        null;

      product.salesVerified =
        true;

      product.factsVerified =
        true;

      product.dataSource =
        'Mercado Livre API';

      product.verifiedFacts =
        verifiedFacts(product);

      product.verifiedScore =
        scoreProduct(product);

      out.push(product);
    } catch {}
  }

  return out;
}

function decodeHtml(v) {
  return String(v || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function firstPositive(
  text,
  patterns
) {
  for (const p of patterns) {
    const m =
      String(text || '')
        .match(p);

    if (!m) {
      continue;
    }

    const n =
      Number(
        String(m[1] || '')
          .replace(/\./g, '')
          .replace(',', '.')
      );

    if (
      Number.isFinite(n) &&
      n > 0
    ) {
      return n;
    }
  }

  return 0;
}

async function fetchSheinVerified(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      15000
    );

  try {
    const res =
      await fetch(
        url,
        {
          redirect:
            'follow',
          signal:
            controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml',
            'Accept-Language':
              'pt-BR,pt;q=0.9'
          }
        }
      );

    const html =
      decodeHtml(
        await res.text()
      );

    if (
      !res.ok ||
      !directUrl(
        'shein',
        res.url || url
      )
    ) {
      return null;
    }

    let name = '';
    let price = 0;
    let imageUrl = null;

    const scripts = [
      ...html.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
      )
    ];

    const findProduct =
      (node) => {
        if (!node) {
          return null;
        }

        if (
          Array.isArray(node)
        ) {
          for (
            const x of node
          ) {
            const f =
              findProduct(x);

            if (f) {
              return f;
            }
          }

          return null;
        }

        if (
          typeof node !==
          'object'
        ) {
          return null;
        }

        if (
          String(
            node['@type'] ||
            ''
          ).toLowerCase() ===
          'product'
        ) {
          return node;
        }

        if (node['@graph']) {
          return findProduct(
            node['@graph']
          );
        }

        return null;
      };

    for (
      const script of
      scripts
    ) {
      try {
        const p =
          findProduct(
            JSON.parse(
              script[1].trim()
            )
          );

        if (!p) {
          continue;
        }

        name =
          String(
            p.name || ''
          ).trim();

        const offers =
          Array.isArray(
            p.offers
          )
            ? p.offers[0]
            : p.offers || {};

        price =
          Number(
            offers.price ||
            offers.lowPrice ||
            offers
              ?.priceSpecification
              ?.price ||
            0
          );

        const image =
          Array.isArray(
            p.image
          )
            ? p.image[0]
            : p.image;

        imageUrl =
          typeof image ===
          'string'
            ? image
            : image?.url ||
              null;

        break;
      } catch {}
    }

    if (!name) {
      name =
        String(
          html.match(
            /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
          )?.[1] || ''
        ).trim();
    }

    if (!imageUrl) {
      imageUrl =
        html.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
        )?.[1] ||
        null;
    }

    if (!price) {
      price =
        firstPositive(
          html,
          [
            /"salePrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
            /"retailPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
            /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i
          ]
        );
    }

    // Avaliação não substitui venda.
    // Se a página não expõe um contador de vendas/pedidos,
    // o produto é descartado.
    const sales =
      firstPositive(
        html,
        [
          /"sale_count"\s*:\s*"?([0-9]+)"?/i,
          /"sales_count"\s*:\s*"?([0-9]+)"?/i,
          /"sold_count"\s*:\s*"?([0-9]+)"?/i,
          /"order_count"\s*:\s*"?([0-9]+)"?/i,
          /"soldNum"\s*:\s*"?([0-9]+)"?/i
        ]
      );

    if (
      !name ||
      price <= 0 ||
      sales < MIN_SALES()
    ) {
      return null;
    }

    const product = {
      platform:
        'shein',
      name,
      price,
      originalPrice:
        0,
      discountPct:
        0,
      sales,
      rating:
        0,
      imageUrl,
      canonicalUrl:
        res.url || url,
      publicLink:
        res.url || url,
      affiliateLink:
        null,
      salesVerified:
        true,
      factsVerified:
        true,
      dataSource:
        'Página oficial SHEIN'
    };

    product.verifiedFacts =
      verifiedFacts(product);

    product.verifiedScore =
      scoreProduct(product);

    return product;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverShein(
  categories
) {
  const theme =
    categories
      .slice(0, 4)
      .join(' ou ');

  const results =
    await tavily(
      `${theme} SHEIN Brasil mais vendidos produto`,
      [
        'br.shein.com',
        'shein.com'
      ],
      18
    );

  const out = [];
  const seen =
    new Set();

  for (const r of results) {
    const url =
      String(r?.url || '')
        .trim();

    if (
      !directUrl(
        'shein',
        url
      )
    ) {
      continue;
    }

    const product =
      await fetchSheinVerified(
        url
      );

    if (!product) {
      continue;
    }

    const key =
      product.canonicalUrl
        .toLowerCase()
        .replace(/[?#].*$/, '');

    if (
      seen.has(key) ||
      isDuplicate(
        product,
        product.canonicalUrl
      )
    ) {
      continue;
    }

    seen.add(key);
    out.push(product);
  }

  return out;
}


export async function searchSheinOffers(keyword, limit = 8) {
  const term = String(keyword || '').trim();

  if (!term) {
    throw new Error('Digite o nome do produto que quer procurar.');
  }

  if (!process.env.TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY não configurada.');
  }

  const results = await tavily(
    `${term} SHEIN Brasil mais vendidos produto`,
    ['br.shein.com', 'shein.com'],
    Math.max(12, Math.min(30, Number(limit || 8) * 3))
  );

  const out = [];
  const seen = new Set();

  for (const r of results) {
    const url = String(r?.url || '').trim();

    if (!directUrl('shein', url)) {
      continue;
    }

    const product = await fetchSheinVerified(url);

    if (!product) {
      continue;
    }

    if (Number(product.sales || 0) < MIN_SALES()) {
      continue;
    }

    const key = String(
      product.canonicalUrl ||
      product.publicLink ||
      url
    )
      .toLowerCase()
      .replace(/[?#].*$/, '');

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);

    product.affiliateLink = null;
    product.salesVerified = true;
    product.factsVerified = true;
    product.dataSource = 'Página oficial SHEIN';
    product.verifiedFacts = verifiedFacts(product);
    product.verifiedScore = scoreProduct(product);

    out.push(product);

    if (out.length >= Math.max(1, Number(limit || 8))) {
      break;
    }
  }

  return out;
}

function existingKeys() {
  const s =
    readStore();

  const set =
    new Set();

  for (
    const item of
    s.suggestions || []
  ) {
    const k =
      productKey(
        item.product,
        item.publicLink ||
        item.link
      );

    if (k) {
      set.add(k);
    }
  }

  return set;
}

export async function discoverWebOffers({
  force = false
} = {}) {
  const state =
    readStore();

  if (
    !force &&
    !state.autoDiscovery
  ) {
    return [];
  }

  const categories =
    nextCategories();

  const enabled =
    new Set(
      Array.isArray(
        state.enabledMarketplaces
      )
        ? state.enabledMarketplaces
        : [
            'shopee',
            'shein',
            'mercadolivre'
          ]
    );

  if (!enabled.size) {
    return [];
  }

  const [
    shopee,
    ml,
    shein
  ] =
    await Promise.all([
      enabled.has('shopee')
        ? discoverShopee(
            categories
          )
        : Promise.resolve([]),

      enabled.has('mercadolivre')
        ? discoverMercadoLivre(
            categories
          ).catch(
            () => []
          )
        : Promise.resolve([]),

      enabled.has('shein')
        ? discoverShein(
            categories
          ).catch(
            () => []
          )
        : Promise.resolve([])
    ]);

  const combined = [
    ...shopee,
    ...ml,
    ...shein
  ].sort(
    (a, b) =>
      Number(
        b.verifiedScore || 0
      ) -
      Number(
        a.verifiedScore || 0
      )
  );

  const existing =
    existingKeys();

  const selected = [];
  const seen =
    new Set();

  // Tenta ter variedade de marketplace primeiro.
  for (
    const platform of
    [
      'shopee',
      'mercadolivre',
      'shein'
    ].filter(
      (platform) =>
        enabled.has(platform)
    )
  ) {
    const p =
      combined.find(
        (x) =>
          x.platform ===
            platform &&
          Number(
            x.sales || 0
          ) >= MIN_SALES()
      );

    if (!p) {
      continue;
    }

    const k =
      productKey(
        p,
        p.publicLink ||
        p.canonicalUrl
      );

    if (
      k &&
      !existing.has(k) &&
      !seen.has(k)
    ) {
      seen.add(k);
      selected.push(p);
    }
  }

  for (
    const p of
    combined
  ) {
    if (
      selected.length >=
      config.discoveryMaxPerRun
    ) {
      break;
    }

    // Última trava: 100 ou menos nunca passa.
    if (
      Number(p.sales || 0) <
      MIN_SALES()
    ) {
      continue;
    }

    if (
      !p.factsVerified ||
      !p.name ||
      Number(p.price || 0) <= 0 ||
      !(
        p.publicLink ||
        p.canonicalUrl
      )
    ) {
      continue;
    }

    const k =
      productKey(
        p,
        p.publicLink ||
        p.canonicalUrl
      );

    if (
      !k ||
      existing.has(k) ||
      seen.has(k) ||
      isDuplicate(
        p,
        p.affiliateLink ||
        p.publicLink ||
        p.canonicalUrl
      )
    ) {
      continue;
    }

    seen.add(k);
    selected.push(p);
  }

  const suggestions = [];

  for (
    const product of
    selected
  ) {
    const copy =
      await generateOfferCopy(
        product,
        'Use somente verifiedFacts e campos confirmados. Não acrescente características, benefícios, materiais, tamanhos, cores, fragrâncias ou usos não confirmados.'
      );

    const hasAffiliate =
      Boolean(
        String(
          product.affiliateLink ||
          ''
        ).trim()
      );

    suggestions.push({
      id:
        crypto.randomBytes(4)
          .toString('hex'),
      text:
        copy.text,
      link:
        hasAffiliate
          ? product.affiliateLink
          : product.publicLink ||
            product.canonicalUrl,
      publicLink:
        product.publicLink ||
        product.canonicalUrl,
      photoPath:
        null,
      product,
      needsAffiliateLink:
        !hasAffiliate,
      aiGenerated:
        true,
      aiProvider:
        copy.provider,
      source:
        product.platform ===
        'shopee'
          ? 'shopee-affiliate-api'
          : 'verified-discovery',
      keyword:
        categories.join(', '),
      createdAt:
        new Date().toISOString()
    });
  }

  updateStore((x) => {
    x.suggestions = [
      ...suggestions,
      ...(x.suggestions || [])
    ].slice(
      0,
      config.discoverySuggestionCap
    );

    x.lastDiscoveryAt =
      new Date().toISOString();

    x.metrics.discoveryRuns +=
      1;

    return x;
  });

  return suggestions;
}

export const discoverShopeeOffers =
  discoverWebOffers;
