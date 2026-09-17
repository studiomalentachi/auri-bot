import crypto from 'node:crypto';

const endpoint = () => process.env.SHOPEE_AFFILIATE_ENDPOINT || 'https://open-api.affiliate.shopee.com.br/graphql';

export function isShopeeConfigured() {
  return Boolean(process.env.SHOPEE_AFFILIATE_APP_ID && process.env.SHOPEE_AFFILIATE_SECRET);
}

async function graphql(query, variables = {}) {
  if (!isShopeeConfigured()) throw new Error('Shopee Open API ainda não configurada.');
  const appId = String(process.env.SHOPEE_AFFILIATE_APP_ID);
  const secret = String(process.env.SHOPEE_AFFILIATE_SECRET);
  const payload = JSON.stringify({ query, variables });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHash('sha256').update(appId + timestamp + payload + secret).digest('hex');
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      'User-Agent': 'AuriBot/4.0'
    },
    body: payload
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopee HTTP ${res.status}`);
  if (json.errors?.length) {
    const e = json.errors[0];
    throw new Error(e?.extensions?.message || e?.message || 'Erro na Shopee Open API');
  }
  return json.data || {};
}

const fields = `
  itemId commissionRate sellerCommissionRate shopeeCommissionRate commission sales
  priceMax priceMin productCatIds ratingStar priceDiscountRate imageUrl productName
  shopId shopName shopType productLink offerLink periodStartTime periodEndTime
`;

export async function searchShopeeOffers(keyword, { page = 1, limit = 10, sortType = 5, itemId = null, shopId = null } = {}) {
  const query = `query ProductOffers($keyword:String,$page:Int,$limit:Int,$sortType:Int,$itemId:Int64,$shopId:Int64){
    productOfferV2(keyword:$keyword,page:$page,limit:$limit,sortType:$sortType,itemId:$itemId,shopId:$shopId){
      nodes { ${fields} }
      pageInfo { page limit hasNextPage }
    }
  }`;
  const vars = { keyword: keyword || null, page, limit, sortType, itemId, shopId };
  const data = await graphql(query, vars);
  return (data.productOfferV2?.nodes || []).map(normalizeShopeeProduct);
}

export async function getShopeeProduct({ itemId, shopId }) {
  const list = await searchShopeeOffers('', { itemId: Number(itemId), shopId: Number(shopId), limit: 10, sortType: 1 });
  return list.find(x => String(x.itemId) === String(itemId)) || list[0] || null;
}

export async function generateShopeeShortLink(originUrl, subIds = []) {
  const query = `mutation Short($input:ShortLinkInput!){ generateShortLink(input:$input){ shortLink } }`;
  const data = await graphql(query, { input: { originUrl, subIds: subIds.filter(Boolean).slice(0, 5) } });
  return data.generateShortLink?.shortLink || originUrl;
}

export async function getShopeeConversions(days = 7) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.max(1, days) * 86400;
  const limit = 50;

  // IMPORTANTE:
  // A API brasileira apresentou conflito no scalar dos timestamps quando
  // enviados como variáveis GraphQL (Int vs Int64 / "wrong type").
  // A documentação/exemplos oficiais usam os timestamps diretamente
  // nos argumentos da query. Fazemos o mesmo aqui.
  //
  // start/end/limit são calculados internamente como inteiros, então
  // não existe entrada do usuário sendo interpolada nesta query.
  const query = `query {
    conversionReport(
      purchaseTimeStart: ${start}
      purchaseTimeEnd: ${end}
      limit: ${limit}
    ) {
      nodes {
        purchaseTime
        conversionId
        totalCommission
        sellerCommission
        shopeeCommissionCapped
        buyerType
        device
        utmContent
        orders {
          orderId
          orderStatus
          items {
            itemId
            itemName
            shopName
            itemPrice
            qty
            itemTotalCommission
          }
        }
      }
      pageInfo {
        limit
        hasNextPage
        scrollId
      }
    }
  }`;

  const data = await graphql(query);
  return data.conversionReport?.nodes || [];
}

export function parseShopeeIds(url) {
  const u = String(url || '');
  let m = u.match(/\/product\/(\d+)\/(\d+)/i);
  if (m) return { shopId: m[1], itemId: m[2] };
  m = u.match(/-i\.(\d+)\.(\d+)/i);
  if (m) return { shopId: m[1], itemId: m[2] };
  const shop = u.match(/[?&]shopid=(\d+)/i)?.[1];
  const item = u.match(/[?&]itemid=(\d+)/i)?.[1];
  return shop && item ? { shopId: shop, itemId: item } : null;
}

export function opportunityScore(p) {
  const demand = Math.min(1, Math.log10((Number(p.sales) || 0) + 1) / 5);
  const payout = Math.min(1, ((Number(p.commissionRate) || 0) * 100) / 25);
  const quality = Math.min(1, (Number(p.rating) || 0) / 5);
  const deal = Math.min(1, (Number(p.discountPct) || 0) / 50);
  return Math.round(100 * (0.40 * demand + 0.35 * payout + 0.15 * quality + 0.10 * deal));
}

function normalizeShopeeProduct(n) {
  const out = {
    platform: 'shopee',
    itemId: String(n.itemId || ''),
    shopId: String(n.shopId || ''),
    name: n.productName || '',
    imageUrl: n.imageUrl || null,
    priceMin: Number(n.priceMin || 0),
    priceMax: Number(n.priceMax || 0),
    price: Number(n.priceMin || 0),
    discountPct: Number(n.priceDiscountRate || 0),
    sales: Number(n.sales || 0),
    rating: Number(n.ratingStar || 0),
    commissionRate: Number(n.commissionRate || 0),
    commission: Number(n.commission || 0),
    shopName: n.shopName || '',
    productLink: n.productLink || '',
    affiliateLink: n.offerLink || '',
    canonicalUrl: n.productLink || '',
    periodStartTime: n.periodStartTime || null,
    periodEndTime: n.periodEndTime || null
  };
  out.score = opportunityScore(out);
  return out;
}
