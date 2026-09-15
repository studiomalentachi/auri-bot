import aws4 from 'aws4';

export function isAmazonConfigured() {
  return Boolean(process.env.AMAZON_ACCESS_KEY && process.env.AMAZON_SECRET_KEY && process.env.AMAZON_PARTNER_TAG);
}

export function addAmazonAffiliateTag(url) {
  if (!process.env.AMAZON_PARTNER_TAG) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('tag', process.env.AMAZON_PARTNER_TAG);
    return u.toString();
  } catch { return url; }
}

async function paapi(path, target, body) {
  if (!isAmazonConfigured()) throw new Error('Amazon PA-API ainda não configurada.');
  const host = process.env.AMAZON_HOST || 'webservices.amazon.com.br';
  const region = process.env.AMAZON_REGION || 'us-east-1';
  const payload = JSON.stringify(body);
  const request = {
    host, path, service: 'ProductAdvertisingAPI', region, method: 'POST', body: payload,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'content-encoding': 'amz-1.0',
      'x-amz-target': target,
      'host': host
    }
  };
  aws4.sign(request, { accessKeyId: process.env.AMAZON_ACCESS_KEY, secretAccessKey: process.env.AMAZON_SECRET_KEY });
  const res = await fetch(`https://${host}${path}`, { method: 'POST', headers: request.headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.Errors?.[0]?.Message || `Amazon HTTP ${res.status}`);
  return json;
}

export async function searchAmazon(keyword, limit = 5) {
  const json = await paapi('/paapi5/searchitems', 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems', {
    Keywords: keyword,
    PartnerTag: process.env.AMAZON_PARTNER_TAG,
    PartnerType: 'Associates',
    Marketplace: 'www.amazon.com.br',
    ItemCount: Math.min(10, Math.max(1, limit)),
    Resources: ['Images.Primary.Medium', 'ItemInfo.Title', 'Offers.Listings.Price', 'Offers.Listings.SavingBasis', 'CustomerReviews.StarRating']
  });
  return (json?.SearchResult?.Items || []).map(item => ({
    platform: 'amazon',
    itemId: item.ASIN,
    name: item?.ItemInfo?.Title?.DisplayValue || '',
    imageUrl: item?.Images?.Primary?.Medium?.URL || null,
    price: Number(item?.Offers?.Listings?.[0]?.Price?.Amount || 0),
    rating: Number(item?.CustomerReviews?.StarRating || 0),
    canonicalUrl: item.DetailPageURL,
    affiliateLink: item.DetailPageURL,
    sales: 0,
    discountPct: 0,
    score: 50
  }));
}
