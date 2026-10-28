import { getStore } from '@netlify/blobs';

const BLOCKED = ['maternidade','bebê','bebe','gestante','gravidez','amamentação','amamentacao','pós-parto','pos-parto','enxoval','fralda','mamadeira','chupeta','berço','berco','trocador','recém-nascido','recem-nascido','carrinho de bebê','carrinho de bebe','bolsa maternidade','kit maternidade'];

export function defaults() {
  return {
    version: 3,
    settings: {
      timezone: 'America/Sao_Paulo',
      defaultMinInterval: 10,
      defaultMaxInterval: 15,
      defaultDailyLimit: 85,
      minimumConfirmedSales: 50,
      linkPreview: true,
      sendImages: false,
      safeCouponsOnly: true,
      blockedTerms: BLOCKED,
      workerOnline: false,
      workerLastSeenAt: null
    },
    marketplaces: [
      { id:'shopee', name:'Shopee', enabled:true, autoSearch:true, connected:false },
      { id:'mercadolivre', name:'Mercado Livre', enabled:true, autoSearch:true, connected:false },
      { id:'shein', name:'SHEIN', enabled:true, autoSearch:true, connected:false },
      { id:'tiktokshop', name:'TikTok Shop', enabled:true, autoSearch:false, connected:false }
    ],
    niches: [
      { id:'achadinhos', name:'Achadinhos', emoji:'✨', enabled:true, categories:['casa','cozinha','organização','beleza','moda','tecnologia','pets','papelaria','automotivo','fitness','viagem','utilidades'], minInterval:10, maxInterval:15, dailyLimit:85 },
      { id:'natal', name:'Natal', emoji:'🎄', enabled:true, categories:['decoração natalina','árvore de natal','iluminação natalina','presentes','mesa posta natalina'], minInterval:10, maxInterval:15, dailyLimit:60 }
    ],
    groups: [],
    campaigns: [],
    offers: [],
    queues: [],
    coupons: [],
    templates: [
      { id:'promos', name:'Promo padrão', text:'{{titulo}}\n\n{{produto}}\n\n{{de}}\n{{por}}\n{{desconto}}\n{{cupom}}\n{{nota}}\n\n🛍️ Compre aqui: {{link}}', active:true }
    ],
    history: []
  };
}

export async function readState() {
  const store = getStore('auri-data');
  const data = await store.get('state', { type: 'json' }).catch(() => null);
  return data && typeof data === 'object' ? { ...defaults(), ...data } : defaults();
}

export async function writeState(state) {
  const store = getStore('auri-data');
  await store.setJSON('state', state);
  return state;
}

export function id(prefix='id') { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
export function nowIso() { return new Date().toISOString(); }
export function blockedProduct(value, terms=BLOCKED) {
  const s = String(value || '').toLowerCase();
  return terms.some(t => s.includes(String(t).toLowerCase()));
}
export function randomMinutes(min,max) {
  min = Math.max(1, Number(min)||10); max = Math.max(min, Number(max)||15);
  return Math.floor(Math.random()*(max-min+1))+min;
}
