import fs from 'node:fs';
import path from 'node:path';

function tokenFile() {
  const base = process.env.PERSIST_DIR
    ? path.resolve(process.env.PERSIST_DIR)
    : path.resolve('data');

  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'meli_tokens.json');
}

function readTokens() {
  try {
    const file = tokenFile();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveTokens(data) {
  const current = readTokens();
  const expiresIn = Number(data.expires_in || data.expiresIn || 0);

  const next = {
    ...current,
    ...data,
    access_token: data.access_token || current.access_token || '',
    refresh_token: data.refresh_token || current.refresh_token || '',
    expires_at:
      expiresIn > 0
        ? Date.now() + expiresIn * 1000
        : Number(data.expires_at || current.expires_at || 0),
    saved_at: new Date().toISOString()
  };

  fs.writeFileSync(tokenFile(), JSON.stringify(next, null, 2));
  return next;
}

function requireOAuthConfig() {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  const redirectUri = process.env.MELI_REDIRECT_URI;

  if (!clientId) throw new Error('MELI_CLIENT_ID não configurado.');
  if (!clientSecret) throw new Error('MELI_CLIENT_SECRET não configurado.');
  if (!redirectUri) throw new Error('MELI_REDIRECT_URI não configurado.');

  return { clientId, clientSecret, redirectUri };
}

export function meliOAuthStatus() {
  const tokens = readTokens();

  return {
    configured: Boolean(
      process.env.MELI_CLIENT_ID &&
      process.env.MELI_CLIENT_SECRET &&
      process.env.MELI_REDIRECT_URI
    ),
    authorized: Boolean(
      tokens.access_token || process.env.MELI_ACCESS_TOKEN
    ),
    hasRefreshToken: Boolean(tokens.refresh_token)
  };
}

export function buildMeliAuthorizationUrl(state) {
  const { clientId, redirectUri } = requireOAuthConfig();

  const url = new URL(
    'https://auth.mercadolivre.com.br/authorization'
  );

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);

  if (state) {
    url.searchParams.set('state', state);
  }

  return url.toString();
}

async function requestToken(params) {
  const res = await fetch(
    'https://api.mercadolibre.com/oauth/token',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params).toString()
    }
  );

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      json?.message ||
      json?.error_description ||
      json?.error ||
      `Mercado Livre OAuth HTTP ${res.status}`
    );
  }

  return json;
}

export async function exchangeMeliAuthorizationCode(code) {
  const {
    clientId,
    clientSecret,
    redirectUri
  } = requireOAuthConfig();

  const json = await requestToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: String(code || '').trim(),
    redirect_uri: redirectUri
  });

  return saveTokens(json);
}

export async function refreshMeliAccessToken() {
  const {
    clientId,
    clientSecret
  } = requireOAuthConfig();

  const current = readTokens();

  if (!current.refresh_token) {
    throw new Error(
      'Refresh Token do Mercado Livre não encontrado.'
    );
  }

  const json = await requestToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: current.refresh_token
  });

  return saveTokens(json);
}

export async function getMeliAccessToken() {
  const current = readTokens();

  if (current.access_token) {
    const expiresAt = Number(current.expires_at || 0);

    if (
      !expiresAt ||
      expiresAt > Date.now() + 5 * 60 * 1000
    ) {
      return current.access_token;
    }

    if (current.refresh_token) {
      const renewed = await refreshMeliAccessToken();
      return renewed.access_token || '';
    }
  }

  return process.env.MELI_ACCESS_TOKEN || '';
}

async function authHeaders() {
  try {
    const token = await getMeliAccessToken();

    return token
      ? { Authorization: `Bearer ${token}` }
      : {};
  } catch {
    return {};
  }
}

export function parseMeliItemId(url) {
  const s = String(url || '');
  const m = s.match(/MLB[-_]?([0-9]{6,})/i);
  return m ? `MLB${m[1]}` : null;
}

export async function getMeliProduct(itemId) {
  const res = await fetch(
    `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`,
    { headers: await authHeaders() }
  );

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      json?.message || `Mercado Livre HTTP ${res.status}`
    );
  }

  return {
    platform: 'mercadolivre',
    itemId: json.id,
    name: json.title || '',
    imageUrl:
      json.pictures?.[0]?.secure_url ||
      json.secure_thumbnail ||
      json.thumbnail?.replace('http://', 'https://') ||
      null,
    price: Number(json.price || json.base_price || 0),
    canonicalUrl: json.permalink || '',
    affiliateLink: null,
    sales: Number(json.sold_quantity || 0),
    rating: 0,
    discountPct: 0,
    score: 50
  };
}

export async function searchMeli(keyword, limit = 5) {
  const auth = await authHeaders();

  if (!auth.Authorization) {
    throw new Error(
      'Mercado Livre: Access Token não disponível. Autorize novamente com /meli.'
    );
  }

  const term = String(keyword || '').trim();

  if (!term) {
    throw new Error('Digite o nome do produto que quer procurar.');
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: auth });
    const json = await res.json().catch(() => ({}));

    return {
      ok: res.ok,
      status: res.status,
      json
    };
  }

  // 1) Descobrir as categorias mais prováveis para o termo digitado.
  const predictorUrl = new URL(
    'https://api.mercadolibre.com/sites/MLB/domain_discovery/search'
  );
  predictorUrl.searchParams.set('limit', '3');
  predictorUrl.searchParams.set('q', term);

  const predictor = await fetchJson(predictorUrl);

  if (!predictor.ok) {
    const detail =
      predictor.json?.message ||
      predictor.json?.error_description ||
      predictor.json?.error ||
      'erro sem detalhes';

    throw new Error(
      `Mercado Livre ${predictor.status}: ${detail}`
    );
  }

  const predictions = Array.isArray(predictor.json)
    ? predictor.json
    : [];

  if (!predictions.length) {
    throw new Error(
      'O Mercado Livre não conseguiu identificar uma categoria para essa busca.'
    );
  }

  // 2) Buscar os mais vendidos das categorias previstas.
  const highlights = [];

  for (const prediction of predictions) {
    const categoryId = prediction?.category_id;

    if (!categoryId) continue;

    const result = await fetchJson(
      `https://api.mercadolibre.com/highlights/MLB/category/${encodeURIComponent(categoryId)}`
    );

    if (!result.ok) {
      // Algumas categorias não possuem ranking; apenas tenta a próxima.
      continue;
    }

    const content = Array.isArray(result.json?.content)
      ? result.json.content
      : [];

    for (const hit of content) {
      highlights.push({
        ...hit,
        categoryId,
        categoryName:
          prediction?.category_name ||
          result.json?.query_data?.id ||
          categoryId
      });
    }

    // Não precisamos consultar muitas categorias se já temos variedade suficiente.
    if (highlights.length >= Math.max(12, Number(limit) * 2)) {
      break;
    }
  }

  if (!highlights.length) {
    throw new Error(
      'Encontrei a categoria, mas ela não possui ranking de mais vendidos disponível no Mercado Livre.'
    );
  }

  async function itemFromId(itemId, meta = {}) {
    try {
      const product = await getMeliProduct(itemId);

      if (
        !product ||
        !product.name ||
        !product.canonicalUrl ||
        Number(product.price || 0) <= 0
      ) {
        return null;
      }

      return {
        ...product,
        highlightPosition: Number(meta.position || 0),
        highlightType: meta.type || 'ITEM',
        categoryId: meta.categoryId || null,
        categoryName: meta.categoryName || null,
        score: Math.max(
          50,
          100 - Number(meta.position || 50)
        )
      };
    } catch {
      return null;
    }
  }

  async function resolveHighlight(hit) {
    const type = String(hit?.type || '').toUpperCase();
    const id = hit?.id;

    if (!id) return null;

    // Ranking já devolveu uma publicação.
    if (type === 'ITEM') {
      return itemFromId(id, hit);
    }

    // Ranking devolveu um produto de catálogo:
    // procura uma publicação comprável que compete nessa PDP.
    if (type === 'PRODUCT') {
      const items = await fetchJson(
        `https://api.mercadolibre.com/products/${encodeURIComponent(id)}/items`
      );

      if (!items.ok) return null;

      const rows = Array.isArray(items.json?.results)
        ? items.json.results
        : [];

      const listing =
        rows.find(
          (x) =>
            x?.item_id &&
            Number(x?.price || 0) > 0
        ) ||
        rows.find((x) => x?.item_id) ||
        null;

      if (!listing?.item_id) return null;

      return itemFromId(listing.item_id, hit);
    }

    // Ranking novo pode devolver USER_PRODUCT.
    // Tentamos descobrir uma condição de venda ativa associada a ele.
    if (type === 'USER_PRODUCT') {
      const up = await fetchJson(
        `https://api.mercadolibre.com/user-products/${encodeURIComponent(id)}`
      );

      if (!up.ok) return null;

      const sellerId =
        up.json?.seller_id ||
        up.json?.user_id ||
        up.json?.seller?.id ||
        null;

      if (!sellerId) return null;

      const itemsUrl = new URL(
        `https://api.mercadolibre.com/users/${encodeURIComponent(sellerId)}/items/search`
      );
      itemsUrl.searchParams.set('user_product_id', id);
      itemsUrl.searchParams.set('status', 'active');

      const items = await fetchJson(itemsUrl);

      if (!items.ok) return null;

      const ids = Array.isArray(items.json?.results)
        ? items.json.results
        : [];

      if (!ids.length) return null;

      return itemFromId(ids[0], hit);
    }

    return null;
  }

  // Resolver mais candidatos do que o necessário porque alguns tipos podem
  // não estar acessíveis para uma conta de afiliada.
  const uniqueHighlights = [];
  const seenHighlightIds = new Set();

  for (const hit of highlights) {
    const key = `${hit.type}:${hit.id}`;

    if (!hit.id || seenHighlightIds.has(key)) continue;

    seenHighlightIds.add(key);
    uniqueHighlights.push(hit);

    if (uniqueHighlights.length >= 20) break;
  }

  const settled = await Promise.allSettled(
    uniqueHighlights.map(resolveHighlight)
  );

  const products = [];
  const seenItems = new Set();

  for (const entry of settled) {
    if (
      entry.status !== 'fulfilled' ||
      !entry.value ||
      !entry.value.itemId
    ) {
      continue;
    }

    if (seenItems.has(entry.value.itemId)) continue;

    seenItems.add(entry.value.itemId);
    products.push(entry.value);

    if (products.length >= Math.max(1, Number(limit) || 5)) {
      break;
    }
  }

  if (!products.length) {
    throw new Error(
      'Encontrei os mais vendidos da categoria, mas o Mercado Livre não liberou anúncios compráveis desses resultados para esta integração.'
    );
  }

  return products;
}
