import { importProductFromUrl } from './marketplaces.js';
import { importShopeeAffiliateLink } from './shopee-link.js';
import { refreshSheinProduct } from './discovery.js';

export function detectAffiliateMarketplace(input) {
  const s = String(input || '').toLowerCase();
  if (s.includes('shopee.')) return 'shopee';
  if (s.includes('mercadolivre.') || s.includes('mercadolibre.') || s.includes('meli.la')) return 'mercadolivre';
  if (s.includes('shein.') || s.includes('shein.top') || s.includes('onelink.shein')) return 'shein';
  if (s.includes('tiktok.') || s.includes('vt.tiktok.') || s.includes('shop.tiktok.')) return 'tiktokshop';
  return 'generic';
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function metaValue(html, key) {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${safe}["'][^>]+content=["']([^"']+)["']`, 'i'));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${safe}["']`, 'i'));
  return decodeHtml(a?.[1] || b?.[1] || '').trim();
}

function num(v) {
  const raw = String(v ?? '').replace(/R\$/gi,'').replace(/\s/g,'');
  if (!raw) return 0;
  let x = raw;
  if (x.includes(',') && x.includes('.')) x = x.replace(/\./g,'').replace(',','.');
  else if (x.includes(',')) x = x.replace(',','.');
  const n = Number(x.replace(/[^0-9.-]/g,''));
  return Number.isFinite(n) ? n : 0;
}

async function fetchLanding(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6'
      }
    });
    return { finalUrl: res.url || url, html: await res.text().catch(()=>'') };
  } finally {
    clearTimeout(timer);
  }
}

function genericProduct(html, finalUrl, platform) {
  const text = decodeHtml(html);
  const name = metaValue(text,'og:title') || metaValue(text,'twitter:title') ||
    text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
  const imageUrl = metaValue(text,'og:image') || null;
  const price = num(metaValue(text,'product:price:amount') || metaValue(text,'og:price:amount') ||
    text.match(/["'](?:salePrice|sale_price|currentPrice|current_price|price)["']\s*:\s*["']?([0-9]+(?:[.,][0-9]{1,2})?)/i)?.[1]);
  const originalPrice = num(text.match(/["'](?:originalPrice|original_price|listPrice|list_price|retailPrice)["']\s*:\s*["']?([0-9]+(?:[.,][0-9]{1,2})?)/i)?.[1]);
  const rating = num(text.match(/["'](?:ratingValue|rating_score|ratingScore)["']\s*:\s*["']?([0-9]+(?:[.,][0-9]+)?)/i)?.[1]);
  const sales = Number(text.match(/["']?(?:sold_count|soldCount|sales_count|salesCount|sold_quantity|soldQuantity)["']?\s*[:=]\s*["']?([0-9]{1,10})/i)?.[1] || 0);

  return {
    platform,
    name: String(name).replace(/\s*[|\-–]\s*(SHEIN|TikTok).*$/i,'').trim(),
    imageUrl,
    price,
    priceMin: price,
    priceMax: price,
    originalPrice: originalPrice > price ? originalPrice : 0,
    rating: rating <= 5 ? rating : 0,
    sales,
    canonicalUrl: finalUrl,
    publicLink: finalUrl,
    factsVerified: Boolean(name && price > 0),
    dataSource: 'Página oficial do marketplace'
  };
}

export async function refreshTikTokShopProduct(inputUrl) {
  const landing = await fetchLanding(inputUrl);
  const product = genericProduct(landing.html, landing.finalUrl, 'tiktokshop');
  if (!product.name || Number(product.price || 0) <= 0) {
    throw new Error('O TikTok Shop não expôs nome e preço suficientes nessa página. Não vou inventar os dados.');
  }
  return product;
}


function decodeMeliHtml(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeMeliDirectUrl(value, baseUrl = '') {
  let s = decodeMeliHtml(value)
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!s) return '';

  try {
    s = new URL(s, baseUrl || undefined).toString();
  } catch {}

  return s.split('#')[0];
}

function meliProductUrlFromHtml(html, baseUrl = '') {
  const normalized = decodeMeliHtml(html);

  if (!normalized) {
    return '';
  }

  // Links meli.la frequentemente caem em /social/.
  // O produto promovido fica em um bloco "single".
  // Esta busca é deliberadamente restrita ao bloco para não pegar
  // produtos de "quem viu também comprou".
  const marker =
    'ui-recommendations-list__items-wrapper--single';

  const markerIndex =
    normalized.indexOf(marker);

  const regions = [];

  if (markerIndex >= 0) {
    regions.push(
      normalized.slice(
        Math.max(0, markerIndex - 5000),
        Math.min(
          normalized.length,
          markerIndex + 50000
        )
      )
    );
  }

  // Algumas versões do HTML trazem o bloco inteiro sem a mesma
  // formatação de atributos; tentamos capturar um UL próximo.
  const looseSection =
    normalized.match(
      /<ul[^>]*ui-recommendations-list__items-wrapper--single[^>]*>[\s\S]*?<\/ul>/i
    );

  if (looseSection?.[0]) {
    regions.unshift(
      looseSection[0]
    );
  }

  // Dentro do bloco do produto promovido, aceitamos:
  // - anúncio vendedor MLB...
  // - PDP /p/MLB...
  // - URLs embutidas em href/JSON.
  for (const region of regions) {
    const absolute =
      region.match(
        /https?:\/\/(?:produto|www)\.mercadolivre\.com\.br\/[^"'<> \n\r\t]*(?:\/p\/MLB[-_]?\d+|MLB[-_]?\d+)[^"'<> \n\r\t]*/i
      );

    if (absolute?.[0]) {
      return normalizeMeliDirectUrl(
        absolute[0],
        baseUrl
      );
    }

    const href =
      region.match(
        /href=["']([^"']*(?:\/p\/MLB[-_]?\d+|MLB[-_]?\d+)[^"']*)["']/i
      );

    if (href?.[1]) {
      return normalizeMeliDirectUrl(
        href[1],
        baseUrl
      );
    }

    // Às vezes o HTML inclui apenas o item_id.
    const itemId =
      region.match(
        /["']?(?:item_id|itemId|id)["']?\s*[:=]\s*["']?(MLB[-_]?\d{6,})["']?/i
      );

    if (itemId?.[1]) {
      const digits =
        String(itemId[1])
          .replace(/\D/g, '');

      if (digits) {
        return `https://produto.mercadolivre.com.br/MLB-${digits}`;
      }
    }
  }

  // Se o redirecionamento já virou uma página de produto, usa ela.
  const canonical =
    normalized.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    ) ||
    normalized.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
    );

  if (
    canonical?.[1] &&
    /mercadolivre\.com\.br\/.*(?:\/p\/MLB|MLB[-_]?\d+)/i.test(
      canonical[1]
    )
  ) {
    return normalizeMeliDirectUrl(
      canonical[1],
      baseUrl
    );
  }

  const ogUrl =
    normalized.match(
      /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i
    ) ||
    normalized.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i
    );

  if (
    ogUrl?.[1] &&
    /mercadolivre\.com\.br\/.*(?:\/p\/MLB|MLB[-_]?\d+)/i.test(
      ogUrl[1]
    )
  ) {
    return normalizeMeliDirectUrl(
      ogUrl[1],
      baseUrl
    );
  }

  return '';
}

async function fetchMeliLandingWithAgent(
  inputUrl,
  userAgent
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      22000
    );

  try {
    const res =
      await fetch(
        inputUrl,
        {
          redirect: 'follow',
          signal:
            controller.signal,
          headers: {
            'User-Agent':
              userAgent,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language':
              'pt-BR,pt;q=0.9,en;q=0.6',
            'Cache-Control':
              'no-cache'
          }
        }
      );

    const html =
      await res.text()
        .catch(
          () => ''
        );

    return {
      finalUrl:
        res.url ||
        inputUrl,
      html
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveMeliAffiliateProductUrl(
  inputUrl
) {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
  ];

  let lastFinal =
    inputUrl;

  for (const agent of agents) {
    try {
      const landing =
        await fetchMeliLandingWithAgent(
          inputUrl,
          agent
        );

      lastFinal =
        landing.finalUrl ||
        lastFinal;

      // Se o próprio redirect já chegou no anúncio/PDP, perfeito.
      if (
        /mercadolivre\.com\.br\/.*(?:\/p\/MLB[-_]?\d+|MLB[-_]?\d+)/i.test(
          lastFinal
        )
      ) {
        return lastFinal;
      }

      const fromHtml =
        meliProductUrlFromHtml(
          landing.html,
          landing.finalUrl ||
          inputUrl
        );

      if (fromHtml) {
        return fromHtml;
      }
    } catch {}
  }

  // Retorna vazio em vez de chutar um produto aleatório.
  return '';
}


export async function importAffiliateProductLink(inputUrl) {
  const exact = String(inputUrl || '').trim();
  if (!/^https?:\/\//i.test(exact)) throw new Error('Cole um link completo começando com http:// ou https://.');

  const platform = detectAffiliateMarketplace(exact);
  if (platform === 'generic') throw new Error('Não reconheci esse marketplace. Use Shopee, Mercado Livre, SHEIN ou TikTok Shop.');

  let product = null;

  if (platform === 'shopee') {
    try { product = await importShopeeAffiliateLink(exact); }
    catch { product = await importProductFromUrl(exact); }
  } else if (platform === 'mercadolivre') {
    // Primeiro resolve o link curto meli.la até o produto promovido real.
    // Isso evita usar a própria página /social/ ou um item recomendado.
    const resolvedProductUrl =
      await resolveMeliAffiliateProductUrl(
        exact
      );

    if (!resolvedProductUrl) {
      throw new Error(
        'O Mercado Livre abriu o link de afiliada, mas não expôs o produto promovido no HTML dessa requisição. Tente novamente em alguns segundos; a Auri não vai escolher um produto aleatório.'
      );
    }

    product =
      await importProductFromUrl(
        resolvedProductUrl
      );

    // Mantém exatamente o link de afiliada colado pela usuária.
    if (product) {
      product.canonicalUrl =
        product.canonicalUrl ||
        resolvedProductUrl;

      product.resolvedAffiliateProductUrl =
        resolvedProductUrl;
    }
  } else if (platform === 'shein') {
    const landing = await fetchLanding(exact);
    try { product = await refreshSheinProduct(landing.finalUrl || exact); }
    catch { product = genericProduct(landing.html, landing.finalUrl || exact, 'shein'); }
  } else if (platform === 'tiktokshop') {
    product = await refreshTikTokShopProduct(exact);
  }

  if (!product || !product.name || Number(product.price || 0) <= 0) {
    throw new Error('Reconheci o marketplace, mas não consegui confirmar nome e preço. Não vou criar a oferta com dados inventados.');
  }

  product.platform = platform;
  product.affiliateLink = exact;
  product.affiliateLinkVerified = true;
  product.suppliedAffiliateLink = true;
  product.importedFromLink = true;
  product.importedAt = new Date().toISOString();

  if (Number(product.originalPrice || 0) > Number(product.price || 0) && Number(product.price || 0) > 0) {
    product.discountPct = ((Number(product.originalPrice) - Number(product.price)) / Number(product.originalPrice)) * 100;
  }

  return product;
}
