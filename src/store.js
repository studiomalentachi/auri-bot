import fs from 'node:fs';
import path from 'node:path';

const baseDir = process.env.PERSIST_DIR
  ? path.resolve(process.env.PERSIST_DIR)
  : path.resolve('.');

const dataDir = path.join(baseDir, 'data');
const storePath = path.join(dataDir, 'store.json');

const defaults = {
  queue: [],
  paused: false,
  targetGroupJid: null,
  targetGroupName: null,
  targetGroups: [],
  history: [],
  suggestions: [],
  autoDiscovery: false,
  autoQueueDiscovery: false,
  aiProvider: 'auto',
  safeCouponsOnly: true,
  lastTrendsSentDate: null,
  dailyTrendTerms: {
    date: null,
    terms: [],
    updatedAt: null
  },
  discoverySeenProducts: [],
  enabledMarketplaces: [
    'shopee',
    'shein',
    'mercadolivre'
  ],
  customMarketplaces: [],
  searchFilters: {
    minSales: 50,
    resultLimit: 20,
    broadSearch: true,
    sortBy: 'sales'
  },
  lastDiscoveryAt: null,
  metrics: {
    sentOffers: 0,
    sentMessages: 0,
    blockedDuplicates: 0,
    blockedCoupons: 0,
    discoveryRuns: 0
  }
};

function ensure() {
  fs.mkdirSync(
    dataDir,
    { recursive: true }
  );

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        defaults,
        null,
        2
      )
    );
  }
}

function migrate(s) {
  const out = {
    ...defaults,
    ...s
  };

  out.metrics = {
    ...defaults.metrics,
    ...(s?.metrics || {})
  };

  if (!Array.isArray(out.queue)) {
    out.queue = [];
  }

  if (!Array.isArray(out.history)) {
    out.history = [];
  }

  if (!Array.isArray(out.discoverySeenProducts)) {
    out.discoverySeenProducts = [];
  }

  // Guarda uma memória longa dos produtos que a Auto busca já mostrou.
  // Isso evita que o mesmo item volte mesmo se ele tiver sido ignorado.
  out.discoverySeenProducts =
    out.discoverySeenProducts
      .filter(
        (x) =>
          x &&
          (x.key || x.titleKey)
      )
      .slice(0, 5000);

  if (
    !out.dailyTrendTerms ||
    typeof out.dailyTrendTerms !== 'object'
  ) {
    out.dailyTrendTerms = {
      date: null,
      terms: [],
      updatedAt: null
    };
  }

  if (
    !Array.isArray(
      out.dailyTrendTerms.terms
    )
  ) {
    out.dailyTrendTerms.terms = [];
  }

  if (!Array.isArray(out.suggestions)) {
    out.suggestions = [];
  }

  if (!Array.isArray(out.targetGroups)) {
    out.targetGroups = [];
  }

  if (!Array.isArray(out.customMarketplaces)) {
    out.customMarketplaces = [];
  }

  out.customMarketplaces =
    out.customMarketplaces
      .filter(
        (x) =>
          x &&
          x.id &&
          x.name &&
          x.domain
      )
      .map(
        (x) => ({
          id: String(x.id),
          name: String(x.name),
          domain: String(x.domain)
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0],
          autoSearch: false
        })
      );

  if (!Array.isArray(out.enabledMarketplaces)) {
    out.enabledMarketplaces = [
      ...defaults.enabledMarketplaces
    ];
  }

  const allowedMarketplaceIds =
    new Set([
      'shopee',
      'shein',
      'mercadolivre',
      'amazon',
      ...out.customMarketplaces.map(
        (x) => x.id
      )
    ]);

  out.enabledMarketplaces = [
    ...new Set(
      out.enabledMarketplaces.filter(
        (x) =>
          allowedMarketplaceIds.has(x)
      )
    )
  ];

  out.searchFilters = {
    ...defaults.searchFilters,
    ...(s?.searchFilters || {})
  };

  out.searchFilters.minSales =
    Math.max(
      50,
      Number(
        out.searchFilters.minSales ||
        50
      )
    );

  out.searchFilters.resultLimit =
    Math.max(
      5,
      Math.min(
        20,
        Number(
          out.searchFilters.resultLimit ||
          20
        )
      )
    );

  out.searchFilters.broadSearch =
    out.searchFilters.broadSearch !== false;

  if (
    ![
      'sales',
      'discount',
      'rating',
      'balanced'
    ].includes(
      out.searchFilters.sortBy
    )
  ) {
    out.searchFilters.sortBy =
      'sales';
  }

  // Migração da versão antiga, que tinha só um grupo.
  if (
    !out.targetGroups.length &&
    out.targetGroupJid
  ) {
    out.targetGroups = [
      {
        jid:
          out.targetGroupJid,
        name:
          out.targetGroupName ||
          'Grupo'
      }
    ];
  }

  // mantém compatibilidade com scheduler antigo
  if (out.targetGroups.length) {
    out.targetGroupJid =
      out.targetGroups[0].jid;

    out.targetGroupName =
      out.targetGroups[0].name;
  }

  return out;
}

export function readStore() {
  ensure();

  try {
    return migrate(
      JSON.parse(
        fs.readFileSync(
          storePath,
          'utf8'
        )
      )
    );
  } catch {
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        defaults,
        null,
        2
      )
    );

    return structuredClone(
      defaults
    );
  }
}

export function writeStore(store) {
  ensure();

  fs.writeFileSync(
    storePath,
    JSON.stringify(
      migrate(store),
      null,
      2
    )
  );
}

export function updateStore(fn) {
  const current =
    readStore();

  const next =
    fn(current) ||
    current;

  writeStore(next);

  return next;
}

export function enqueue(item) {
  updateStore((s) => {
    s.queue.push({
      ...item,
      createdAt:
        item.createdAt ||
        new Date().toISOString()
    });

    return s;
  });
}

export function removeFromQueue(id) {
  updateStore((s) => {
    s.queue =
      s.queue.filter(
        (x) =>
          String(x.id) !==
          String(id)
      );

    return s;
  });
}

export function productKey(
  product = {},
  link = ''
) {
  if (
    product.platform &&
    product.itemId
  ) {
    return `${product.platform}:${product.itemId}`;
  }

  const raw =
    String(
      product.canonicalUrl ||
      link ||
      product.url ||
      ''
    )
      .trim()
      .toLowerCase();

  return raw
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

export function isDuplicate(
  product,
  link,
  days = 30
) {
  const key =
    productKey(
      product,
      link
    );

  if (!key) {
    return false;
  }

  const cutoff =
    Date.now() -
    days * 86400000;

  const s =
    readStore();

  const queued =
    s.queue.some(
      (x) =>
        productKey(
          x.product,
          x.link
        ) === key
    );

  const recent =
    s.history.some(
      (x) =>
        x.key === key &&
        new Date(
          x.sentAt
        ).getTime() >= cutoff
    );

  return queued || recent;
}

export function markSent(item) {
  updateStore((s) => {
    const key =
      productKey(
        item.product,
        item.link
      );

    s.history.unshift({
      key,
      itemId: item.id,
      title:
        item.product?.name ||
        (item.text || '')
          .split('\n')[0],
      platform:
        item.product?.platform ||
        'manual',
      sentAt:
        new Date().toISOString()
    });

    s.history =
      s.history.slice(
        0,
        1000
      );

    s.metrics.sentOffers += 1;

    return s;
  });
}

export function setTargetGroups(groups) {
  updateStore((s) => {
    s.targetGroups = groups;

    s.targetGroupJid =
      groups[0]?.jid ||
      null;

    s.targetGroupName =
      groups[0]?.name ||
      null;

    return s;
  });
}
