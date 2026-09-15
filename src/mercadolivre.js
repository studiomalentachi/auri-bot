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
  const url = new URL(
    'https://api.mercadolibre.com/sites/MLB/search'
  );

  url.searchParams.set('q', keyword);
  url.searchParams.set(
    'limit',
    String(Math.min(20, Math.max(1, limit)))
  );

  const res = await fetch(
    url,
    { headers: await authHeaders() }
  );

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      json?.message || `Mercado Livre HTTP ${res.status}`
    );
  }

  return (json.results || []).map((x) => ({
    platform: 'mercadolivre',
    itemId: x.id,
    name: x.title || '',
    imageUrl: x.thumbnail || null,
    price: Number(x.price || 0),
    canonicalUrl: x.permalink || '',
    affiliateLink: null,
    sales: Number(x.sold_quantity || 0),
    rating: 0,
    discountPct: 0,
    score: 50
  }));
}
