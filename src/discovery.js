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
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não configurada no Railway.'
    );
  }

  const model =
    process.env.GEMINI_SEARCH_MODEL ||
    'gemini-2.5-flash';

  const amount = config.discoveryMaxPerRun;

  const prompt = `
Pesquise AGORA na web, usando a Pesquisa Google, produtos reais
que estejam à venda no Brasil nestes marketplaces:

- Shopee Brasil
- SHEIN Brasil
- Mercado Livre Brasil

Temas desta rodada:
${categories.map((x) => `- ${x}`).join('\n')}

Quero até ${amount} PRODUTOS DIFERENTES e atuais.

OBJETIVO:
Montar sugestões para um grupo brasileiro de achadinhos.
Pode incluir alimentos, bebidas, supermercado, limpeza, casa,
decoração, cozinha, organização, beleza, moda, tecnologia, pet,
infantil, automotivo, papelaria, fitness, viagem, presentes,
utilidades e itens sazonais.

DISTRIBUIÇÃO:
- Misture Shopee, SHEIN e Mercado Livre.
- Quando houver resultados válidos, tente trazer pelo menos
  1 produto de cada marketplace nesta rodada.
- Não concentre todos os produtos no mesmo nicho.

REGRAS DO LINK — OBRIGATÓRIAS:
- Retorne SOMENTE página DIRETA de um produto específico.
- NÃO retorne busca, categoria, vitrine, loja, coleção ou home.
- Use o URL público EXATO que apareceu no resultado da pesquisa.
- NÃO invente URL.
- NÃO monte URL a partir do nome.
- NÃO encurte nem altere o link.
- NÃO gere link de afiliado.
- O produto descrito precisa ser exatamente o produto do link.

REGRAS DE VERACIDADE:
- A pesquisa é para descobrir CANDIDATOS. O sistema vai abrir
  e validar cada página depois.
- NÃO invente preço.
- NÃO invente preço anterior.
- NÃO invente desconto.
- NÃO invente cupom.
- NÃO invente vendidos/pedidos.
- NÃO invente avaliações/reviews.
- NÃO invente material, tamanho, variação ou benefício.
- Se um dado não estiver claramente visível/confirmável,
  retorne 0 ou null.

PROVA DE VENDA — OBRIGATÓRIA:
Só retorne produtos que tenham indício público de que já foram
comprados.

Aceite como candidato quando a pesquisa mostrar:
1) vendidos/pedidos maior que 0; OU
2) avaliações/reviews maior que 0.

Preferências:
- Mercado Livre: priorize anúncios com vendidos > 0.
- Shopee: priorize vendidos > 0 ou avaliações > 0.
- SHEIN: avaliações/reviews > 0 podem servir como prova,
  pois o contador de vendas nem sempre é exibido.

Se não houver nenhuma prova de compra, descarte e procure outro.

Retorne SOMENTE JSON válido, sem markdown e sem explicações.

Formato:
[
  {
    "platform": "shopee|shein|mercadolivre",
    "name": "nome exato do produto",
    "price": 0,
    "originalPrice": 0,
    "discountPct": 0,
    "publicLink": "https://...",
    "imageUrl": null,
    "soldCount": 0,
    "reviewCount": 0,
    "salesEvidence": "prova de compra encontrada na pesquisa",
    "couponCode": null,
    "couponVerified": false,
    "reason": "motivo factual e curto"
  }
]
`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ],
      tools: [
        {
          google_search: {}
        }
      ],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 2600
      }
    })
  });

  const json = await res.json();

  if (!res.ok) {
    const raw =
      json?.error?.message ||
      `Gemini Search HTTP ${res.status}`;

    if (
      res.status === 429 ||
      /quota|rate limit|resource exhausted/i.test(raw)
    ) {
      throw new Error(
        'A pesquisa atingiu o limite temporário do Gemini. ' +
        'Aguarde a cota liberar e tente novamente. ' +
        'A Auri continua configurada para pesquisar em lotes pequenos.'
      );
    }

    throw new Error(raw);
  }

  const text = String(
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('\n') || ''
  ).trim();

  const rows = parseArray(text);

  if (!rows.length) {
    throw new Error(
      'O Gemini pesquisou, mas não retornou produtos estruturados nesta rodada.'
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


function isDirectProductUrl(platform, url) {
  const s = String(url || '').toLowerCase();

  if (platform === 'mercadolivre') {
    return (
      /mercadolivre\.com\.br\/.+\/p\/mlb\d+/i.test(s) ||
      /produto\.mercadolivre\.com\.br\/mlb-?\d+/i.test(s) ||
      /mercadolivre\.com\.br\/mlb-?\d+/i.test(s)
    );
  }

  if (platform === 'shopee') {
    return (
      /shopee\.com\.br\/.+-i\.\d+\.\d+/i.test(s) ||
      /shopee\.com\.br\/product\/\d+\/\d+/i.test(s)
    );
  }

  if (platform === 'shein') {
    return (
      /shein\.com(?:\.br)?\/.+-p-\d+\.html/i.test(s) ||
      /shein\.com(?:\.br)?\/.+-p-\d+/i.test(s)
    );
  }

  return false;
}

function firstCount(text, patterns) {
  const src = String(text || '');

  for (const pattern of patterns) {
    const m = src.match(pattern);
    if (!m) continue;

    const raw = String(m[1] || '')
      .trim()
      .toLowerCase()
      .replace(/\./g, '')
      .replace(',', '.');

    const n = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*([km])?/i);
    if (!n) continue;

    let value = Number(n[1]);
    if (!Number.isFinite(value)) continue;

    const suffix = String(n[2] || '').toLowerCase();
    if (suffix === 'k') value *= 1000;
    if (suffix === 'm') value *= 1000000;

    value = Math.floor(value);
    if (value > 0) return value;
  }

  return 0;
}

function extractSalesEvidenceFromHtml(platform, html) {
  const s = decodeHtml(html);

  let soldCount = 0;
  let reviewCount = 0;

  if (platform === 'mercadolivre') {
    soldCount = firstCount(s, [
      /"sold_quantity"\s*:\s*([0-9]+)/i,
      /([0-9.,]+\s*[km]?)\s+vendidos/i,
      /([0-9.,]+\s*[km]?)\s+vendido/i
    ]);

    reviewCount = firstCount(s, [
      /"reviews_count"\s*:\s*([0-9]+)/i,
      /"rating_count"\s*:\s*([0-9]+)/i,
      /([0-9.,]+\s*[km]?)\s+avalia[cç][oõ]es/i
    ]);
  }

  if (platform === 'shopee') {
    soldCount = firstCount(s, [
      /"historical_sold"\s*:\s*([0-9]+)/i,
      /"sold"\s*:\s*([0-9]+)/i,
      /([0-9.,]+\s*[km]?)\s+vendidos/i,
      /([0-9.,]+\s*[km]?)\s+vendido/i
    ]);

    reviewCount = firstCount(s, [
      /"rating_total"\s*:\s*([0-9]+)/i,
      /"rating_count"\s*:\s*([0-9]+)/i,
      /"item_rating"\s*:\s*\{[\s\S]{0,300}?"rating_count"\s*:\s*\[?([0-9]+)/i,
      /([0-9.,]+\s*[km]?)\s+avalia[cç][oõ]es/i
    ]);
  }

  if (platform === 'shein') {
    soldCount = firstCount(s, [
      /"sale_count"\s*:\s*"?([0-9]+)"?/i,
      /"sales_count"\s*:\s*"?([0-9]+)"?/i,
      /"sold_count"\s*:\s*"?([0-9]+)"?/i
    ]);

    reviewCount = firstCount(s, [
      /"comment_num"\s*:\s*"?([0-9]+)"?/i,
      /"review_count"\s*:\s*"?([0-9]+)"?/i,
      /"reviews_count"\s*:\s*"?([0-9]+)"?/i,
      /"comment_count"\s*:\s*"?([0-9]+)"?/i
    ]);
  }

  return {
    soldCount,
    reviewCount
  };
}

async function pageMetadata(url, platform) {
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

    const finalUrl = res.url || url;
    const evidence = extractSalesEvidenceFromHtml(
      platform,
      normalized
    );

    return {
      finalUrl,
      directProduct:
        isDirectProductUrl(platform, finalUrl),
      name,
      imageUrl,
      price:
        Number.isFinite(price) && price > 0
          ? price
          : 0,
      soldCount: evidence.soldCount,
      reviewCount: evidence.reviewCount
    };
  } catch {
    return {};
  }
}


function countNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  const s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(',', '.');

  if (!s) return 0;

  const m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*([km])?/i);
  if (!m) return 0;

  let n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;

  const suffix = String(m[2] || '').toLowerCase();
  if (suffix === 'k') n *= 1000;
  if (suffix === 'm') n *= 1000000;

  return Math.floor(n);
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

  const meta = await pageMetadata(publicLink, platform);

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
    meta.name ||
    rowName ||
    '';

  if (!name) {
    return null;
  }

  // Preço só entra se a API/página confirmou.
  const price =
    Number(apiProduct?.price || 0) ||
    Number(meta.price || 0) ||
    0;

  const originalPrice =
    Number(apiProduct?.originalPrice || 0) ||
    0;

  const discountPct =
    Number(apiProduct?.discountPct || 0) ||
    (
      originalPrice > price && price > 0
        ? (
            (originalPrice - price) /
            originalPrice
          ) * 100
        : 0
    );

  // O resultado da IA é apenas candidato.
  // Vendas/avaliações só valem se vierem da API ou da página aberta.
  const soldCount = Math.max(
    countNumber(apiProduct?.sales),
    countNumber(meta.soldCount)
  );

  const reviewCount = Math.max(
    countNumber(apiProduct?.reviewCount),
    countNumber(meta.reviewCount)
  );

  // O redirect precisa terminar numa página direta de produto.
  if (!meta.directProduct) {
    return null;
  }

  // Regra dura: sem qualquer prova CONFIRMADA de venda, descarta.
  if (soldCount <= 0 && reviewCount <= 0) {
    return null;
  }

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
      meta.imageUrl ||
      null,
    price,
    originalPrice:
      originalPrice > price
        ? originalPrice
        : 0,
    discountPct,
    couponCode:
      apiProduct?.couponVerified && apiProduct?.couponCode
        ? String(apiProduct.couponCode)
        : null,
    couponVerified:
      Boolean(
        apiProduct?.couponVerified &&
        apiProduct?.couponCode
      ),
    canonicalUrl:
      apiProduct?.canonicalUrl ||
      meta.finalUrl,
    publicLink:
      meta.finalUrl,
    affiliateLink: null,
    rating:
      Number(apiProduct?.rating || 0),
    sales: soldCount,
    reviewCount,
    salesVerified: true,
    salesEvidence:
      soldCount > 0
        ? `${soldCount.toLocaleString('pt-BR')} vendidos/pedidos confirmados`
        : `${reviewCount.toLocaleString('pt-BR')} avaliações/reviews confirmados`,
    score:
      Math.max(
        50,
        Number(apiProduct?.score || 0)
      ),
    webReason:
      soldCount > 0
        ? `Já teve ${soldCount.toLocaleString('pt-BR')} vendas/pedidos confirmados.`
        : `Já tem ${reviewCount.toLocaleString('pt-BR')} avaliações/reviews confirmados.`,
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

  products.sort(
    (a, b) =>
      (Number(b.sales || 0) * 10 + Number(b.reviewCount || 0)) -
      (Number(a.sales || 0) * 10 + Number(a.reviewCount || 0))
  );

  const suggestions = [];

  for (const product of products) {
    const copy = await generateOfferCopy(
      product,
      `Encontrado automaticamente pela pesquisa web da Auri. Temas: ${categories.join(', ')}. Produto com prova de venda: ${product.salesEvidence}. O link atual é público; antes de ir para a fila a usuária fornecerá o link de afiliada.`
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
