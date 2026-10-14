import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  readStore,
  updateStore,
  setTargetGroups,
  productKey,
  isDuplicate
} from './store.js';

import {
  isWhatsAppConnected,
  listWhatsAppGroups,
  requestWhatsAppPairingCode,
  formatOfferMessage
} from './whatsapp.js';

import {
  discoverWebOffers,
  searchSheinOffers
} from './discovery.js';

import {
  searchShopeeOffersBroad
} from './shopee.js';

import {
  searchMarketplace
} from './marketplaces.js';

import {
  generateOfferCopy
} from './ai.js';

import {
  sendOneNow
} from './scheduler.js';

import {
  importAffiliateProductLink
} from './link-import.js';

import {
  sendOfferQueueNow
} from './divulgador.js';

import {
  buildTrendDigest
} from './trends.js';

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const publicDir =
  path.resolve(
    __dirname,
    '../public'
  );

const PORT =
  Number(
    process.env.PORT ||
    process.env.DASHBOARD_PORT ||
    3000
  );

const DASHBOARD_PASSWORD =
  String(
    process.env.DASHBOARD_PASSWORD ||
    process.env.AURI_PANEL_PASSWORD ||
    ''
  );

const MATERNITY =
  /\b(beb[eê]|bebes|bebês|maternidade|gestante|gestação|gestacao|gr[aá]vida|gravidez|amamenta(?:ção|cao)|aleitamento|p[oó]s[- ]?parto|pos[- ]?parto|enxoval|fralda|mamadeira|chupeta|berço|berco|trocador|rec[eé]m[- ]?nascido|recem[- ]?nascido|carrinho\s+de\s+beb[eê]|bolsa\s+maternidade|kit\s+maternidade)\b/i;

function json(
  res,
  status,
  data
) {
  const body =
    JSON.stringify(
      data
    );

  res.writeHead(
    status,
    {
      'content-type':
        'application/json; charset=utf-8',
      'cache-control':
        'no-store'
    }
  );

  res.end(body);
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function authOk(req) {
  if (
    !DASHBOARD_PASSWORD
  ) {
    return false;
  }

  const value =
    String(
      req.headers[
        'x-auri-key'
      ] ||
      ''
    );

  return crypto.timingSafeEqual(
    Buffer.from(
      value.padEnd(
        Math.max(
          value.length,
          DASHBOARD_PASSWORD.length
        ),
        '\0'
      )
    ),
    Buffer.from(
      DASHBOARD_PASSWORD.padEnd(
        Math.max(
          value.length,
          DASHBOARD_PASSWORD.length
        ),
        '\0'
      )
    )
  );
}

async function readJson(
  req,
  limit =
    2 * 1024 * 1024
) {
  let raw = '';

  for await (
    const chunk of req
  ) {
    raw += chunk;

    if (
      Buffer.byteLength(
        raw
      ) > limit
    ) {
      throw new Error(
        'Corpo muito grande.'
      );
    }
  }

  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw);
}

function moneyNumber(value) {
  if (
    typeof value ===
    'number'
  ) {
    return value;
  }

  const raw =
    String(
      value || ''
    )
      .trim()
      .replace(
        /R\$/gi,
        ''
      )
      .replace(
        /\s/g,
        ''
      );

  if (!raw) {
    return 0;
  }

  let normalized =
    raw;

  if (
    raw.includes(',') &&
    raw.includes('.')
  ) {
    normalized =
      raw.replace(
        /\./g,
        ''
      ).replace(
        ',',
        '.'
      );
  } else if (
    raw.includes(',')
  ) {
    normalized =
      raw.replace(
        ',',
        '.'
      );
  }

  const n =
    Number(
      normalized.replace(
        /[^0-9.-]/g,
        ''
      )
    );

  return Number.isFinite(n)
    ? n
    : 0;
}

function sanitizedState() {
  const s =
    readStore();

  return {
    queue:
      s.queue || [],
    suggestions:
      s.suggestions || [],
    history:
      (s.history || [])
        .slice(0, 150),
    paused:
      Boolean(
        s.paused
      ),
    autoDiscovery:
      Boolean(
        s.autoDiscovery
      ),
    autoQueueDiscovery:
      Boolean(
        s.autoQueueDiscovery
      ),
    enabledMarketplaces:
      s.enabledMarketplaces ||
      [],
    searchFilters:
      s.searchFilters ||
      {},
    dashboardSettings:
      s.dashboardSettings ||
      {},
    offerQueues:
      s.offerQueues ||
      [],
    divulgador:
      s.divulgador ||
      {},
    divulgadorLog:
      (s.divulgadorLog || []).slice(0, 120),
    targetGroups:
      s.targetGroups ||
      [],
    dailyTrendTerms:
      s.dailyTrendTerms ||
      {
        date: null,
        terms: []
      },
    lastDiscoveryAt:
      s.lastDiscoveryAt ||
      null,
    metrics:
      s.metrics ||
      {},
    whatsappConnected:
      isWhatsAppConnected(),
    passwordConfigured:
      Boolean(
        DASHBOARD_PASSWORD
      )
  };
}

function itemFromState(
  kind,
  index
) {
  const s =
    readStore();

  const list =
    kind === 'queue'
      ? s.queue
      : s.suggestions;

  return {
    store:
      s,
    list,
    item:
      list?.[
        Number(index)
      ] ||
      null
  };
}

async function rebuildText(
  item
) {
  const product =
    item.product ||
    {};

  const copy =
    await generateOfferCopy(
      product,
      'Atualização feita no painel web da Auri.'
    );

  let text =
    copy.text;

  const custom =
    String(
      product.customTitle ||
      ''
    ).trim();

  if (custom) {
    const lines =
      String(
        text || ''
      ).split('\n');

    const first =
      lines.findIndex(
        (x) =>
          x.trim()
      );

    if (
      first >= 0
    ) {
      lines[first] =
        custom;

      text =
        lines.join('\n');
    }
  }

  item.text =
    text;
  item.aiProvider =
    copy.provider;
  item.aiGenerated =
    true;

  return item;
}

function applyFields(
  item,
  body
) {
  const product = {
    ...(item.product || {})
  };

  if (
    'title' in body
  ) {
    const title =
      String(
        body.title ||
        ''
      ).trim();

    if (title) {
      product.customTitle =
        title;
    } else {
      delete product.customTitle;
    }
  }

  if (
    'name' in body
  ) {
    product.name =
      String(
        body.name ||
        ''
      ).trim();

    product.nameManuallyConfirmed =
      true;
  }

  if (
    'oldPrice' in body
  ) {
    product.originalPrice =
      moneyNumber(
        body.oldPrice
      );

    product.originalPriceManuallyConfirmed =
      true;
  }

  if (
    'price' in body
  ) {
    const p =
      moneyNumber(
        body.price
      );

    product.price =
      p;
    product.priceMin =
      p;
    product.priceMax =
      p;
    product.priceManuallyConfirmed =
      true;
    product.manualPriceAt =
      new Date()
        .toISOString();
  }

  if (
    'discount' in body
  ) {
    product.discountPct =
      Math.max(
        0,
        Math.min(
          100,
          Number(
            body.discount ||
            0
          )
        )
      );

    product.discountManuallyConfirmed =
      true;
  } else if (
    (
      'oldPrice' in body ||
      'price' in body
    ) &&
    Number(
      product.originalPrice ||
      0
    ) >
      Number(
        product.price ||
        0
      ) &&
    Number(
      product.price ||
      0
    ) >
      0
  ) {
    product.discountPct =
      (
        (
          Number(
            product.originalPrice
          ) -
          Number(
            product.price
          )
        ) /
        Number(
          product.originalPrice
        )
      ) *
      100;
  }

  if (
    'rating' in body
  ) {
    product.rating =
      Math.max(
        0,
        Math.min(
          5,
          Number(
            body.rating ||
            0
          )
        )
      );

    product.ratingManuallyConfirmed =
      true;
  }

  if (
    'coupon' in body
  ) {
    const coupon =
      String(
        body.coupon ||
        ''
      ).trim();

    if (coupon) {
      product.couponCode =
        coupon;
      product.couponVerified =
        true;
    } else {
      delete product.couponCode;
      delete product.coupon;
      product.couponVerified =
        false;
    }
  }

  if (
    'imageUrl' in body
  ) {
    product.imageUrl =
      String(
        body.imageUrl ||
        ''
      ).trim() ||
      null;
  }

  if (
    'affiliateLink' in
    body
  ) {
    const link =
      String(
        body.affiliateLink ||
        ''
      ).trim();

    product.affiliateLink =
      link ||
      null;

    product.affiliateLinkVerified =
      Boolean(link);

    item.link =
      link ||
      item.link;
  }

  item.product =
    product;

  if (
    'text' in body
  ) {
    item.text =
      String(
        body.text ||
        ''
      ).trim();
  }

  return item;
}

function affiliateLinkFor(
  item
) {
  return String(
    item?.product
      ?.affiliateLink ||
    item?.link ||
    ''
  ).trim();
}

function hasSafeAffiliateLink(
  item
) {
  const affiliate =
    affiliateLinkFor(
      item
    );

  const publicLink =
    String(
      item?.product
        ?.publicLink ||
      item?.product
        ?.canonicalUrl ||
      item?.product
        ?.productLink ||
      ''
    ).trim();

  return Boolean(
    affiliate &&
    (
      !publicLink ||
      affiliate !==
        publicLink ||
      item?.product
        ?.affiliateLinkVerified ===
        true
    )
  );
}

function suggestedId() {
  return crypto
    .randomBytes(4)
    .toString('hex');
}

function isBlockedProduct(
  product
) {
  return MATERNITY.test(
    [
      product?.name,
      product?.shopName,
      product?.categoryName
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function normalizedWords(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(x => x.length >= 3);
}

function relevanceScore(product, keyword) {
  const wanted = normalizedWords(keyword);
  if (!wanted.length) return 1;
  const hay = normalizedWords([product?.name, product?.categoryName].filter(Boolean).join(' '));
  const hits = wanted.filter(x => hay.some(h => h === x || h.includes(x) || x.includes(h))).length;
  return hits / wanted.length;
}

async function manualSearch(
  keyword,
  platforms
) {
  const s =
    readStore();

  const filters =
    s.searchFilters ||
    {
      minSales: 50,
      resultLimit: 20,
      broadSearch: true,
      sortBy: 'sales'
    };

  const requested =
    (
      Array.isArray(
        platforms
      ) &&
      platforms.length
    )
      ? platforms
      : (
          s.enabledMarketplaces ||
          [
            'shopee',
            'mercadolivre',
            'shein'
          ]
        );

  const tasks = [];

  if (
    requested.includes(
      'shopee'
    )
  ) {
    tasks.push(
      searchShopeeOffersBroad(
        keyword,
        {
          minSales:
            filters.minSales,
          desired:
            filters.resultLimit,
          pages:
            filters.broadSearch
              ? 5
              : 2,
          limitPerPage:
            20,
          sortType:
            5,
          broadSearch:
            filters.broadSearch,
          sortBy:
            filters.sortBy
        }
      )
        .then(
          (rows) => ({
            platform:
              'shopee',
            rows
          })
        )
        .catch(
          (e) => ({
            platform:
              'shopee',
            rows: [],
            error:
              e.message
          })
        )
    );
  }

  if (
    requested.includes(
      'mercadolivre'
    )
  ) {
    tasks.push(
      searchMarketplace(
        'mercadolivre',
        keyword,
        filters.resultLimit
      )
        .then(
          (rows) => ({
            platform:
              'mercadolivre',
            rows
          })
        )
        .catch(
          (e) => ({
            platform:
              'mercadolivre',
            rows: [],
            error:
              e.message
          })
        )
    );
  }

  if (
    requested.includes(
      'shein'
    )
  ) {
    tasks.push(
      searchSheinOffers(
        keyword,
        filters.resultLimit
      )
        .then(
          (rows) => ({
            platform:
              'shein',
            rows
          })
        )
        .catch(
          (e) => ({
            platform:
              'shein',
            rows: [],
            error:
              e.message
          })
        )
    );
  }

  const results =
    await Promise.all(
      tasks
    );

  const buckets =
    Object.fromEntries(
      results.map((x) => {
        let rows = (x.rows || []).filter(
          (p) =>
            !isBlockedProduct(p) &&
            Number(p.sales || 0) >= Number(filters.minSales || 50) &&
            Number(p.price || 0) > 0
        );

        if (x.platform === 'mercadolivre') {
          rows = rows
            .map((p) => ({ ...p, searchRelevance: relevanceScore(p, keyword) }))
            .filter((p) => p.searchRelevance >= 0.5)
            .sort((a,b) =>
              Number(b.searchRelevance || 0) - Number(a.searchRelevance || 0) ||
              Number(b.sales || 0) - Number(a.sales || 0)
            );
        }

        return [x.platform, rows];
      })
    );

  const order = [
    'shopee',
    'mercadolivre',
    'shein'
  ];

  const interleaved = [];
  let progress = true;

  while (
    interleaved.length <
      Number(
        filters.resultLimit ||
        20
      ) &&
    progress
  ) {
    progress = false;

    for (
      const p of order
    ) {
      const row =
        buckets[p]
          ?.shift();

      if (row) {
        interleaved.push(
          row
        );
        progress = true;
      }

      if (
        interleaved.length >=
        Number(
          filters.resultLimit ||
          20
        )
      ) {
        break;
      }
    }
  }

  const suggestions = [];

  for (
    const product of
    interleaved
  ) {
    const link =
      product.affiliateLink ||
      product.offerLink ||
      product.publicLink ||
      product.canonicalUrl ||
      product.productLink ||
      '';

    if (
      isDuplicate(
        product,
        link,
        120
      )
    ) {
      continue;
    }

    const copy =
      await generateOfferCopy(
        product,
        'Produto encontrado pelo painel web da Auri.'
      );

    suggestions.push({
      id:
        suggestedId(),
      product,
      link,
      text:
        copy.text,
      aiProvider:
        copy.provider,
      aiGenerated:
        true,
      needsAffiliateLink:
        !hasSafeAffiliateLink({
          product,
          link
        }),
      createdAt:
        new Date()
          .toISOString()
    });
  }

  if (
    suggestions.length
  ) {
    updateStore((x) => {
      const existing =
        new Set(
          (
            x.suggestions ||
            []
          ).map(
            (item) =>
              productKey(
                item.product,
                item.link
              )
          )
        );

      const unique =
        suggestions.filter(
          (item) => {
            const key =
              productKey(
                item.product,
                item.link
              );

            if (
              !key ||
              existing.has(key)
            ) {
              return false;
            }

            existing.add(key);
            return true;
          }
        );

      x.suggestions = [
        ...unique,
        ...(x.suggestions || [])
      ].slice(
        0,
        250
      );

      return x;
    });
  }

  return {
    suggestions,
    errors:
      Object.fromEntries(
        results
          .filter(
            (x) =>
              x.error
          )
          .map(
            (x) => [
              x.platform,
              x.error
            ]
          )
      )
  };
}

async function itemFromImportedLink(inputUrl) {
  const product = await importAffiliateProductLink(inputUrl);
  const copy = await generateOfferCopy(
    product,
    'Produto reconhecido automaticamente pelo link de afiliada colado no painel.'
  );

  return {
    id: suggestedId(),
    product,
    link: inputUrl,
    text: copy.text,
    aiProvider: copy.provider,
    aiGenerated: true,
    autoQueued: false,
    importedByLink: true,
    createdAt: new Date().toISOString()
  };
}

function newQueueId() {
  return 'fila-' + crypto.randomBytes(4).toString('hex');
}

function contentType(
  filename
) {
  const ext =
    path.extname(
      filename
    ).toLowerCase();

  return {
    '.html':
      'text/html; charset=utf-8',
    '.js':
      'text/javascript; charset=utf-8',
    '.css':
      'text/css; charset=utf-8',
    '.svg':
      'image/svg+xml',
    '.png':
      'image/png',
    '.jpg':
      'image/jpeg',
    '.jpeg':
      'image/jpeg'
  }[ext] ||
    'application/octet-stream';
}

function serveStatic(
  req,
  res
) {
  let pathname =
    new URL(
      req.url,
      'http://localhost'
    ).pathname;

  if (
    pathname === '/'
  ) {
    pathname =
      '/index.html';
  }

  const file =
    path.resolve(
      publicDir,
      `.${pathname}`
    );

  if (
    !file.startsWith(
      publicDir
    ) ||
    !fs.existsSync(
      file
    ) ||
    !fs.statSync(
      file
    ).isFile()
  ) {
    res.writeHead(404);
    res.end(
      'Não encontrado'
    );
    return;
  }

  res.writeHead(
    200,
    {
      'content-type':
        contentType(file),
      'cache-control':
        pathname ===
          '/index.html'
          ? 'no-store'
          : 'public, max-age=300'
    }
  );

  fs.createReadStream(
    file
  ).pipe(res);
}

async function api(
  req,
  res,
  url
) {
  if (
    url.pathname ===
      '/api/health'
  ) {
    return json(
      res,
      200,
      {
        ok: true,
        passwordConfigured:
          Boolean(
            DASHBOARD_PASSWORD
          )
      }
    );
  }

  if (
    !authOk(req)
  ) {
    return json(
      res,
      401,
      {
        ok: false,
        error:
          DASHBOARD_PASSWORD
            ? 'Senha inválida.'
            : 'Configure DASHBOARD_PASSWORD no Railway.'
      }
    );
  }

  if (
    req.method === 'GET' &&
    url.pathname ===
      '/api/state'
  ) {
    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/toggle'
  ) {
    const body =
      await readJson(req);

    const allowed =
      new Set([
        'paused',
        'autoDiscovery',
        'autoQueueDiscovery'
      ]);

    if (
      !allowed.has(
        body.field
      )
    ) {
      return json(
        res,
        400,
        {
          ok: false,
          error:
            'Campo inválido.'
        }
      );
    }

    const next =
      updateStore((s) => {
        s[body.field] =
          typeof body.value ===
            'boolean'
            ? body.value
            : !s[body.field];

        if (
          body.field ===
            'autoQueueDiscovery' &&
          s.autoQueueDiscovery
        ) {
          s.autoDiscovery =
            true;
        }

        return s;
      });

    return json(
      res,
      200,
      {
        ok: true,
        value:
          next[
            body.field
          ]
      }
    );
  }

  if (
    req.method === 'PATCH' &&
    url.pathname ===
      '/api/settings'
  ) {
    const body =
      await readJson(req);

    updateStore((s) => {
      if (
        Array.isArray(
          body.enabledMarketplaces
        )
      ) {
        s.enabledMarketplaces = [
          ...new Set(
            body.enabledMarketplaces
              .filter(
                (x) =>
                  [
                    'shopee',
                    'mercadolivre',
                    'shein'
                  ].includes(x)
              )
          )
        ];
      }

      if (
        body.searchFilters
      ) {
        s.searchFilters = {
          ...s.searchFilters,
          ...body.searchFilters
        };
      }

      if (
        body.dashboardSettings
      ) {
        s.dashboardSettings = {
          ...s.dashboardSettings,
          ...body.dashboardSettings
        };
      }

      return s;
    });

    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/search/auto'
  ) {
    const list =
      await discoverWebOffers({
        force: true
      });

    return json(
      res,
      200,
      {
        ok: true,
        found:
          list.length,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/search/manual'
  ) {
    const body =
      await readJson(req);

    const keyword =
      String(
        body.keyword ||
        ''
      ).trim();

    if (!keyword) {
      return json(
        res,
        400,
        {
          ok: false,
          error:
            'Digite o que quer pesquisar.'
        }
      );
    }

    const result =
      await manualSearch(
        keyword,
        body.platforms
      );

    return json(
      res,
      200,
      {
        ok: true,
        found:
          result.suggestions.length,
        errors:
          result.errors,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/trends/refresh'
  ) {
    const digest =
      await buildTrendDigest();

    return json(
      res,
      200,
      {
        ok: true,
        text:
          digest.text,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'GET' &&
    url.pathname ===
      '/api/groups'
  ) {
    const groups =
      await listWhatsAppGroups();

    return json(
      res,
      200,
      {
        ok: true,
        groups
      }
    );
  }

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/groups'
  ) {
    const body =
      await readJson(req);

    setTargetGroups(
      Array.isArray(
        body.groups
      )
        ? body.groups
        : []
    );

    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/whatsapp/pair'
  ) {
    const body =
      await readJson(req);

    const phone =
      String(
        body.phone ||
        ''
      )
        .replace(
          /\D/g,
          ''
        );

    if (
      phone.length < 10
    ) {
      return json(
        res,
        400,
        {
          ok: false,
          error:
            'Número inválido.'
        }
      );
    }

    const code =
      await requestWhatsAppPairingCode(
        phone
      );

    return json(
      res,
      200,
      {
        ok: true,
        code
      }
    );
  }

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/queue/send-next'
  ) {
    const result =
      await sendOneNow();

    return json(
      res,
      200,
      {
        ok: true,
        result,
        state:
          sanitizedState()
      }
    );
  }


  if (req.method === 'POST' && url.pathname === '/api/link/import') {
    const body = await readJson(req);
    const inputUrl = String(body.url || '').trim();

    if (!inputUrl) {
      return json(res, 400, { ok: false, error: 'Cole o link do produto.' });
    }

    const item = await itemFromImportedLink(inputUrl);

    return json(res, 200, {
      ok: true,
      item,
      preview: formatOfferMessage(item)
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/link/to-approval') {
    const body = await readJson(req);
    const item = body.item;

    if (!item?.product || !item?.link) {
      return json(res, 400, { ok: false, error: 'Oferta inválida.' });
    }

    updateStore((s) => {
      s.suggestions.unshift({
        ...item,
        id: item.id || suggestedId(),
        createdAt: item.createdAt || new Date().toISOString()
      });
      s.suggestions = s.suggestions.slice(0, 250);
      return s;
    });

    return json(res, 200, { ok: true, state: sanitizedState() });
  }

  if (req.method === 'POST' && url.pathname === '/api/offer-queues') {
    const body = await readJson(req);
    const name = String(body.name || '').trim();

    if (!name) {
      return json(res, 400, { ok: false, error: 'Dê um nome para a fila.' });
    }

    const q = {
      id: newQueueId(),
      name: name.slice(0,80),
      active: Boolean(body.active),
      intervalMinutes: Math.max(5, Number(body.intervalMinutes || 10)),
      startMinutes: Number(body.startMinutes ?? 480),
      endMinutes: Number(body.endMinutes ?? 1320),
      groups: Array.isArray(body.groups) ? body.groups : [],
      items: [],
      sentCount: 0,
      errorCount: 0,
      blockedCount: 0,
      lastSentAt: null,
      lastAttemptAt: null,
      createdAt: new Date().toISOString()
    };

    updateStore((s) => {
      s.offerQueues.push(q);
      return s;
    });

    return json(res, 200, { ok: true, queue: q, state: sanitizedState() });
  }

  const oqMatch = url.pathname.match(/^\/api\/offer-queues\/([^/]+)$/);

  if (oqMatch && req.method === 'PATCH') {
    const id = decodeURIComponent(oqMatch[1]);
    const body = await readJson(req);

    updateStore((s) => {
      const q = s.offerQueues.find(x => String(x.id) === String(id));
      if (!q) return s;

      if ('name' in body) q.name = String(body.name || q.name).trim().slice(0,80);
      if ('active' in body) q.active = Boolean(body.active);
      if ('intervalMinutes' in body) q.intervalMinutes = Math.max(5, Number(body.intervalMinutes || 10));
      if ('startMinutes' in body) q.startMinutes = Number(body.startMinutes);
      if ('endMinutes' in body) q.endMinutes = Number(body.endMinutes);
      if (Array.isArray(body.groups)) q.groups = body.groups;

      return s;
    });

    return json(res, 200, { ok: true, state: sanitizedState() });
  }

  if (oqMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(oqMatch[1]);
    updateStore((s) => {
      s.offerQueues = s.offerQueues.filter(x => String(x.id) !== String(id));
      return s;
    });
    return json(res, 200, { ok: true, state: sanitizedState() });
  }

  const oqItems = url.pathname.match(/^\/api\/offer-queues\/([^/]+)\/items$/);

  if (oqItems && req.method === 'POST') {
    const id = decodeURIComponent(oqItems[1]);
    const body = await readJson(req);
    const item = body.item;

    if (!item?.product || !item?.link) {
      return json(res, 400, { ok: false, error: 'Oferta inválida.' });
    }

    let found = false;
    updateStore((s) => {
      const q = s.offerQueues.find(x => String(x.id) === String(id));
      if (!q) return s;
      found = true;
      q.items.push({ ...item, id: item.id || suggestedId(), queuedAt: new Date().toISOString() });
      return s;
    });

    if (!found) return json(res, 404, { ok: false, error: 'Fila não encontrada.' });
    return json(res, 200, { ok: true, state: sanitizedState() });
  }

  const apToQ = url.pathname.match(/^\/api\/suggestions\/(\d+)\/offer-queue\/([^/]+)$/);

  if (apToQ && req.method === 'POST') {
    const index = Number(apToQ[1]);
    const qid = decodeURIComponent(apToQ[2]);
    let error = '';

    updateStore((s) => {
      const item = s.suggestions?.[index];
      const q = s.offerQueues.find(x => String(x.id) === String(qid));

      if (!item) { error = 'Sugestão não encontrada.'; return s; }
      if (!q) { error = 'Fila não encontrada.'; return s; }
      if (!hasSafeAffiliateLink(item)) { error = 'Essa oferta ainda não tem um link de afiliada confirmado.'; return s; }

      const [removed] = s.suggestions.splice(index, 1);
      q.items.push({ ...removed, queuedAt: new Date().toISOString() });
      return s;
    });

    if (error) return json(res, 409, { ok: false, error });
    return json(res, 200, { ok: true, state: sanitizedState() });
  }

  const oqSingle = url.pathname.match(/^\/api\/offer-queues\/([^/]+)\/items\/(\d+)$/);

  if (oqSingle && req.method === 'DELETE') {
    const id = decodeURIComponent(oqSingle[1]);
    const index = Number(oqSingle[2]);

    updateStore((s) => {
      const q = s.offerQueues.find(x => String(x.id) === String(id));
      if (q?.items?.[index]) q.items.splice(index,1);
      return s;
    });

    return json(res, 200, { ok: true, state: sanitizedState() });
  }

  const oqSend = url.pathname.match(/^\/api\/offer-queues\/([^/]+)\/send-next$/);

  if (oqSend && req.method === 'POST') {
    const result = await sendOfferQueueNow(decodeURIComponent(oqSend[1]));
    return json(res, 200, { ok: true, result, state: sanitizedState() });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/divulgador') {
    const body = await readJson(req);

    updateStore((s) => {
      if ('enabled' in body) s.divulgador.enabled = Boolean(body.enabled);
      return s;
    });

    return json(res, 200, { ok: true, state: sanitizedState() });
  }

  const previewMatch =
    url.pathname.match(
      /^\/api\/(queue|suggestions)\/(\d+)\/preview$/
    );

  if (
    req.method === 'GET' &&
    previewMatch
  ) {
    const {
      item
    } =
      itemFromState(
        previewMatch[1] ===
          'suggestions'
          ? 'suggestions'
          : 'queue',
        previewMatch[2]
      );

    if (!item) {
      return json(
        res,
        404,
        {
          ok: false,
          error:
            'Oferta não encontrada.'
        }
      );
    }

    const preview =
      formatOfferMessage({
        ...item,
        link:
          affiliateLinkFor(
            item
          )
      });

    return json(
      res,
      200,
      {
        ok: true,
        preview
      }
    );
  }

  const itemMatch =
    url.pathname.match(
      /^\/api\/(queue|suggestions)\/(\d+)$/
    );

  if (
    itemMatch &&
    req.method === 'PATCH'
  ) {
    const kind =
      itemMatch[1] ===
        'queue'
        ? 'queue'
        : 'suggestions';

    const index =
      Number(
        itemMatch[2]
      );

    const body =
      await readJson(req);

    const {
      item
    } =
      itemFromState(
        kind,
        index
      );

    if (!item) {
      return json(
        res,
        404,
        {
          ok: false,
          error:
            'Oferta não encontrada.'
        }
      );
    }

    let next =
      applyFields(
        structuredClone(
          item
        ),
        body
      );

    if (
      !(
        'text' in body
      )
    ) {
      next =
        await rebuildText(
          next
        );
    }

    updateStore((s) => {
      s[kind][index] =
        next;
      return s;
    });

    return json(
      res,
      200,
      {
        ok: true,
        item:
          next,
        state:
          sanitizedState()
      }
    );
  }

  if (
    itemMatch &&
    req.method === 'DELETE'
  ) {
    const kind =
      itemMatch[1] ===
        'queue'
        ? 'queue'
        : 'suggestions';

    const index =
      Number(
        itemMatch[2]
      );

    updateStore((s) => {
      if (
        s[kind]?.[
          index
        ]
      ) {
        s[kind].splice(
          index,
          1
        );
      }

      return s;
    });

    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  const approveMatch =
    url.pathname.match(
      /^\/api\/suggestions\/(\d+)\/approve$/
    );

  if (
    approveMatch &&
    req.method === 'POST'
  ) {
    const index =
      Number(
        approveMatch[1]
      );

    const s =
      readStore();

    const item =
      s.suggestions?.[
        index
      ];

    if (!item) {
      return json(
        res,
        404,
        {
          ok: false,
          error:
            'Sugestão não encontrada.'
        }
      );
    }

    if (
      !hasSafeAffiliateLink(
        item
      )
    ) {
      return json(
        res,
        409,
        {
          ok: false,
          error:
            'Essa oferta ainda não tem link de afiliada confirmado. Edite o campo Link afiliado antes de salvar na fila.'
        }
      );
    }

    updateStore((x) => {
      const [
        approved
      ] =
        x.suggestions.splice(
          index,
          1
        );

      if (approved) {
        approved.link =
          affiliateLinkFor(
            approved
          );

        approved.queuedAt =
          new Date()
            .toISOString();

        x.queue.push(
          approved
        );
      }

      return x;
    });

    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  const moveMatch =
    url.pathname.match(
      /^\/api\/queue\/(\d+)\/move$/
    );

  if (
    moveMatch &&
    req.method === 'POST'
  ) {
    const from =
      Number(
        moveMatch[1]
      );

    const body =
      await readJson(req);

    updateStore((s) => {
      if (
        !s.queue?.[
          from
        ]
      ) {
        return s;
      }

      const to =
        Math.max(
          0,
          Math.min(
            s.queue.length -
            1,
            Number(
              body.to ||
              0
            )
          )
        );

      const [
        item
      ] =
        s.queue.splice(
          from,
          1
        );

      s.queue.splice(
        to,
        0,
        item
      );

      return s;
    });

    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  const sendSpecificMatch =
    url.pathname.match(
      /^\/api\/queue\/(\d+)\/send$/
    );

  if (
    sendSpecificMatch &&
    req.method === 'POST'
  ) {
    const index =
      Number(
        sendSpecificMatch[1]
      );

    updateStore((s) => {
      if (
        s.queue?.[
          index
        ]
      ) {
        const [
          item
        ] =
          s.queue.splice(
            index,
            1
          );

        s.queue.unshift(
          item
        );
      }

      return s;
    });

    const result =
      await sendOneNow();

    return json(
      res,
      200,
      {
        ok: true,
        result,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'DELETE' &&
    url.pathname ===
      '/api/suggestions'
  ) {
    updateStore((s) => {
      s.suggestions = [];
      return s;
    });

    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  if (
    req.method === 'DELETE' &&
    url.pathname ===
      '/api/queue'
  ) {
    updateStore((s) => {
      s.queue = [];
      return s;
    });

    return json(
      res,
      200,
      {
        ok: true,
        state:
          sanitizedState()
      }
    );
  }

  return json(
    res,
    404,
    {
      ok: false,
      error:
        'Rota não encontrada.'
    }
  );
}

export function startDashboard() {
  const server =
    http.createServer(
      async (
        req,
        res
      ) => {
        try {
          const url =
            new URL(
              req.url,
              'http://localhost'
            );

          if (
            url.pathname
              .startsWith(
                '/api/'
              )
          ) {
            return await api(
              req,
              res,
              url
            );
          }

          serveStatic(
            req,
            res
          );
        } catch (e) {
          console.error(
            'Painel web:',
            e
          );

          json(
            res,
            500,
            {
              ok: false,
              error:
                e?.message ||
                'Erro interno.'
            }
          );
        }
      }
    );

  server.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `🌐 Painel Auri ativo na porta ${PORT}.`
      );

      if (
        !DASHBOARD_PASSWORD
      ) {
        console.log(
          '⚠️ Configure DASHBOARD_PASSWORD no Railway para liberar o painel.'
        );
      }
    }
  );

  return server;
}
