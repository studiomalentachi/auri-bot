import crypto from 'node:crypto';
import { config } from './config.js';
import { generateOfferCopy } from './ai.js';
import { importProductFromUrl } from './marketplaces.js';
import {
  isDuplicate,
  productKey,
  readStore,
  updateStore
} from './store.js';

const MARKETPLACE_DOMAINS = [
  'shopee.com.br',
  'mercadolivre.com.br',
  'mercadolibre.com',
  'shein.com',
  'shein.com.br'
];

function isPlaceholderName(name) {
  const s = String(name || '').trim().toLowerCase();
  return (
    !s ||
    [
      'produto',
      'produto shopee',
      'produto shein',
      'produto amazon',
      'produto mercado livre'
    ].includes(s)
  );
}

function nextCategories() {
  const s = readStore();
  const list = config.discoveryKeywords.length
    ? config.discoveryKeywords
    : ['achadinhos'];

  let idx = Number(s.discoveryKeywordIndex || 0);
  const picked = [];

  for (
    let i = 0;
    i < config.discoveryCategoriesPerRun;
    i += 1
  ) {
    picked.push(list[idx % list.length]);
    idx += 1;
  }

  updateStore((x) => {
    x.discoveryKeywordIndex = idx % list.length;
    return x;
  });

  return picked;
}

function normalizePlatform(value, url = '') {
  const s = `${value || ''} ${url || ''}`.toLowerCase();

  if (s.includes('shopee')) return 'shopee';
  if (s.includes('shein')) return 'shein';

  if (
    s.includes('mercado livre') ||
    s.includes('mercadolivre') ||
    s.includes('mercadolibre') ||
    s.includes('meli.la')
  ) {
    return 'mercadolivre';
  }

  return 'generic';
}

function extractOutputText(json) {
  if (json?.output_text) {
    return String(json.output_text).trim();
  }

  return String(
    json?.output
      ?.flatMap((x) => x.content || [])
      .map((x) => x.text || '')
      .join('\n') || ''
  ).trim();
}

function parseArray(text) {
  let s = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.products)) {
      return parsed.products;
    }
  } catch {}

  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');

  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(
        s.slice(start, end + 1)
      );
      return Array.isArray(parsed) ? parsed : [];
    } catch {}
  }

  return [];
}

async function webSearchProducts(categories) {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    throw new Error(
      'OPENAI_API_KEY não configurada no Railway.'
    );
  }

  const model =
    process.env.OPENAI_WEB_SEARCH_MODEL ||
    'gpt-5.6-luna';

  const amount = config.discoveryMaxPerRun;

  const prompt = `
Pesquise AGORA produtos reais à venda no Brasil em:
- Shopee Brasil
- SHEIN Brasil
- Mercado Livre Brasil

Temas desta rodada:
${categories.map((x) => `- ${x}`).join('\n')}

Quero ${amount} PRODUTOS DIFERENTES e atuais.

OBJETIVO:
Montar sugestões para um grupo brasileiro de achadinhos.
Inclua qualquer tipo de produto permitido, inclusive alimentos,
bebidas, limpeza, casa, organização, beleza, moda, tecnologia,
pet, infantil, automotivo, papelaria, cozinha, fitness, viagem,
utilidades, presentes e itens sazonais.

REGRAS:
- Pesquise de verdade na web; não use apenas conhecimento interno.
- Misture os 3 marketplaces quando houver bons resultados.
- Dê preferência a páginas de PRODUTO, não páginas de categoria.
- O link deve ser público/normal. NÃO invente link de afiliado.
- Priorize preço interessante, promoção real, produto útil,
  popular, curioso ou com boa relação custo-benefício.
- Não repita o mesmo produto.
- Só informe preço, preço anterior, desconto ou cupom se estiver
  confirmado na fonte atual.
- Nunca invente cupom.
- Se não conseguir confirmar um dado, use 0 ou null.
- Para imageUrl, use URL de imagem somente se você realmente a
  encontrou. Caso contrário use null.
- Retorne SOMENTE JSON válido, sem markdown e sem explicações.

Formato exato:
[
  {
    "platform": "shopee|shein|mercadolivre",
    "name": "nome real do produto",
    "price": 0,
    "originalPrice": 0,
    "discountPct": 0,
    "publicLink": "https://...",
    "imageUrl": null,
    "couponCode": null,
    "couponVerified": false,
    "reason": "motivo curto pelo qual é um bom achado"
  }
]
`;

  const res = await fetch(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'none' },
        tools: [
          {
            type: 'web_search',
            search_context_size: 'low',
            filters: {
              allowed_domains: MARKETPLACE_DOMAINS
            }
          }
        ],
        input: prompt,
        max_output_tokens: 2600
      })
    }
  );

  const json = await res.json();

  if (!res.ok) {
    const raw =
      json?.error?.message ||
      `OpenAI Web Search HTTP ${res.status}`;

    if (
      res.status === 429 ||
      /rate limit|tokens per min|tpm/i.test(raw)
    ) {
      throw new Error(
        'A pesquisa atingiu o limite temporário da API da OpenAI. ' +
        'A Auri foi ajustada para pesquisar em lotes menores. ' +
        'Se a conta da API estiver sem faturamento ativo, pode ser necessário ' +
        'adicionar créditos/método de pagamento na OpenAI Platform ou aguardar ' +
        'o prazo de liberação mostrado pela própria API.'
      );
    }

    throw new Error(raw);
  }

  const rows = parseArray(extractOutputText(json));

  if (!rows.length) {
    throw new Error(
      'A pesquisa web não retornou produtos estruturados nesta rodada.'
    );
  }

  return rows;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

async function pageMetadata(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) {
    return {};
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      12000
    );

    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/121.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,' +
          'image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      }
    });

    clearTimeout(timer);

    const html = await res.text().catch(() => '');
    const normalized = decodeHtml(html);

    const meta = (key) => {
      const a = normalized.match(
        new RegExp(
          `<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]+content=["']([^"']+)["']`,
          'i'
        )
      );

      const b = normalized.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${key}["']`,
          'i'
        )
      );

      return decodeHtml(
        a?.[1] || b?.[1] || ''
      );
    };

    let name =
      meta('og:title') ||
      meta('twitter:title') ||
      '';

    let imageUrl =
      meta('og:image') ||
      meta('twitter:image') ||
      null;

    let price = Number(
      meta('product:price:amount') ||
      meta('price') ||
      0
    );

    const ldScripts = [
      ...normalized.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
      )
    ];

    const inspectProduct = (node) => {
      if (!node) return null;

      if (Array.isArray(node)) {
        for (const child of node) {
          const found = inspectProduct(child);
          if (found) return found;
        }
        return null;
      }

      if (typeof node !== 'object') {
        return null;
      }

      const type = node['@type'];

      if (
        String(type || '').toLowerCase() === 'product' ||
        (
          Array.isArray(type) &&
          type.some(
            (x) =>
              String(x).toLowerCase() === 'product'
          )
        )
      ) {
        return node;
      }

      return inspectProduct(node['@graph']);
    };

    for (const match of ldScripts) {
      try {
        const product = inspectProduct(
          JSON.parse(match[1].trim())
        );

        if (!product) continue;

        const offers = Array.isArray(product.offers)
          ? product.offers[0]
          : product.offers || {};

        const image = Array.isArray(product.image)
          ? product.image[0]
          : product.image;

        name =
          name ||
          product.name ||
          '';

        imageUrl =
          imageUrl ||
          (
            typeof image === 'string'
              ? image
              : image?.url
          ) ||
          null;

        price =
          price ||
          Number(
            offers.price ||
            offers.lowPrice ||
            offers.priceSpecification?.price ||
            0
          );

        break;
      } catch {}
    }

    return {
      finalUrl: res.url || url,
      name,
      imageUrl,
      price:
        Number.isFinite(price) && price > 0
          ? price
          : 0
    };
  } catch {
    return {};
  }
}

async function enrich(row) {
  const publicLink = String(
    row.publicLink ||
    row.link ||
    row.url ||
    ''
  ).trim();

  if (!/^https?:\/\//i.test(publicLink)) {
    return null;
  }

  const platform = normalizePlatform(
    row.platform,
    publicLink
  );

  if (!['shopee', 'shein', 'mercadolivre'].includes(platform)) {
    return null;
  }

  let apiProduct = null;

  try {
    apiProduct = await importProductFromUrl(publicLink);
  } catch {}

  const meta = await pageMetadata(publicLink);

  const rowName = String(row.name || '').trim();
  const apiName = String(
    apiProduct?.name || ''
  ).trim();

  const name =
    (
      apiName &&
      !isPlaceholderName(apiName)
        ? apiName
        : ''
    ) ||
    rowName ||
    meta.name ||
    '';

  if (!name) {
    return null;
  }

  const price =
    Number(apiProduct?.price || 0) ||
    Number(row.price || 0) ||
    Number(meta.price || 0) ||
    0;

  const originalPrice =
    Number(apiProduct?.originalPrice || 0) ||
    Number(row.originalPrice || 0) ||
    0;

  const discountPct =
    Number(apiProduct?.discountPct || 0) ||
    Number(row.discountPct || 0) ||
    (
      originalPrice > price && price > 0
        ? (
            (originalPrice - price) /
            originalPrice
          ) * 100
        : 0
    );

  return {
    platform,
    itemId:
      apiProduct?.itemId ||
      null,
    productId:
      apiProduct?.productId ||
      null,
    name,
    imageUrl:
      apiProduct?.imageUrl ||
      row.imageUrl ||
      meta.imageUrl ||
      null,
    price,
    originalPrice:
      originalPrice > price
        ? originalPrice
        : 0,
    discountPct,
    couponCode:
      row.couponVerified && row.couponCode
        ? String(row.couponCode)
        : null,
    couponVerified:
      Boolean(
        row.couponVerified &&
        row.couponCode
      ),
    canonicalUrl:
      apiProduct?.canonicalUrl ||
      meta.finalUrl ||
      publicLink,
    publicLink,
    affiliateLink: null,
    rating:
      Number(apiProduct?.rating || 0),
    sales:
      Number(apiProduct?.sales || 0),
    score:
      Math.max(
        50,
        Number(apiProduct?.score || 0)
      ),
    webReason:
      String(row.reason || '').trim(),
    needsAffiliateLink: true
  };
}

function existingKeys() {
  const s = readStore();
  const keys = new Set();

  for (const x of s.suggestions || []) {
    const key = productKey(
      x.product,
      x.publicLink || x.link
    );
    if (key) keys.add(key);
  }

  return keys;
}

export async function discoverWebOffers({
  force = false
} = {}) {
  const s = readStore();

  if (!force && !s.autoDiscovery) {
    return [];
  }

  const categories = nextCategories();
  const raw = await webSearchProducts(categories);
  const seen = existingKeys();
  const products = [];

  for (const row of raw) {
    if (products.length >= config.discoveryMaxPerRun) {
      break;
    }

    const product = await enrich(row);

    if (!product) continue;

    const key = productKey(
      product,
      product.publicLink
    );

    if (!key || seen.has(key)) continue;

    if (
      isDuplicate(
        product,
        product.publicLink
      )
    ) {
      continue;
    }

    seen.add(key);
    products.push(product);
  }

  const suggestions = [];

  for (const product of products) {
    const copy = await generateOfferCopy(
      product,
      `Encontrado automaticamente pela pesquisa web da Auri. Temas: ${categories.join(', ')}. O link atual é público; antes de ir para a fila a usuária fornecerá o link de afiliada.`
    );

    suggestions.push({
      id: crypto.randomBytes(4).toString('hex'),
      text: copy.text,
      link: product.publicLink,
      publicLink: product.publicLink,
      photoPath: null,
      product,
      needsAffiliateLink: true,
      aiGenerated: true,
      aiProvider: copy.provider,
      source: 'web-discovery',
      keyword: categories.join(', '),
      createdAt: new Date().toISOString()
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

    x.metrics.discoveryRuns += 1;

    return x;
  });

  return suggestions;
}

// Compatibilidade com os imports antigos enquanto atualizamos a Auri.
export const discoverShopeeOffers = discoverWebOffers;
