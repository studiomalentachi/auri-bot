const authHeaders = () => process.env.MELI_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.MELI_ACCESS_TOKEN}` } : {};

export function parseMeliItemId(url) {
  const s = String(url || '');
  const m = s.match(/MLB[-_]?([0-9]{6,})/i);
  return m ? `MLB${m[1]}` : null;
}

export async function getMeliProduct(itemId) {
  const res = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, { headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Mercado Livre HTTP ${res.status}`);
  return {
    platform: 'mercadolivre', itemId: json.id, name: json.title || '',
    imageUrl: json.pictures?.[0]?.secure_url || json.secure_thumbnail || json.thumbnail?.replace('http://', 'https://') || null,
    price: Number(json.price || json.base_price || 0),
    canonicalUrl: json.permalink || '', affiliateLink: null,
    sales: Number(json.sold_quantity || 0), rating: 0, discountPct: 0, score: 50
  };
}

export async function searchMeli(keyword, limit = 5) {
  const url = new URL('https://api.mercadolibre.com/sites/MLB/search');
  url.searchParams.set('q', keyword);
  url.searchParams.set('limit', String(Math.min(20, Math.max(1, limit))));
  const res = await fetch(url, { headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Mercado Livre HTTP ${res.status}`);
  return (json.results || []).map(x => ({
    platform: 'mercadolivre', itemId: x.id, name: x.title || '', imageUrl: x.thumbnail || null,
    price: Number(x.price || 0), canonicalUrl: x.permalink || '', affiliateLink: null,
    sales: Number(x.sold_quantity || 0), rating: 0, discountPct: 0, score: 50
  }));
}
