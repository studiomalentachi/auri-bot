import { generateShopeeShortLink, getShopeeProduct, isShopeeConfigured, parseShopeeIds, searchShopeeOffers } from './shopee.js';
import { addAmazonAffiliateTag, searchAmazon } from './amazon.js';
import { getMeliProduct, parseMeliItemId, searchMeli } from './mercadolivre.js';

export function detectMarketplace(url) {
  const s = String(url || '').toLowerCase();
  if (s.includes('shopee.')) return 'shopee';
  if (s.includes('shein.')) return 'shein';
  if (s.includes('amazon.')) return 'amazon';
  if (s.includes('mercadolivre.') || s.includes('mercadolibre.')) return 'mercadolivre';
  return 'generic';
}

async function resolveRedirect(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 AuriBot/4.0' } });
    clearTimeout(t);
    return res.url || url;
  } catch { return url; }
}

export async function importProductFromUrl(inputUrl) {
  const marketplace = detectMarketplace(inputUrl);
  let url = inputUrl;
  if (marketplace === 'shopee') url = await resolveRedirect(inputUrl);

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
    const id = parseMeliItemId(inputUrl);
    if (id) {
      const product = await getMeliProduct(id).catch(() => null);
      if (product) {
        // O Mercado Livre não oferece link de afiliado público via API oficial; preserve o link que a usuária colou.
        product.affiliateLink = inputUrl;
        return product;
      }
    }
    return { platform: 'mercadolivre', name: 'Produto Mercado Livre', canonicalUrl: inputUrl, affiliateLink: inputUrl, imageUrl: null, price: 0, rating: 0, sales: 0, score: 0 };
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
