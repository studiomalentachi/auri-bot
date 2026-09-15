import crypto from 'node:crypto';
import { config } from './config.js';
import { generateOfferCopy } from './ai.js';
import { generateShopeeShortLink, isShopeeConfigured, searchShopeeOffers } from './shopee.js';
import { enqueue, isDuplicate, readStore, updateStore } from './store.js';

function pickKeyword() {
  const s = readStore();
  const lastIndex = Number(s.discoveryKeywordIndex || 0);
  const list = config.discoveryKeywords.length ? config.discoveryKeywords : ['achadinhos'];
  const idx = lastIndex % list.length;
  updateStore(x => { x.discoveryKeywordIndex = idx + 1; return x; });
  return list[idx];
}

export async function discoverShopeeOffers({ force = false } = {}) {
  const s = readStore();
  if (!isShopeeConfigured()) throw new Error('Configure SHOPEE_AFFILIATE_APP_ID e SHOPEE_AFFILIATE_SECRET no Railway.');
  if (!force && !s.autoDiscovery) return [];
  const keyword = pickKeyword();
  const found = await searchShopeeOffers(keyword, { limit: 20, sortType: 5 });
  const filtered = found
    .filter(p => p.score >= config.discoveryMinScore)
    .filter(p => !isDuplicate(p, p.affiliateLink || p.productLink))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.discoveryMaxPerRun);

  const suggestions = [];
  for (const product of filtered) {
    try {
      product.affiliateLink = await generateShopeeShortLink(product.productLink, ['whatsapp', 'auri', keyword.slice(0, 20)]);
    } catch {}
    const copy = await generateOfferCopy(product, `Encontrado automaticamente na busca \"${keyword}\".`);
    const item = {
      id: crypto.randomBytes(3).toString('hex'),
      text: copy.text,
      link: product.affiliateLink || product.offerLink || product.productLink,
      photoPath: null,
      product,
      aiGenerated: true,
      aiProvider: copy.provider,
      source: 'auto-discovery',
      keyword,
      createdAt: new Date().toISOString()
    };
    suggestions.push(item);
    if (s.autoQueueDiscovery) enqueue(item);
  }

  updateStore(x => {
    if (!s.autoQueueDiscovery) x.suggestions = [...suggestions, ...(x.suggestions || [])].slice(0, 30);
    x.lastDiscoveryAt = new Date().toISOString();
    x.metrics.discoveryRuns += 1;
    return x;
  });
  return suggestions;
}
