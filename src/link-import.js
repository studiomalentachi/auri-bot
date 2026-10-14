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
    product = await importProductFromUrl(exact);
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
