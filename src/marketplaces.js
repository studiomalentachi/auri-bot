import { generateShopeeShortLink, getShopeeProduct, isShopeeConfigured, parseShopeeIds, searchShopeeOffers } from './shopee.js';
import { addAmazonAffiliateTag, searchAmazon } from './amazon.js';
import { getMeliProductFromUrl, parseMeliReference, searchMeli } from './mercadolivre.js';

export function detectMarketplace(url) {
  const s = String(url || '').toLowerCase();
  if (s.includes('shopee.')) return 'shopee';
  if (s.includes('shein.')) return 'shein';
  if (s.includes('amazon.')) return 'amazon';
  if (s.includes('mercadolivre.') || s.includes('mercadolibre.') || s.includes('meli.la')) return 'mercadolivre';
  return 'generic';
}

function decodeHtmlText(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanMeliCandidate(value, baseUrl = '') {
  let s = decodeHtmlText(value)
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!s) return '';

  try {
    s = new URL(s, baseUrl || undefined).toString();
  } catch {}

  return s.split('#')[0];
}

async function fetchPage(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const res = await fetch(url, {
      method: 'GET',
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
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7'
      }
    });

    const html = await res.text().catch(() => '');

    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      html
    };
  } finally {
    clearTimeout(timer);
  }
}

function firstUsefulMeliUrl(html, baseUrl = '') {
  if (!html) return '';

  const normalized = decodeHtmlText(html);

  // Affiliate meli.la links frequently land on /social/... .
  // The promoted product is inside the single-product recommendation block.
  const sectionMatch = normalized.match(
    /<ul[^>]*class=["'][^"']*ui-recommendations-list__items-wrapper--single[^"']*["'][^>]*>[\s\S]*?<\/ul>/i
  );

  const regions = [
    sectionMatch?.[0] || '',
    normalized
  ];

  for (const region of regions) {
    if (!region) continue;

    const absolute = region.match(
      /https?:\/\/(?:produto|www)\.mercadolivre\.com\.br\/[^"'<> ]*(?:\/p\/MLB[-_]?\d+|MLB[-_]?\d+)[^"'<> ]*/i
    );

    if (absolute?.[0]) {
      const candidate = cleanMeliCandidate(
        absolute[0],
        baseUrl
      );

      if (parseMeliReference(candidate)) {
        return candidate;
      }
    }

    const relative = region.match(
      /href=["']([^"']*(?:\/p\/MLB[-_]?\d+|MLB[-_]?\d+)[^"']*)["']/i
    );

    if (relative?.[1]) {
      const candidate = cleanMeliCandidate(
        relative[1],
        baseUrl
      );

      if (parseMeliReference(candidate)) {
        return candidate;
      }
    }
  }

  // Canonical or OpenGraph URL is safer than a random recommendation.
  const canonical =
    normalized.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    ) ||
    normalized.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
    );

  if (canonical?.[1]) {
    const candidate = cleanMeliCandidate(
      canonical[1],
      baseUrl
    );

    if (parseMeliReference(candidate)) {
      return candidate;
    }
  }

  const ogUrl =
    normalized.match(
      /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i
    ) ||
    normalized.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i
    );

  if (ogUrl?.[1]) {
    const candidate = cleanMeliCandidate(
      ogUrl[1],
      baseUrl
    );

    if (parseMeliReference(candidate)) {
      return candidate;
    }
  }

  return '';
}

function extractJsonLdProduct(html) {
  const out = {};

  if (!html) return out;

  const scripts = [
    ...String(html).matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  ];

  const inspect = (node) => {
    if (!node) return null;

    if (Array.isArray(node)) {
      for (const child of node) {
        const found = inspect(child);
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
      (Array.isArray(type) &&
        type.some(
          (x) => String(x).toLowerCase() === 'product'
        ))
    ) {
      return node;
    }

    if (node['@graph']) {
      return inspect(node['@graph']);
    }

    return null;
  };

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(
        decodeHtmlText(script[1]).trim()
      );

      const product = inspect(parsed);
      if (!product) continue;

      const offers = Array.isArray(product.offers)
        ? product.offers[0]
        : product.offers || {};

      const image = Array.isArray(product.image)
        ? product.image[0]
        : product.image;

      out.name =
        product.name ||
        product.headline ||
        out.name ||
        '';

      out.imageUrl =
        typeof image === 'string'
          ? image
          : image?.url || out.imageUrl || null;

      out.price = Number(
        offers.price ||
        offers.lowPrice ||
        offers.priceSpecification?.price ||
        out.price ||
        0
      );

      if (out.name && out.price > 0) {
        return out;
      }
    } catch {}
  }

  return out;
}

function extractMeliPageMetadata(html, finalUrl = '') {
  const data = extractJsonLdProduct(html);
  const normalized = decodeHtmlText(html);

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

    return decodeHtmlText(a?.[1] || b?.[1] || '');
  };

  if (!data.name) {
    data.name =
      meta('og:title') ||
      meta('twitter:title') ||
      '';
  }

  if (!data.imageUrl) {
    data.imageUrl =
      meta('og:image') ||
      meta('twitter:image') ||
      null;
  }

  if (!Number(data.price || 0)) {
    data.price = Number(
      meta('product:price:amount') ||
      meta('price') ||
      0
    );
  }

  const embeddedPrice =
    normalized.match(
      /"current_price"\s*:\s*\{[\s\S]{0,300}?"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i
    ) ||
    normalized.match(
      /"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i
    );

  if (!Number(data.price || 0) && embeddedPrice?.[1]) {
    data.price = Number(embeddedPrice[1]);
  }

  const originalPrice =
    normalized.match(
      /"previous_price"\s*:\s*\{[\s\S]{0,300}?"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i
    ) ||
    normalized.match(
      /"original_price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i
    );

  if (originalPrice?.[1]) {
    data.originalPrice = Number(originalPrice[1]);
  }

  data.canonicalUrl =
    firstUsefulMeliUrl(html, finalUrl) ||
    finalUrl ||
    '';

  return data;
}

async function resolveRedirect(url) {
  try {
    const page = await fetchPage(url);
    return page.url || url;
  } catch {
    return url;
  }
}

async function resolveMercadoLivreAffiliateUrl(inputUrl) {
  let first;

  try {
    first = await fetchPage(inputUrl);
  } catch {
    return {
      url: inputUrl,
      html: ''
    };
  }

  let target =
    firstUsefulMeliUrl(
      first.html,
      first.url || inputUrl
    ) ||
    first.url ||
    inputUrl;

  // If the short link landed on an affiliate social/landing page,
  // fetch the actual promoted product page too.
  const shouldFetchTarget =
    target &&
    target !== first.url &&
    /mercadolivre\.com\.br/i.test(target);

  if (shouldFetchTarget) {
    try {
      const second = await fetchPage(target);

      return {
        url: second.url || target,
        html: second.html || first.html,
        landingUrl: first.url || inputUrl
      };
    } catch {}
  }

  return {
    url: target,
    html: first.html || '',
    landingUrl: first.url || inputUrl
  };
}

export async function importProductFromUrl(inputUrl) {
  const marketplace = detectMarketplace(inputUrl);
  let url = inputUrl;
  if (marketplace === 'shopee' || marketplace === 'mercadolivre') url = await resolveRedirect(inputUrl);

  if (marketplace === 'shopee') {
    const ids = parseShopeeIds(url);
    if (isShopeeConfigured() && ids) {
      const product = await getShopeeProduct(ids);
      if (product) {
        product.affiliateLink = await generateShopeeShortLink(product.productLink || url, [process.env.SHOPEE_SUB_ID_1 || 'whatsapp', process.env.SHOPEE_SUB_ID_2 || 'auri']);
        return product;
      }
    }
    return { platform: 'shopee', name: 'Produto Shopee', canonicalUrl: url, affiliateLink: inputUrl, imageUrl: null, price: 0, rating: 0, sales: 0, score: 0 };
  }

  if (marketplace === 'amazon') {
    return { platform: 'amazon', name: 'Produto Amazon', canonicalUrl: inputUrl, affiliateLink: addAmazonAffiliateTag(inputUrl), imageUrl: null, price: 0, rating: 0, sales: 0, score: 0 };
  }

  if (marketplace === 'mercadolivre') {
    const resolved = await resolveMercadoLivreAffiliateUrl(
      inputUrl
    );

    let product = null;

    const urlsToTry = [
      resolved.url,
      firstUsefulMeliUrl(
        resolved.html,
        resolved.url || inputUrl
      )
    ].filter(Boolean);

    for (const candidate of urlsToTry) {
      try {
        product = await getMeliProductFromUrl(candidate);

        if (
          product &&
          product.name &&
          Number(product.price || 0) > 0
        ) {
          break;
        }
      } catch {}
    }

    const pageData = extractMeliPageMetadata(
      resolved.html,
      resolved.url || inputUrl
    );

    if (!product) {
      product = {
        platform: 'mercadolivre',
        itemId: null,
        name: pageData.name || '',
        imageUrl: pageData.imageUrl || null,
        price: Number(pageData.price || 0),
        originalPrice: Number(
          pageData.originalPrice || 0
        ),
        canonicalUrl:
          pageData.canonicalUrl ||
          resolved.url ||
          inputUrl,
        affiliateLink: inputUrl,
        sales: 0,
        rating: 0,
        discountPct: 0,
        score: 50
      };
    } else {
      product.name =
        product.name ||
        pageData.name ||
        '';

      product.imageUrl =
        product.imageUrl ||
        pageData.imageUrl ||
        null;

      if (!Number(product.price || 0)) {
        product.price = Number(pageData.price || 0);
      }

      if (!Number(product.originalPrice || 0)) {
        product.originalPrice = Number(
          pageData.originalPrice || 0
        );
      }

      product.canonicalUrl =
        product.canonicalUrl ||
        pageData.canonicalUrl ||
        resolved.url ||
        inputUrl;
    }

    if (
      Number(product.originalPrice || 0) >
      Number(product.price || 0) &&
      Number(product.price || 0) > 0
    ) {
      product.discountPct =
        (
          (Number(product.originalPrice) -
            Number(product.price)) /
          Number(product.originalPrice)
        ) * 100;
    }

    // Always preserve the exact affiliate link supplied by the user.
    product.platform = 'mercadolivre';
    product.affiliateLink = inputUrl;

    return product;
  }

  if (marketplace === 'shein') {
    // A SHEIN exige que o link com comissão venha do Centro de Afiliados. Não convertemos link comum automaticamente.
    return { platform: 'shein', name: 'Produto SHEIN', canonicalUrl: inputUrl, affiliateLink: inputUrl, imageUrl: null, price: 0, rating: 0, sales: 0, score: 0, manualAffiliateRequired: true };
  }

  return { platform: 'generic', name: 'Produto', canonicalUrl: inputUrl, affiliateLink: inputUrl, imageUrl: null, price: 0, rating: 0, sales: 0, score: 0 };
}

export async function searchMarketplace(platform, keyword, limit = 5) {
  if (platform === 'shopee') return searchShopeeOffers(keyword, { limit, sortType: 5 });
  if (platform === 'amazon') return searchAmazon(keyword, limit);
  if (platform === 'mercadolivre') return searchMeli(keyword, limit);
  throw new Error('Busca automática não disponível para essa plataforma.');
}
