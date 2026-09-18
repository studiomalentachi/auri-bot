import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Telegraf, Markup } from 'telegraf';
import { availableAIProviders, generateOfferCopy } from './ai.js';
import { config } from './config.js';
import { discoverWebOffers, searchSheinOffers } from './discovery.js';
import { importProductFromUrl, searchMarketplace } from './marketplaces.js';
import { getShopeeConversions, isShopeeConfigured, searchShopeeOffersBroad } from './shopee.js';
import { enqueue, isDuplicate, readStore, removeFromQueue, setTargetGroups, updateStore } from './store.js';
import { isWhatsAppConnected, listWhatsAppGroups, requestWhatsAppPairingCode } from './whatsapp.js';
import { sendOneNow } from './scheduler.js';
import { buildMeliAuthorizationUrl, exchangeMeliAuthorizationCode, meliOAuthStatus } from './mercadolivre.js';

const drafts = new Map();
let lastGroups = [];
let lastSearch = [];

const BTN = {
  newOffer: '➕ Nova oferta',
  linkOffer: '🔗 Oferta por link',
  search: '🔎 Buscar ofertas',
  queue: '📦 Fila',
  whatsapp: '📱 WhatsApp',
  groups: '👥 Grupos de envio',
  status: '📊 Status',
  sendNow: '▶️ Enviar agora',
  ai: '🧠 IA',
  discovery: '🤖 Auto busca',
  marketplaces: '🛒 Marketplaces',
  filters: '🎛️ Filtros',
  suggestions: '📥 Caixa de aprovação',
  results: '📈 Resultados',
  pause: '⏸️ Pausar envios',
  resume: '▶️ Retomar envios',
  cancel: '❌ Cancelar'
};

function mainMenu() {
  const s = readStore();
  return Markup.keyboard([
    [BTN.newOffer, BTN.linkOffer],
    [BTN.search, BTN.suggestions],
    [BTN.queue, BTN.groups],
    [BTN.whatsapp, BTN.status],
    [BTN.marketplaces, BTN.filters],
    [BTN.ai, BTN.discovery],
    [BTN.results, BTN.sendNow],
    [s.paused ? BTN.resume : BTN.pause]
  ]).resize();
}


const BUILTIN_MARKETPLACES = {
  shopee: {
    label: '🧡 Shopee',
    autoSearch: true
  },
  shein: {
    label: '🖤 SHEIN',
    autoSearch: true
  },
  mercadolivre: {
    label: '💛 Mercado Livre',
    autoSearch: true
  },
  amazon: {
    label: '🛒 Amazon',
    autoSearch: false
  }
};

function marketplaceCatalog() {
  const s =
    readStore();

  const catalog = {
    ...BUILTIN_MARKETPLACES
  };

  for (
    const item of
    s.customMarketplaces ||
    []
  ) {
    catalog[item.id] = {
      label:
        `🛍️ ${item.name}`,
      autoSearch:
        false,
      custom:
        true,
      domain:
        item.domain,
      name:
        item.name
    };
  }

  return catalog;
}

function enabledMarketplaces() {
  const s =
    readStore();

  const catalog =
    marketplaceCatalog();

  const list =
    Array.isArray(
      s.enabledMarketplaces
    )
      ? s.enabledMarketplaces
      : [
          'shopee',
          'shein',
          'mercadolivre'
        ];

  return list.filter(
    (x) =>
      Boolean(
        catalog[x]
      )
  );
}

function automaticMarketplaces() {
  const catalog =
    marketplaceCatalog();

  return enabledMarketplaces()
    .filter(
      (id) =>
        catalog[id]
          ?.autoSearch === true
    );
}

function marketplaceNames(
  list =
    enabledMarketplaces()
) {
  const catalog =
    marketplaceCatalog();

  if (!list.length) {
    return 'nenhum';
  }

  return list
    .map(
      (x) =>
        catalog[x]?.label ||
        x
    )
    .join(' • ');
}

function customMarketplaceForUrl(
  inputUrl
) {
  let host = '';

  try {
    host =
      new URL(
        inputUrl
      )
        .hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ''
        );
  } catch {
    return null;
  }

  const s =
    readStore();

  return (
    s.customMarketplaces ||
    []
  ).find(
    (x) =>
      host ===
        x.domain ||
      host.endsWith(
        `.${x.domain}`
      )
  ) || null;
}

function slugMarketplace(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      '-'
    )
    .replace(
      /^-+|-+$/g,
      ''
    )
    .slice(0, 40);
}

function searchFilterState() {
  const s =
    readStore();

  return {
    minSales:
      Math.max(
        50,
        Number(
          s.searchFilters
            ?.minSales ||
          50
        )
      ),
    resultLimit:
      Math.max(
        5,
        Math.min(
          20,
          Number(
            s.searchFilters
              ?.resultLimit ||
            20
          )
        )
      ),
    broadSearch:
      s.searchFilters
        ?.broadSearch !==
      false,
    sortBy:
      s.searchFilters
        ?.sortBy ||
      'sales'
  };
}

function searchSortLabel(value) {
  if (
    value ===
    'discount'
  ) {
    return '🔥 maior desconto';
  }

  if (
    value ===
    'rating'
  ) {
    return '⭐ melhor nota';
  }

  if (
    value ===
    'balanced'
  ) {
    return '✨ equilibrado';
  }

  return '🛒 mais vendidos';
}

async function showSearchFilters(ctx) {
  const filters =
    searchFilterState();

  return ctx.reply(
    `🎛️ FILTROS DA BUSCA\n\n` +
      `🛒 Vendas mínimas: ${filters.minSales}\n` +
      `📦 Produtos por busca: até ${filters.resultLimit}\n` +
      `🔎 Busca ampla: ${filters.broadSearch ? '✅ ligada' : '❌ desligada'}\n` +
      `↕️ Ordenar: ${searchSortLabel(filters.sortBy)}\n\n` +
      'A busca ampla tenta variações do termo e mais páginas para encontrar bem mais produtos.',
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          `${
            filters.minSales === 50
              ? '✅ '
              : ''
          }50 vendas`,
          'filter:min:50'
        ),
        Markup.button.callback(
          `${
            filters.minSales === 100
              ? '✅ '
              : ''
          }100`,
          'filter:min:100'
        )
      ],
      [
        Markup.button.callback(
          `${
            filters.minSales === 500
              ? '✅ '
              : ''
          }500`,
          'filter:min:500'
        ),
        Markup.button.callback(
          `${
            filters.minSales === 1000
              ? '✅ '
              : ''
          }1.000`,
          'filter:min:1000'
        )
      ],
      [
        Markup.button.callback(
          `${
            filters.resultLimit === 10
              ? '✅ '
              : ''
          }10 produtos`,
          'filter:limit:10'
        ),
        Markup.button.callback(
          `${
            filters.resultLimit === 20
              ? '✅ '
              : ''
          }20 produtos`,
          'filter:limit:20'
        )
      ],
      [
        Markup.button.callback(
          filters.broadSearch
            ? '✅ Busca ampla'
            : '⬜ Busca ampla',
          'filter:broad'
        )
      ],
      [
        Markup.button.callback(
          `${
            filters.sortBy === 'sales'
              ? '✅ '
              : ''
          }🛒 Mais vendidos`,
          'filter:sort:sales'
        )
      ],
      [
        Markup.button.callback(
          `${
            filters.sortBy === 'discount'
              ? '✅ '
              : ''
          }🔥 Maior desconto`,
          'filter:sort:discount'
        ),
        Markup.button.callback(
          `${
            filters.sortBy === 'rating'
              ? '✅ '
              : ''
          }⭐ Melhor nota`,
          'filter:sort:rating'
        )
      ],
      [
        Markup.button.callback(
          `${
            filters.sortBy === 'balanced'
              ? '✅ '
              : ''
          }✨ Equilibrado`,
          'filter:sort:balanced'
        )
      ]
    ])
  );
}

async function showMarketplaces(ctx) {
  const active =
    new Set(
      enabledMarketplaces()
    );

  const catalog =
    marketplaceCatalog();

  const rows =
    Object.entries(
      catalog
    ).map(
      ([id, data]) => [
        Markup.button.callback(
          `${
            active.has(id)
              ? '✅'
              : '⬜'
          } ${data.label}${
            data.autoSearch
              ? ''
              : ' • por link'
          }`,
          `mp:toggle:${id}`
        )
      ]
    );

  rows.push([
    Markup.button.callback(
      '➕ Adicionar marketplace',
      'mp:add'
    )
  ]);

  if (
    (
      readStore()
        .customMarketplaces ||
      []
    ).length
  ) {
    rows.push([
      Markup.button.callback(
        '🗑️ Excluir personalizado',
        'mp:deletecustom'
      )
    ]);
  }

  rows.push([
    Markup.button.callback(
      '✅ Ativar todos',
      'mp:all'
    ),
    Markup.button.callback(
      '🚫 Desativar todos',
      'mp:none'
    )
  ]);

  return ctx.reply(
    `🛒 MARKETPLACES\n\n` +
      `Ativos agora:\n${marketplaceNames(
        [...active]
      )}\n\n` +
      '✅ Shopee, SHEIN e Mercado Livre têm pesquisa automática.\n' +
      '🔗 Amazon e marketplaces que você adicionar manualmente ficam disponíveis para trabalhar por link.\n\n' +
      'Isso acontece porque a Auri só chama de pesquisa automática quando consegue validar os dados exigidos, inclusive o número de vendas.',
    Markup.inlineKeyboard(
      rows
    )
  );
}

function queueItemTitle(item) {
  return String(
    item?.product?.name ||
    (item?.text || '')
      .split('\n')[0] ||
    'Oferta'
  ).trim();
}

async function showQueueManager(
  ctx,
  page = 0
) {
  const s = readStore();
  const queue =
    Array.isArray(s.queue)
      ? s.queue
      : [];

  if (!queue.length) {
    return ctx.reply(
      '📦 A fila está vazia.',
      mainMenu()
    );
  }

  const perPage = 8;
  const pages =
    Math.max(
      1,
      Math.ceil(
        queue.length /
        perPage
      )
    );

  page =
    Math.max(
      0,
      Math.min(
        pages - 1,
        Number(page) || 0
      )
    );

  const start =
    page * perPage;

  const slice =
    queue.slice(
      start,
      start +
      perPage
    );

  const rows =
    slice.map(
      (item, localIndex) => {
        const index =
          start +
          localIndex;

        return [
          Markup.button.callback(
            `${index + 1}. ${queueItemTitle(
              item
            ).slice(0, 42)}`,
            `q:open:${index}:${page}`
          )
        ];
      }
    );

  const nav = [];

  if (page > 0) {
    nav.push(
      Markup.button.callback(
        '⬅️',
        `q:page:${page - 1}`
      )
    );
  }

  nav.push(
    Markup.button.callback(
      `${page + 1}/${pages}`,
      'noop'
    )
  );

  if (
    page <
    pages - 1
  ) {
    nav.push(
      Markup.button.callback(
        '➡️',
        `q:page:${page + 1}`
      )
    );
  }

  rows.push(nav);

  return ctx.reply(
    `📦 GERENCIAR FILA\n\n` +
      `Total: ${queue.length} oferta(s)\n` +
      'Toque em uma oferta para editar, excluir ou mudar a ordem.',
    Markup.inlineKeyboard(
      rows
    )
  );
}

async function showQueueItem(
  ctx,
  index,
  page = 0
) {
  const s = readStore();
  const queue =
    s.queue || [];

  const item =
    queue[
      Number(index)
    ];

  if (!item) {
    return ctx.reply(
      '⚠️ Essa oferta não está mais na fila.',
      mainMenu()
    );
  }

  const platform =
    marketplaceLabel(
      item.product?.platform
    );

  const textPreview =
    String(
      item.text || ''
    )
      .trim()
      .slice(
        0,
        650
      );

  const rows = [
    [
      Markup.button.callback(
        '✏️ Editar texto',
        `q:edittext:${index}:${page}`
      ),
      Markup.button.callback(
        '🔗 Editar link',
        `q:editlink:${index}:${page}`
      )
    ],
    [
      Markup.button.callback(
        '📸 Trocar foto',
        `q:editphoto:${index}:${page}`
      )
    ],
    [
      Markup.button.callback(
        '⬆️ Subir',
        `q:up:${index}:${page}`
      ),
      Markup.button.callback(
        '⬇️ Descer',
        `q:down:${index}:${page}`
      )
    ],
    [
      Markup.button.callback(
        '⏫ Ir pro topo',
        `q:top:${index}:${page}`
      ),
      Markup.button.callback(
        '⏬ Ir pro fim',
        `q:bottom:${index}:${page}`
      )
    ],
    [
      Markup.button.callback(
        '🔢 Mover para posição',
        `q:move:${index}:${page}`
      )
    ],
    [
      Markup.button.callback(
        '🗑️ Excluir',
        `q:delete:${index}:${page}`
      )
    ],
    [
      Markup.button.callback(
        '⬅️ Voltar à fila',
        `q:page:${page}`
      )
    ]
  ];

  return ctx.reply(
    `📦 OFERTA ${
      Number(index) + 1
    } DE ${queue.length}\n\n` +
      `${platform}\n` +
      `📌 ${queueItemTitle(
        item
      )}\n\n` +
      `✍️ TEXTO\n${
        textPreview ||
        '— sem texto'
      }\n\n` +
      `🔗 LINK\n${
        item.link ||
        item.product?.affiliateLink ||
        '— sem link'
      }`,
    Markup.inlineKeyboard(
      rows
    )
  );
}

function moveQueueItem(
  fromIndex,
  toIndex
) {
  updateStore((s) => {
    const queue =
      Array.isArray(s.queue)
        ? [...s.queue]
        : [];

    const from =
      Number(fromIndex);

    const to =
      Number(toIndex);

    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      from >= queue.length ||
      to < 0 ||
      to >= queue.length ||
      from === to
    ) {
      return s;
    }

    const [item] =
      queue.splice(
        from,
        1
      );

    queue.splice(
      to,
      0,
      item
    );

    s.queue = queue;

    return s;
  });
}

function onlyAdmin(adminId) {
  return async (ctx, next) => {
    if (String(ctx.from?.id) !== String(adminId)) {
      return ctx.reply('⛔ Este bot é privado.');
    }
    return next();
  };
}

function statusText() {
  const s = readStore();
  const ai = availableAIProviders();
  const aiOn =
    Object.entries(ai)
      .filter(([, value]) => value)
      .map(([key]) => key)
      .join(', ') || 'nenhuma chave';

  return (
    `📊 Status da Auri\n\n` +
    `WhatsApp: ${isWhatsAppConnected() ? '✅ conectado' : '❌ desconectado'}\n` +
    `Grupos: ${s.targetGroups?.length || 0}\n` +
    `Fila: ${s.queue.length}\n` +
    `Marketplaces: ${marketplaceNames(
      s.enabledMarketplaces
    )}\n` +
    `Automação: ${s.paused ? '⏸️ pausada' : '✅ ativa'}\n` +
    `Horário: 08:00–22:00 | ${config.sendIntervalMinutes} min | até 85/dia\n` +
    `IA escolhida: ${s.aiProvider || 'auto'} | chaves disponíveis: ${aiOn}\n` +
    `IA automática: ${process.env.GEMINI_API_KEY ? 'Gemini' : 'fallback configurado'}\n` +
    `Shopee Open API: ${isShopeeConfigured() ? '✅' : '⚠️ não configurada'}\n` +
    `Mercado Livre API: ${meliOAuthStatus().authorized ? '✅ conectada' : (meliOAuthStatus().configured ? '⚠️ falta autorizar (/meli)' : '⚠️ não configurada')}\n` +
    `Auto busca: ${s.autoDiscovery ? '✅ ligada' : '❌ desligada'} | ` +
    `Auto fila: ${s.autoQueueDiscovery ? '✅' : '❌'}\n` +
    `Enviadas: ${s.metrics.sentOffers} ofertas / ${s.metrics.sentMessages} mensagens`
  );
}

function queueText() {
  const s = readStore();
  if (!s.queue.length) return '📦 A fila está vazia.';

  const lines = s.queue.slice(0, 15).map((x, i) => {
    const first =
      x.product?.name ||
      (x.text || '').split('\n')[0] ||
      'Oferta';
    return `${i + 1}. ${String(first).slice(0, 55)} — ID ${x.id}`;
  });

  return (
    `📦 Fila: ${s.queue.length}\n\n${lines.join('\n')}` +
    `${s.queue.length > 15 ? '\n…' : ''}`
  );
}

async function downloadTelegramPhoto(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error('Não consegui baixar a foto.');

  const buf = Buffer.from(await res.arrayBuffer());
  const baseDir = process.env.PERSIST_DIR
    ? path.resolve(process.env.PERSIST_DIR)
    : path.resolve('.');

  const dir = path.join(baseDir, 'data', 'uploads');
  fs.mkdirSync(dir, { recursive: true });

  const dest = path.join(
    dir,
    `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`
  );

  fs.writeFileSync(dest, buf);
  return dest;
}

function isPlaceholderName(name) {
  const s = String(name || '').trim().toLowerCase();
  return (
    !s ||
    [
      'produto',
      'produto shopee',
      'produto shein',
      'produto amazon',
      'produto mercado livre'
    ].includes(s)
  );
}

function parseMoneyBR(value) {
  let s = String(value || '')
    .trim()
    .replace(/r\$/gi, '')
    .replace(/\s/g, '')
    .replace(/[^\d.,]/g, '');

  if (!s) return 0;

  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isNo(value) {
  return /^(sem|não|nao|nenhum|nenhuma|n|0)$/i.test(String(value || '').trim());
}

function discountText(product) {
  if (Number(product.originalPrice || 0) > Number(product.price || 0)) {
    return `de R$ ${Number(product.originalPrice).toFixed(2).replace('.', ',')} por R$ ${Number(product.price).toFixed(2).replace('.', ',')}`;
  }

  if (Number(product.discountPct || 0) > 0) {
    return `${Math.round(Number(product.discountPct))}% de desconto`;
  }

  return '';
}


const COPY_ANGLES = [
  'Foque na praticidade e no problema que o produto resolve no dia a dia.',
  'Foque no visual, no estilo e no motivo de o produto chamar atenção.',
  'Foque no custo-benefício e na sensação de ter encontrado uma boa oportunidade.',
  'Foque em uma situação real de uso, como se estivesse indicando para uma amiga.',
  'Foque no detalhe mais interessante do produto e crie curiosidade logo no título.',
  'Foque em para quem esse produto faz sentido, usando uma abertura do tipo “pra quem...” sem ficar repetitiva.'
];

function nextCopyAngle(d, first = false) {
  if (first || !Number.isInteger(d.data.copyVariant)) {
    d.data.copyVariant = crypto.randomInt(COPY_ANGLES.length);
  } else {
    d.data.copyVariant = (d.data.copyVariant + 1) % COPY_ANGLES.length;
  }

  return COPY_ANGLES[d.data.copyVariant];
}

function firstCopyInstruction(d) {
  const angle = nextCopyAngle(d, true);

  return (
    `VARIAÇÃO DE TEXTO: ${angle}\n` +
    'Não use sempre a mesma fórmula de abertura. Varie título, emoji inicial, construção das frases e ritmo do texto.'
  );
}

function regenerateInstruction(d, previousText) {
  const angle = nextCopyAngle(d, false);
  d.data.regenCount = Number(d.data.regenCount || 0) + 1;

  return (
    `NOVA VERSÃO Nº ${d.data.regenCount}: ${angle}\n` +
    'Crie uma versão realmente diferente da anterior. ' +
    'Mude o título, o emoji inicial, a primeira frase, a ordem das ideias e a forma de apresentar o preço/desconto. ' +
    'Não reutilize frases inteiras nem apenas troque algumas palavras.\n\n' +
    `TEXTO ANTERIOR — NÃO COPIAR:\n${previousText}`
  );
}

async function beginManual(ctx) {
  drafts.set(ctx.from.id, {
    step: 'photo',
    mode: 'manual',
    data: {}
  });

  await ctx.reply(
    '📸 Envie a foto do produto ou toque em “Sem foto”.',
    Markup.keyboard([['Sem foto'], [BTN.cancel]]).resize()
  );
}

async function beginLink(ctx) {
  drafts.set(ctx.from.id, {
    step: 'product_url',
    mode: 'link',
    data: {}
  });

  await ctx.reply(
    '🔗 Cole o link do produto.\n\n' +
      'Enquanto a Shopee Open API não estiver liberada, eu vou te pedir nome, preço, desconto e cupom. ' +
      'Depois eu monto o texto no seu estilo.',
    Markup.keyboard([[BTN.cancel]]).resize()
  );
}

async function previewOffer(ctx, d) {
  const product = d.data.product || {};

  if (d.data.photoPath && fs.existsSync(d.data.photoPath)) {
    try {
      await ctx.replyWithPhoto({ source: d.data.photoPath });
    } catch {}
  } else if (product.imageUrl) {
    try {
      await ctx.replyWithPhoto(product.imageUrl);
    } catch {}
  }

  const preview =
    `🛍️ PRÉVIA\n\n` +
    `${d.data.text}\n\n` +
    `🛍️ Compre aqui: ${d.data.link}`;

  await ctx.reply(
    preview,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Salvar na fila', `approve:${d.data.id}`)],
      [
        Markup.button.callback('✏️ Editar texto', `edit:${d.data.id}`),
        Markup.button.callback('📸 Enviar/Trocar foto', `photoedit:${d.data.id}`)
      ],
      [Markup.button.callback('✨ Gerar outro texto', `regen:${d.data.id}`)],
      [Markup.button.callback('❌ Cancelar', `reject:${d.data.id}`)]
    ])
  );
}

async function finalizeDraftWithAI(ctx, d) {
  const product = d.data.product || {};
  const link =
    d.data.link ||
    product.affiliateLink ||
    product.offerLink ||
    product.canonicalUrl ||
    product.productLink;

  if (isDuplicate(product, link)) {
    updateStore((s) => {
      s.metrics.blockedDuplicates += 1;
      return s;
    });

    drafts.delete(ctx.from.id);
    return ctx.reply(
      '⚠️ Esse produto já está na fila ou foi enviado recentemente. Não adicionei de novo.',
      mainMenu()
    );
  }

  const copy = await generateOfferCopy(product, firstCopyInstruction(d));

  d.step = 'confirm';
  d.data.id = d.data.id || crypto.randomBytes(3).toString('hex');
  d.data.text = copy.text;
  d.data.link = link;
  d.data.photoPath = d.data.photoPath || null;
  d.data.product = product;
  d.data.aiGenerated = true;
  d.data.aiProvider = copy.provider;

  drafts.set(ctx.from.id, d);
  return previewOffer(ctx, d);
}

async function finalizeFromProduct(ctx, product) {
  const link =
    product.affiliateLink ||
    product.offerLink ||
    product.canonicalUrl ||
    product.productLink;

  const d = {
    step: 'confirm',
    mode: 'link',
    data: {
      id: crypto.randomBytes(3).toString('hex'),
      link,
      photoPath: null,
      product
    }
  };

  drafts.set(ctx.from.id, d);
  return finalizeDraftWithAI(ctx, d);
}

async function startLinkDetails(ctx, d) {
  const product = d.data.product || {};

  if (isPlaceholderName(product.name)) {
    d.step = 'link_product_name';
    return ctx.reply(
      '📦 Qual é o nome do produto?\n\n' +
        'Pode mandar um nome curto, por exemplo: “Bandeja espelhada decorativa”.',
      Markup.keyboard([[BTN.cancel]]).resize()
    );
  }

  if (!Number(product.price || product.priceMin || 0)) {
    d.step = 'link_price';
    return ctx.reply(
      '💰 Qual é o preço atual?\n\nExemplo: 47,66',
      Markup.keyboard([[BTN.cancel]]).resize()
    );
  }

  if (!Number(product.discountPct || 0)) {
    d.step = 'link_discount';
    return ctx.reply(
      '🏷️ Tem desconto?\n\n' +
        'Se tiver, envie o preço de antes (ex.: 79,90) OU a porcentagem (ex.: 20%).\n' +
        'Se não tiver, escreva: Sem desconto',
      Markup.keyboard([['Sem desconto'], [BTN.cancel]]).resize()
    );
  }

  d.step = 'link_coupon';
  return ctx.reply(
    '🎟️ Tem cupom?\n\n' +
      'Envie o código ou a descrição do cupom.\n' +
      'Ex.: CUPOM10 ou “R$20 OFF acima de R$99”.\n\n' +
      'Se não tiver, toque em “Sem cupom”.',
    Markup.keyboard([['Sem cupom'], [BTN.cancel]]).resize()
  );
}

async function askLinkPhoto(ctx, d) {
  d.step = 'link_photo';

  const hasAutomaticImage = Boolean(d.data.product?.imageUrl);

  if (hasAutomaticImage) {
    return ctx.reply(
      '📸 E a foto do produto?\n\n' +
        'Eu encontrei uma imagem automaticamente. Você pode usar essa imagem, mandar outra foto ou enviar sem foto.',
      Markup.keyboard([
        ['Usar imagem automática'],
        ['Enviar outra foto'],
        ['Sem foto'],
        [BTN.cancel]
      ]).resize()
    );
  }

  return ctx.reply(
    '📸 Agora envie a foto do produto.\n\n' +
      'Se não quiser enviar imagem, toque em “Sem foto”.',
    Markup.keyboard([
      ['Sem foto'],
      [BTN.cancel]
    ]).resize()
  );
}

async function showGroups(ctx, page = 0) {
  try {
    if (!lastGroups.length) {
      lastGroups = await listWhatsAppGroups();
    }

    const s = readStore();
    const selected = new Set(
      (s.targetGroups || []).map((g) => g.jid)
    );

    const perPage = 12;
    const pages = Math.max(1, Math.ceil(lastGroups.length / perPage));
    page = Math.max(0, Math.min(pages - 1, page));

    const slice = lastGroups.slice(
      page * perPage,
      (page + 1) * perPage
    );

    const rows = slice.map((g) => [
      Markup.button.callback(
        `${selected.has(g.jid) ? '✅' : '⬜'} ${g.name} (${g.size})`,
        `gt:${lastGroups.indexOf(g)}:${page}`
      )
    ]);

    const nav = [];

    if (page > 0) {
      nav.push(Markup.button.callback('⬅️', `gp:${page - 1}`));
    }

    nav.push(
      Markup.button.callback(`${page + 1}/${pages}`, 'noop')
    );

    if (page < pages - 1) {
      nav.push(Markup.button.callback('➡️', `gp:${page + 1}`));
    }

    rows.push(nav);
    rows.push([
      Markup.button.callback('✅ Concluir', 'groups:done')
    ]);

    await ctx.reply(
      '👥 Marque todos os grupos que devem receber as ofertas:',
      Markup.inlineKeyboard(rows)
    );
  } catch (e) {
    await ctx.reply(`⚠️ ${e.message}`, mainMenu());
  }
}

async function beginSearch(ctx) {
  const active =
    automaticMarketplaces();

  if (!active.length) {
    return ctx.reply(
      '⚠️ Não há marketplace com pesquisa automática ativo.\n\nAbra 🛒 Marketplaces para ativar Shopee, SHEIN ou Mercado Livre. Para Amazon e marketplaces personalizados, use 🔗 Oferta por link.',
      mainMenu()
    );
  }

  drafts.set(
    ctx.from.id,
    {
      step:
        'search_platform',
      mode:
        'search',
      data: {}
    }
  );

  const catalog =
    marketplaceCatalog();

  const rows = [];

  for (
    let i = 0;
    i < active.length;
    i += 2
  ) {
    rows.push(
      active
        .slice(
          i,
          i + 2
        )
        .map(
          (id) =>
            Markup.button.callback(
              catalog[id].label,
              `sp:${id}`
            )
        )
    );
  }

  rows.push([
    Markup.button.callback(
      '🎛️ Ajustar filtros',
      'filter:menu'
    )
  ]);

  rows.push([
    Markup.button.callback(
      '⚙️ Gerenciar marketplaces',
      'mp:menu'
    )
  ]);

  const filters =
    searchFilterState();

  return ctx.reply(
    '🔎 Onde quer buscar?\n\n' +
      `Filtro atual: ${filters.minSales}+ vendas • até ${filters.resultLimit} produtos • ${filters.broadSearch ? 'busca ampla' : 'busca exata'}.`,
    Markup.inlineKeyboard(
      rows
    )
  );
}

function marketplaceLabel(platform) {
  const p =
    String(
      platform || ''
    ).toLowerCase();

  const catalog =
    marketplaceCatalog();

  return (
    catalog[p]?.label ||
    '🛍️ Produto'
  );
}

function moneyBR(value) {
  const n = Number(value || 0);

  if (!Number.isFinite(n) || n <= 0) {
    return '';
  }

  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function suggestionPublicLink(item) {
  return (
    item?.publicLink ||
    item?.product?.publicLink ||
    item?.product?.canonicalUrl ||
    item?.product?.productLink ||
    item?.link ||
    ''
  );
}

function suggestionPosition(id) {
  const list = readStore().suggestions || [];
  const index = list.findIndex(
    (x) => String(x.id) === String(id)
  );

  return {
    index,
    total: list.length
  };
}

function saveSuggestionDraft(d) {
  if (
    !d ||
    !d.data?.suggestionId
  ) {
    return;
  }

  updateStore((s) => {
    const index = (s.suggestions || []).findIndex(
      (x) =>
        String(x.id) ===
        String(d.data.suggestionId)
    );

    if (index >= 0) {
      s.suggestions[index] = {
        ...s.suggestions[index],
        text: d.data.text,
        photoPath:
          d.data.photoPath || null,
        product: {
          ...(s.suggestions[index].product || {}),
          ...(d.data.product || {})
        }
      };
    }

    return s;
  });
}

async function renderApprovalCard(ctx, item) {
  if (!item) {
    return ctx.reply(
      '📥 A caixa de aprovação está vazia.',
      mainMenu()
    );
  }

  const product = item.product || {};
  const publicLink =
    suggestionPublicLink(item);

  const id =
    String(
      item.id ||
      crypto.randomBytes(4).toString('hex')
    );

  const automaticAffiliateLink =
    String(
      item.product?.affiliateLink ||
      ''
    ).trim();

  const hasAutomaticAffiliateLink =
    item.product?.platform === 'shopee' &&
    item.product?.affiliateLinkVerified === true &&
    Boolean(automaticAffiliateLink);

  const data = {
    ...item,
    id,
    suggestionId:
      item.suggestionId ||
      id,
    publicLink,
    link:
      hasAutomaticAffiliateLink
        ? automaticAffiliateLink
        : '',
    product: {
      ...product,
      affiliateLink:
        hasAutomaticAffiliateLink
          ? automaticAffiliateLink
          : product.affiliateLink
    }
  };

  const d = {
    step: 'suggestion_review',
    mode: 'suggestion-review',
    data
  };

  drafts.set(ctx.from.id, d);

  if (
    data.photoPath &&
    fs.existsSync(data.photoPath)
  ) {
    try {
      await ctx.replyWithPhoto({
        source: data.photoPath
      });
    } catch {}
  } else if (product.imageUrl) {
    try {
      await ctx.replyWithPhoto(
        product.imageUrl
      );
    } catch {}
  }

  const current =
    suggestionPosition(id);

  const price = moneyBR(product.price);
  const oldPrice =
    moneyBR(product.originalPrice);

  const discount =
    Number(product.discountPct || 0);

  const sales =
    Number(product.sales || 0);

  const reviews =
    Number(product.reviewCount || 0);

  const rating =
    Number(product.rating || 0);

  const facts = [];

  if (
    oldPrice &&
    price &&
    Number(product.originalPrice) >
      Number(product.price)
  ) {
    facts.push(
      `💰 De ${oldPrice} por ${price}`
    );
  } else if (price) {
    facts.push(`💰 ${price}`);
  }

  if (discount > 0) {
    facts.push(
      `🔥 ${Math.round(discount)}% de desconto`
    );
  }

  if (sales > 0) {
    facts.push(
      `🛒 ${sales.toLocaleString('pt-BR')} vendidos/pedidos confirmados`
    );
  }

  if (reviews > 0) {
    facts.push(
      `💬 ${reviews.toLocaleString('pt-BR')} avaliações/reviews confirmados`
    );
  }

  if (rating > 0) {
    facts.push(
      `⭐ ${rating.toFixed(1).replace('.', ',')}`
    );
  }

  const coupon =
    String(
      product.couponCode ||
      product.coupon ||
      ''
    ).trim();

  const hasVerifiedCoupon =
    product.couponVerified === true &&
    Boolean(coupon);

  if (hasVerifiedCoupon) {
    facts.push(
      `🎟️ Cupom informado por você: ${coupon}`
    );
  }

  const rows = [];

  if (publicLink) {
    rows.push([
      Markup.button.url(
        '🔎 Abrir produto normal',
        publicLink
      )
    ]);
  }

  if (hasAutomaticAffiliateLink) {
    rows.push([
      Markup.button.url(
        '💸 Conferir link de afiliada',
        automaticAffiliateLink
      )
    ]);

    rows.push([
      Markup.button.callback(
        '✅ Usar link automático',
        `affauto:${id}`
      ),
      Markup.button.callback(
        '🔗 Substituir pelo meu link',
        `aff:${id}`
      )
    ]);
  } else {
    rows.push([
      Markup.button.callback(
        '🔗 Colocar meu link de afiliada',
        `aff:${id}`
      )
    ]);
  }

  rows.push([
    Markup.button.callback(
      hasVerifiedCoupon
        ? '🎟️ Alterar cupom'
        : '🎟️ Adicionar cupom',
      `coupon:${id}`
    ),
    ...(hasVerifiedCoupon
      ? [
          Markup.button.callback(
            '🚫 Remover cupom',
            `couponremove:${id}`
          )
        ]
      : [])
  ]);

  rows.push([
    Markup.button.callback(
      '✏️ Editar texto',
      `edit:${id}`
    ),
    Markup.button.callback(
      '📸 Trocar foto',
      `photoedit:${id}`
    )
  ]);

  rows.push([
    Markup.button.callback(
      '✨ Outro texto',
      `regen:${id}`
    ),
    Markup.button.callback(
      '❌ Ignorar',
      `ignore:${id}`
    )
  ]);

  if (current.total > 1) {
    rows.push([
      Markup.button.callback(
        '➡️ Próxima sugestão',
        `sugnext:${id}`
      )
    ]);
  }

  const numberText =
    current.index >= 0
      ? `📥 ${current.index + 1} de ${current.total}`
      : `📥 Caixa de aprovação`;

  const linkStatus =
    hasAutomaticAffiliateLink
      ? '✅ Link automático da Shopee disponível para conferência'
      : '⏳ Falta colocar/confirmar seu link de afiliada';

  const couponStatus =
    hasVerifiedCoupon
      ? `✅ ${coupon}`
      : '— nenhum cupom adicionado';

  await ctx.reply(
    `✨ OPORTUNIDADE PARA APROVAÇÃO\n` +
      `${numberText}\n\n` +
      `${marketplaceLabel(product.platform)} • ✅ dados verificados\n` +
      `📦 ${product.name || 'Produto'}\n\n` +
      `${facts.length ? `${facts.join('\n')}\n\n` : ''}` +
      `🎟️ CUPOM\n${couponStatus}\n\n` +
      `🔗 LINK DE AFILIADA\n${linkStatus}\n\n` +
      `✍️ TEXTO PARA O GRUPO\n\n${data.text || ''}\n\n` +
      `────────────\n` +
      `Antes de salvar, confira produto, link e texto.`,
    Markup.inlineKeyboard(rows)
  );
}

async function showSuggestions(ctx, page = 0) {
  const suggestions =
    readStore().suggestions || [];

  if (!suggestions.length) {
    return ctx.reply(
      '📥 A caixa de aprovação está vazia.\n\n' +
        'Ligue a Auto busca ou toque em “🔎 Buscar agora” para a Auri pesquisar novos produtos.',
      mainMenu()
    );
  }

  const index = Math.max(
    0,
    Math.min(
      suggestions.length - 1,
      Number(page) || 0
    )
  );

  return renderApprovalCard(
    ctx,
    suggestions[index]
  );
}

async function showAI(ctx) {
  const available = availableAIProviders();
  const s = readStore();

  const rows = [
    ['auto', 'Automático'],
    ['openai', 'OpenAI'],
    ['gemini', 'Gemini'],
    ['anthropic', 'Claude']
  ].map(([id, name]) => [
    Markup.button.callback(
      `${s.aiProvider === id ? '✅' : '⬜'} ${name}` +
        `${id !== 'auto' && !available[id] ? ' (sem chave)' : ''}`,
      `ai:${id}`
    )
  ]);

  await ctx.reply(
    '🧠 Escolha qual IA a Auri usa para escrever as ofertas:',
    Markup.inlineKeyboard(rows)
  );
}

async function showDiscovery(ctx) {
  const s = readStore();

  await ctx.reply(
    `🤖 Pesquisa automática da Auri\n\n` +
      `Pesquisa web real: ${s.autoDiscovery ? '✅ ligada' : '❌ desligada'}\n` +
      `Pesquisa automática: ${marketplaceNames(
        automaticMarketplaces()
      )}\n` +
      `Outros ativos por link: ${marketplaceNames(
        enabledMarketplaces()
          .filter(
            (id) =>
              !automaticMarketplaces()
                .includes(id)
          )
      )}\n` +
      `Categorias: tudo — inclusive alimentos, bebidas, limpeza, casa, beleza, moda, tecnologia, pet, infantil, carro, papelaria, cozinha, fitness e viagem.\n` +
      `Rodada: até ${config.discoveryMaxPerRun} produtos\n` +
      `Intervalo: ${config.discoveryEveryMinutes} min\n` +
      `Meta de envio: até 85/dia (08:00–22:00, a cada 10 min)\n\n` +
      `🔐 Shopee: quando a Affiliate Open API devolver um link de afiliada confirmado, você pode abrir esse link, conferir e só depois usar. Se preferir, pode substituí-lo pelo seu próprio link. SHEIN e Mercado Livre continuam pedindo o seu link de afiliada.`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          s.autoDiscovery
            ? '⏹ Desligar pesquisa'
            : '▶️ Ligar pesquisa',
          'disc:toggle'
        )
      ],
      [
        Markup.button.callback(
          '🔎 Buscar agora',
          'disc:now'
        )
      ],
      [
        Markup.button.callback(
          '💡 Ver sugestões',
          'disc:suggestions'
        )
      ]
    ])
  );
}

async function showResults(ctx) {
  return ctx.reply(
    '📈 Resultados dos afiliados\n\n' +
      '🧡 Shopee — consulta automática pela Affiliate Open API.\n' +
      '💛 Mercado Livre — abre a Central oficial de Afiliados e Criadores.\n' +
      '🖤 SHEIN — abre o Centro de Afiliados oficial.\n\n' +
      'No Mercado Livre e na SHEIN, a Auri não inventa números: você confere diretamente no painel oficial.',
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '🧡 Ver resultados Shopee',
          'results:shopee'
        )
      ],
      [
        Markup.button.url(
          '💛 Abrir Central Mercado Livre',
          'https://www.mercadolivre.com.br/l/visite-o-portal-de-afiliados'
        )
      ],
      [
        Markup.button.url(
          '🖤 Abrir Central SHEIN',
          'https://m.shein.com/br/user/login?activity_sign=affiliate&canSwitchSite=0&close_redirection=%2Faffiliate%2F&position=bottom&redirection=%2Faffiliate%2F'
        )
      ]
    ])
  );
}

async function showShopeeResults(ctx) {
  if (!isShopeeConfigured()) {
    return ctx.reply(
      '⚠️ A Shopee Affiliate Open API ainda não está configurada.',
      mainMenu()
    );
  }

  try {
    const rows = await getShopeeConversions(7);

    const commissions = rows.reduce(
      (a, x) =>
        a + Number(x.totalCommission || 0),
      0
    );

    const orders = rows.flatMap(
      (x) => x.orders || []
    );

    const completed = orders.filter(
      (x) =>
        String(x.orderStatus || '')
          .toUpperCase() === 'COMPLETED'
    ).length;

    const itemUnits = orders.reduce(
      (total, order) =>
        total +
        (order.items || []).reduce(
          (sum, item) =>
            sum + Number(item.qty || 0),
          0
        ),
      0
    );

    await ctx.reply(
      `🧡 Shopee — últimos 7 dias\n\n` +
        `Conversões: ${rows.length}\n` +
        `Pedidos: ${orders.length}\n` +
        `Concluídos: ${completed}\n` +
        `Unidades: ${itemUnits}\n` +
        `Comissão estimada: ${commissions.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        })}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🔄 Atualizar Shopee',
            'results:shopee'
          )
        ],
        [
          Markup.button.callback(
            '⬅️ Voltar aos resultados',
            'results:menu'
          )
        ]
      ])
    );
  } catch (e) {
    await ctx.reply(
      `⚠️ Não consegui consultar os resultados da Shopee: ${e.message}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🔄 Tentar novamente',
            'results:shopee'
          )
        ],
        [
          Markup.button.callback(
            '⬅️ Voltar',
            'results:menu'
          )
        ]
      ])
    );
  }
}

function extractMeliAuthorization(text) {
  const raw = String(text || '').trim();

  try {
    const u = new URL(raw);

    return {
      code: u.searchParams.get('code') || '',
      state: u.searchParams.get('state') || ''
    };
  } catch {
    return {
      code: raw,
      state: ''
    };
  }
}

async function beginMeliAuthorization(ctx) {
  const status = meliOAuthStatus();

  if (!status.configured) {
    return ctx.reply(
      '⚠️ Ainda faltam MELI_CLIENT_ID, MELI_CLIENT_SECRET ou MELI_REDIRECT_URI no Railway.',
      mainMenu()
    );
  }

  const state = crypto.randomBytes(16).toString('hex');
  const url = buildMeliAuthorizationUrl(state);

  drafts.set(ctx.from.id, {
    step: 'meli_authorize',
    mode: 'meli_oauth',
    data: { state }
  });

  return ctx.reply(
    '💛 Vamos autorizar a Auri no Mercado Livre.\n\n' +
      '1. Toque no botão abaixo.\n' +
      '2. Autorize a aplicação Auri.\n' +
      '3. Você será levada para o site Universo da Esther.\n' +
      '4. Copie o endereço COMPLETO da barra do navegador e cole aqui no Telegram.\n\n' +
      'Não envie Client Secret, Access Token ou Refresh Token aqui.',
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          '🔐 Autorizar Mercado Livre',
          url
        )
      ],
      [
        Markup.button.callback(
          '❌ Cancelar',
          'meli:cancel'
        )
      ]
    ])
  );
}

export function startTelegram({ token, adminId }) {
  const bot = new Telegraf(token);
  bot.use(onlyAdmin(adminId));

  bot.start((ctx) =>
    ctx.reply(
      'Oi! Eu sou a Auri 💜\n\n' +
        'Agora eu posso cadastrar ofertas manualmente, montar por link com IA, buscar produtos, trabalhar com vários grupos e fazer busca automática.',
      mainMenu()
    )
  );

  bot.command('menu', (ctx) =>
    ctx.reply('💜 Painel da Auri', mainMenu())
  );

  bot.command('status', (ctx) =>
    ctx.reply(statusText(), mainMenu())
  );

  bot.command('meli', (ctx) => beginMeliAuthorization(ctx));

  bot.on('photo', async (ctx) => {
    const d = drafts.get(ctx.from.id);
    if (!d) return;

    if (d.step === 'photo') {
      try {
        d.data.photoPath = await downloadTelegramPhoto(
          ctx,
          ctx.message.photo.at(-1).file_id
        );

        d.step = 'text';

        await ctx.reply(
          '✅ Foto recebida. Agora envie o texto da oferta.',
          Markup.keyboard([[BTN.cancel]]).resize()
        );
      } catch (e) {
        await ctx.reply(`⚠️ ${e.message}`);
      }
      return;
    }

    if (d.step === 'link_photo') {
      try {
        d.data.photoPath = await downloadTelegramPhoto(
          ctx,
          ctx.message.photo.at(-1).file_id
        );

        await ctx.reply(
          '✅ Foto recebida. Agora vou montar a oferta ✨',
          Markup.keyboard([[BTN.cancel]]).resize()
        );

        return finalizeDraftWithAI(ctx, d);
      } catch (e) {
        return ctx.reply(`⚠️ ${e.message}`);
      }
    }


    if (d.step === 'queue_edit_photo') {
      try {
        const index =
          Number(
            d.data.queueIndex
          );

        const photoPath =
          await downloadTelegramPhoto(
            ctx,
            ctx.message.photo.at(-1).file_id
          );

        updateStore((s) => {
          if (
            s.queue?.[index]
          ) {
            s.queue[index] = {
              ...s.queue[index],
              photoPath
            };
          }

          return s;
        });

        drafts.delete(
          ctx.from.id
        );

        await ctx.reply(
          '✅ Foto da oferta atualizada.',
          Markup.removeKeyboard()
        );

        return showQueueItem(
          ctx,
          index,
          d.data.queuePage || 0
        );
      } catch (e) {
        return ctx.reply(
          `⚠️ ${e.message}`
        );
      }
    }

    if (d.step === 'edit_photo') {
      try {
        d.data.photoPath = await downloadTelegramPhoto(
          ctx,
          ctx.message.photo.at(-1).file_id
        );

        const waitingAffiliate =
          d.mode === 'suggestion-review' &&
          !(
            d.data.product?.affiliateLink ||
            (
              d.data.product?.platform === 'shopee' &&
              d.data.link
            )
          );

        d.step = waitingAffiliate
          ? 'suggestion_review'
          : 'confirm';

        drafts.set(ctx.from.id, d);
        saveSuggestionDraft(d);

        await ctx.reply(
          '✅ Foto atualizada.',
          Markup.removeKeyboard()
        );

        if (waitingAffiliate) {
          return renderApprovalCard(
            ctx,
            d.data
          );
        }

        return previewOffer(ctx, d);
      } catch (e) {
        return ctx.reply(`⚠️ ${e.message}`);
      }
    }
  });

  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim();

    if (text.startsWith('/')) return next();

    const d = drafts.get(ctx.from.id);

    if (!d) {
      if (text === BTN.newOffer) return beginManual(ctx);
      if (text === BTN.linkOffer) return beginLink(ctx);
      if (text === BTN.search) return beginSearch(ctx);
      if (text === BTN.suggestions) return showSuggestions(ctx);
      if (text === BTN.queue) {
        return showQueueManager(
          ctx,
          0
        );
      }

      if (text === BTN.marketplaces) {
        return showMarketplaces(
          ctx
        );
      }

      if (text === BTN.filters) {
        return showSearchFilters(
          ctx
        );
      }

      if (text === BTN.groups) {
        lastGroups = [];
        return showGroups(ctx);
      }

      if (text === BTN.status) {
        return ctx.reply(statusText(), mainMenu());
      }

      if (text === BTN.ai) return showAI(ctx);
      if (text === BTN.discovery) return showDiscovery(ctx);
      if (text === BTN.results) return showResults(ctx);

      if (text === BTN.sendNow) {
        try {
          const r = await sendOneNow();
          return ctx.reply(
            `✅ Enviado para ${r.sentCount} grupo(s).`,
            mainMenu()
          );
        } catch (e) {
          return ctx.reply(`⚠️ ${e.message}`, mainMenu());
        }
      }

      if (text === BTN.pause) {
        updateStore((s) => {
          s.paused = true;
          return s;
        });
        return ctx.reply('⏸️ Envios pausados.', mainMenu());
      }

      if (text === BTN.resume) {
        updateStore((s) => {
          s.paused = false;
          return s;
        });
        return ctx.reply('▶️ Envios retomados.', mainMenu());
      }

      if (text === BTN.whatsapp) {
        if (isWhatsAppConnected()) {
          return ctx.reply('✅ WhatsApp conectado.', mainMenu());
        }

        drafts.set(ctx.from.id, {
          step: 'wa_phone',
          mode: 'wa',
          data: {}
        });

        return ctx.reply(
          '📱 Envie DDI + DDD + número, somente números.',
          Markup.keyboard([[BTN.cancel]]).resize()
        );
      }

      return ctx.reply(
        'Escolha uma opção no painel 💜',
        mainMenu()
      );
    }

    if (text === BTN.cancel) {
      drafts.delete(ctx.from.id);
      return ctx.reply('Cancelado.', mainMenu());
    }


    if (d.step === 'meli_authorize') {
      const auth = extractMeliAuthorization(text);

      if (!auth.code) {
        return ctx.reply(
          '⚠️ Não encontrei o código de autorização. Cole o endereço COMPLETO da barra do navegador depois de autorizar.'
        );
      }

      if (
        auth.state &&
        auth.state !== d.data.state
      ) {
        return ctx.reply(
          '⚠️ Essa autorização não corresponde à solicitação atual. Digite /meli e tente novamente.'
        );
      }

      await ctx.reply(
        '⏳ Conectando a Auri ao Mercado Livre…'
      );

      try {
        await exchangeMeliAuthorizationCode(
          auth.code
        );

        drafts.delete(ctx.from.id);

        return ctx.reply(
          '✅ Mercado Livre conectado à Auri!\n\n' +
            'O token será renovado automaticamente e salvo no volume do Railway.',
          mainMenu()
        );
      } catch (e) {
        drafts.delete(ctx.from.id);

        return ctx.reply(
          `⚠️ Não consegui concluir a autorização: ${e.message}\n\n` +
            'Digite /meli para gerar uma nova autorização.',
          mainMenu()
        );
      }
    }

    if (
      d.step === 'photo' &&
      text.toLowerCase() === 'sem foto'
    ) {
      d.data.photoPath = null;
      d.step = 'text';

      return ctx.reply(
        '✍️ Envie o texto da oferta.',
        Markup.keyboard([[BTN.cancel]]).resize()
      );
    }

    if (d.step === 'text') {
      d.data.text = text;
      d.step = 'link';

      return ctx.reply(
        '🔗 Agora envie o link de afiliada.',
        Markup.keyboard([[BTN.cancel]]).resize()
      );
    }

    if (d.step === 'link') {
      d.data.link = text;
      d.data.id = crypto.randomBytes(3).toString('hex');
      d.step = 'confirm';

      d.data.product = {
        platform: 'manual',
        name: (d.data.text || '').split('\n')[0],
        canonicalUrl: text,
        affiliateLink: text
      };

      return previewOffer(ctx, d);
    }

    if (d.step === 'meli_affiliate_product_url') {
      const affiliateUrl = String(text || '').trim();
      const lower = affiliateUrl.toLowerCase();

      if (
        !/^https?:\/\//i.test(affiliateUrl) ||
        !(
          lower.includes('meli.la') ||
          lower.includes('mercadolivre.com') ||
          lower.includes('mercadolibre.com')
        )
      ) {
        return ctx.reply(
          '⚠️ Esse não parece ser um link do Mercado Livre. Cole o link de afiliada gerado pelo Mercado Livre.'
        );
      }

      await ctx.reply(
        '⏳ Identificando o produto pelo seu link de afiliada…'
      );

      try {
        const product = await importProductFromUrl(
          affiliateUrl
        );

        const identified =
          product &&
          product.platform === 'mercadolivre' &&
          !isPlaceholderName(product.name) &&
          Number(product.price || 0) > 0;

        if (!identified) {
          return ctx.reply(
            '⚠️ Eu consegui abrir o link, mas o Mercado Livre não me devolveu os dados completos desse produto.\n\n' +
              'Tente gerar novamente o link de afiliada diretamente na página desse produto e cole aqui. Você não precisa escrever nome, preço ou foto.',
            Markup.keyboard([[BTN.cancel]]).resize()
          );
        }

        product.affiliateLink = affiliateUrl;

        const d2 = {
          step: 'confirm',
          mode: 'meli_affiliate_link',
          data: {
            id: crypto.randomBytes(3).toString('hex'),
            link: affiliateUrl,
            photoPath: null,
            product
          }
        };

        drafts.set(ctx.from.id, d2);

        const priceText = Number(product.price || 0)
          .toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          });

        await ctx.reply(
          '✅ Produto identificado automaticamente!\n\n' +
            `📦 ${product.name}\n` +
            `💰 ${priceText}\n` +
            `${product.imageUrl ? '📸 Foto encontrada\n' : ''}` +
            '\n✨ Agora vou criar o texto da oferta.'
        );

        return finalizeDraftWithAI(ctx, d2);
      } catch (e) {
        return ctx.reply(
          `⚠️ Não consegui identificar esse produto automaticamente: ${e.message}\n\n` +
            'Tente gerar um novo link de afiliada diretamente na página do produto e cole aqui.',
          Markup.keyboard([[BTN.cancel]]).resize()
        );
      }
    }

    if (d.step === 'product_url') {
      await ctx.reply('⏳ Buscando dados do produto…');

      try {
        const product = await importProductFromUrl(text);

        if (
          product?.platform ===
          'generic'
        ) {
          const custom =
            customMarketplaceForUrl(
              text
            );

          if (custom) {
            product.platform =
              custom.id;

            product.marketplaceName =
              custom.name;
          }
        }

        d.data.product = product;
        d.data.link =
          product.affiliateLink ||
          product.offerLink ||
          product.canonicalUrl ||
          product.productLink ||
          text;

        d.data.id = crypto.randomBytes(3).toString('hex');

        return startLinkDetails(ctx, d);
      } catch (e) {
        drafts.delete(ctx.from.id);
        return ctx.reply(`⚠️ ${e.message}`, mainMenu());
      }
    }

    if (d.step === 'link_product_name') {
      d.data.product.name = text;
      d.step = 'link_price';

      return ctx.reply(
        '💰 Qual é o preço atual?\n\nExemplo: 47,66',
        Markup.keyboard([[BTN.cancel]]).resize()
      );
    }

    if (d.step === 'link_price') {
      const value = parseMoneyBR(text);

      if (!value) {
        return ctx.reply(
          '⚠️ Não consegui entender o preço. Envie só o valor, por exemplo: 47,66'
        );
      }

      d.data.product.price = value;
      d.data.product.priceMin = value;
      d.step = 'link_discount';

      return ctx.reply(
        '🏷️ Tem desconto?\n\n' +
          'Se tiver, envie o preço de antes (ex.: 79,90) OU a porcentagem (ex.: 20%).\n' +
          'Se não tiver, toque em “Sem desconto”.',
        Markup.keyboard([['Sem desconto'], [BTN.cancel]]).resize()
      );
    }

    if (d.step === 'link_discount') {
      if (isNo(text) || /^sem desconto$/i.test(text)) {
        d.data.product.discountPct =
          Number(d.data.product.discountPct || 0);
      } else if (text.includes('%')) {
        const pct = Number(
          text.replace(/[^\d.,]/g, '').replace(',', '.')
        );

        if (!Number.isFinite(pct) || pct <= 0) {
          return ctx.reply(
            '⚠️ Não consegui entender o desconto. Ex.: 20% ou 79,90. Se não houver, toque em “Sem desconto”.'
          );
        }

        d.data.product.discountPct = pct;
      } else {
        const oldPrice = parseMoneyBR(text);

        if (!oldPrice) {
          return ctx.reply(
            '⚠️ Não consegui entender. Envie o preço anterior, como 79,90, ou toque em “Sem desconto”.'
          );
        }

        d.data.product.originalPrice = oldPrice;

        const current = Number(d.data.product.price || 0);

        if (current > 0 && oldPrice > current) {
          d.data.product.discountPct =
            ((oldPrice - current) / oldPrice) * 100;
        }
      }

      d.step = 'link_coupon';

      return ctx.reply(
        '🎟️ Tem cupom?\n\n' +
          'Envie o código ou a descrição do cupom.\n' +
          'Ex.: CUPOM10 ou “R$20 OFF acima de R$99”.\n\n' +
          'Se não tiver, toque em “Sem cupom”.',
        Markup.keyboard([['Sem cupom'], [BTN.cancel]]).resize()
      );
    }

    if (d.step === 'link_coupon') {
      if (isNo(text) || /^sem cupom$/i.test(text)) {
        delete d.data.product.couponCode;
        delete d.data.product.coupon;
        d.data.product.couponVerified = false;
      } else {
        d.data.product.couponCode = text;
        d.data.product.couponVerified = true;
      }

      return askLinkPhoto(ctx, d);
    }

    if (d.step === 'link_photo') {
      if (/^usar imagem automática$/i.test(text)) {
        if (!d.data.product?.imageUrl) {
          return ctx.reply(
            '⚠️ Eu não encontrei uma imagem automática para esse produto. Envie uma foto ou toque em “Sem foto”.'
          );
        }

        d.data.photoPath = null;

        await ctx.reply(
          '✅ Vou usar a imagem encontrada. Preparando a oferta ✨',
          Markup.keyboard([[BTN.cancel]]).resize()
        );

        return finalizeDraftWithAI(ctx, d);
      }

      if (/^enviar outra foto$/i.test(text)) {
        return ctx.reply(
          '📸 Pode enviar a foto do produto agora.',
          Markup.keyboard([['Sem foto'], [BTN.cancel]]).resize()
        );
      }

      if (/^sem foto$/i.test(text) || isNo(text)) {
        d.data.photoPath = null;

        if (d.data.product) {
          d.data.product.imageUrl = null;
        }

        await ctx.reply(
          '✨ Certo. Vou montar a oferta sem foto.',
          Markup.keyboard([[BTN.cancel]]).resize()
        );

        return finalizeDraftWithAI(ctx, d);
      }

      return ctx.reply(
        '📸 Envie uma foto do produto ou escolha uma das opções abaixo.',
        Markup.keyboard(
          d.data.product?.imageUrl
            ? [['Usar imagem automática'], ['Enviar outra foto'], ['Sem foto'], [BTN.cancel]]
            : [['Sem foto'], [BTN.cancel]]
        ).resize()
      );
    }

    if (d.step === 'meli_affiliate_link') {
      const affiliateUrl = String(text || '').trim();
      const lower = affiliateUrl.toLowerCase();

      if (
        !/^https?:\/\//i.test(affiliateUrl) ||
        !(
          lower.includes('meli.la') ||
          lower.includes('mercadolivre.com') ||
          lower.includes('mercadolibre.com')
        )
      ) {
        return ctx.reply(
          '⚠️ Esse não parece ser um link do Mercado Livre. Cole o link de afiliada gerado pelo Mercado Livre.'
        );
      }

      d.data.product.affiliateLink = affiliateUrl;
      d.data.link = affiliateUrl;

      await ctx.reply(
        '✅ Link de afiliada recebido. Vou montar a oferta ✨',
        Markup.keyboard([[BTN.cancel]]).resize()
      );

      return finalizeFromProduct(
        ctx,
        d.data.product
      );
    }

    if (
      d.step === 'edit_photo' &&
      text.toLowerCase() === 'usar foto automática'
    ) {
      d.data.photoPath = null;

      const waitingAffiliate =
        d.mode === 'suggestion-review' &&
        !(
          d.data.product?.affiliateLink ||
          (
            d.data.product?.platform === 'shopee' &&
            d.data.link
          )
        );

      d.step = waitingAffiliate
        ? 'suggestion_review'
        : 'confirm';

      drafts.set(ctx.from.id, d);
      saveSuggestionDraft(d);

      await ctx.reply(
        '✅ Vou usar a foto automática do produto.',
        Markup.removeKeyboard()
      );

      if (waitingAffiliate) {
        return renderApprovalCard(
          ctx,
          d.data
        );
      }

      return previewOffer(ctx, d);
    }

    if (
      d.step === 'edit_photo' &&
      text.toLowerCase() === 'sem foto'
    ) {
      d.data.photoPath = null;

      if (d.data.product) {
        d.data.product = {
          ...d.data.product,
          imageUrl: null
        };
      }

      const waitingAffiliate =
        d.mode === 'suggestion-review' &&
        !(
          d.data.product?.affiliateLink ||
          (
            d.data.product?.platform === 'shopee' &&
            d.data.link
          )
        );

      d.step = waitingAffiliate
        ? 'suggestion_review'
        : 'confirm';

      drafts.set(ctx.from.id, d);
      saveSuggestionDraft(d);

      await ctx.reply(
        '✅ Foto removida.',
        Markup.removeKeyboard()
      );

      if (waitingAffiliate) {
        return renderApprovalCard(
          ctx,
          d.data
        );
      }

      return previewOffer(ctx, d);
    }

    if (d.step === 'edit_text') {
      const edited = String(text || '').trim();

      if (!edited) {
        return ctx.reply(
          '⚠️ O texto ficou vazio. Envie o texto completo que você quer usar.'
        );
      }

      d.data.text = edited;
      d.data.aiGenerated = false;
      d.data.manuallyEdited = true;

      const waitingAffiliate =
        d.mode === 'suggestion-review' &&
        !(
          d.data.product?.affiliateLink ||
          (
            d.data.product?.platform === 'shopee' &&
            d.data.link
          )
        );

      d.step = waitingAffiliate
        ? 'suggestion_review'
        : 'confirm';

      drafts.set(ctx.from.id, d);
      saveSuggestionDraft(d);

      await ctx.reply(
        '✅ Texto atualizado.',
        Markup.removeKeyboard()
      );

      if (waitingAffiliate) {
        return renderApprovalCard(
          ctx,
          d.data
        );
      }

      return previewOffer(ctx, d);
    }

    if (d.step === 'marketplace_add_name') {
      const name =
        String(text || '')
          .trim();

      if (
        name.length < 2
      ) {
        return ctx.reply(
          '⚠️ Envie um nome válido. Ex.: Magalu, AliExpress, Temu.'
        );
      }

      d.data.marketplaceName =
        name;

      d.step =
        'marketplace_add_domain';

      drafts.set(
        ctx.from.id,
        d
      );

      return ctx.reply(
        '🌐 Agora envie o domínio/site desse marketplace.\n\nEx.: magazineluiza.com.br\nNão precisa mandar senha, token ou dados da sua conta.',
        Markup.keyboard([
          [BTN.cancel]
        ]).resize()
      );
    }

    if (d.step === 'marketplace_add_domain') {
      let domain =
        String(text || '')
          .trim()
          .toLowerCase();

      domain =
        domain
          .replace(
            /^https?:\/\//,
            ''
          )
          .replace(
            /^www\./,
            ''
          )
          .split('/')[0];

      if (
        !domain.includes('.') ||
        domain.includes(' ')
      ) {
        return ctx.reply(
          '⚠️ Esse domínio não parece válido. Ex.: magazineluiza.com.br'
        );
      }

      const name =
        d.data
          .marketplaceName;

      let id =
        slugMarketplace(
          name
        );

      if (
        [
          'shopee',
          'shein',
          'mercadolivre',
          'amazon'
        ].includes(id)
      ) {
        id =
          `custom-${id}`;
      } else {
        id =
          `custom-${id}`;
      }

      if (
        !id ||
        id ===
        'custom-'
      ) {
        id =
          `custom-${Date.now()}`;
      }

      updateStore((s) => {
        const current =
          Array.isArray(
            s.customMarketplaces
          )
            ? s.customMarketplaces
            : [];

        const existing =
          current.find(
            (x) =>
              x.domain ===
              domain
          );

        if (existing) {
          if (
            !s.enabledMarketplaces
              .includes(
                existing.id
              )
          ) {
            s.enabledMarketplaces
              .push(
                existing.id
              );
          }

          return s;
        }

        s.customMarketplaces = [
          ...current,
          {
            id,
            name,
            domain,
            autoSearch:
              false
          }
        ];

        s.enabledMarketplaces = [
          ...new Set([
            ...(
              s.enabledMarketplaces ||
              []
            ),
            id
          ])
        ];

        return s;
      });

      drafts.delete(
        ctx.from.id
      );

      await ctx.reply(
        `✅ ${name} foi adicionado à Auri.\n\n` +
          'Por enquanto ele funciona por 🔗 Oferta por link. Para ter pesquisa automática, a integração desse marketplace precisa existir e fornecer os dados que você exige.',
        Markup.removeKeyboard()
      );

      return showMarketplaces(
        ctx
      );
    }

    if (d.step === 'queue_edit_text') {
      const edited =
        String(text || '')
          .trim();

      if (!edited) {
        return ctx.reply(
          '⚠️ O texto não pode ficar vazio.'
        );
      }

      const index =
        Number(
          d.data.queueIndex
        );

      updateStore((s) => {
        if (
          s.queue?.[index]
        ) {
          s.queue[index] = {
            ...s.queue[index],
            text: edited
          };
        }

        return s;
      });

      drafts.delete(
        ctx.from.id
      );

      await ctx.reply(
        '✅ Texto da oferta atualizado.',
        Markup.removeKeyboard()
      );

      return showQueueItem(
        ctx,
        index,
        d.data.queuePage || 0
      );
    }

    if (d.step === 'queue_edit_link') {
      const link =
        String(text || '')
          .trim();

      if (
        !/^https?:\/\//i.test(
          link
        )
      ) {
        return ctx.reply(
          '⚠️ Envie um link completo começando com http:// ou https://.'
        );
      }

      const index =
        Number(
          d.data.queueIndex
        );

      updateStore((s) => {
        if (
          s.queue?.[index]
        ) {
          s.queue[index] = {
            ...s.queue[index],
            link
          };

          if (
            s.queue[index].product
          ) {
            s.queue[index].product = {
              ...s.queue[index].product,
              affiliateLink: link
            };
          }
        }

        return s;
      });

      drafts.delete(
        ctx.from.id
      );

      await ctx.reply(
        '✅ Link da oferta atualizado.',
        Markup.removeKeyboard()
      );

      return showQueueItem(
        ctx,
        index,
        d.data.queuePage || 0
      );
    }

    if (d.step === 'queue_move_position') {
      const index =
        Number(
          d.data.queueIndex
        );

      const queue =
        readStore().queue ||
        [];

      const position =
        Number.parseInt(
          String(text || '')
            .trim(),
          10
        );

      if (
        !Number.isInteger(position) ||
        position < 1 ||
        position > queue.length
      ) {
        return ctx.reply(
          `⚠️ Digite uma posição entre 1 e ${queue.length}.`
        );
      }

      moveQueueItem(
        index,
        position - 1
      );

      drafts.delete(
        ctx.from.id
      );

      await ctx.reply(
        `✅ Oferta movida para a posição ${position}.`,
        Markup.removeKeyboard()
      );

      return showQueueManager(
        ctx,
        Math.floor(
          (position - 1) /
          8
        )
      );
    }

    if (d.step === 'suggestion_coupon') {
      const value =
        String(text || '').trim();

      if (
        !value ||
        /^sem cupom$/i.test(value) ||
        isNo(value)
      ) {
        delete d.data.product.couponCode;
        delete d.data.product.coupon;
        d.data.product.couponVerified = false;

        saveSuggestionDraft(d);

        d.step = 'suggestion_review';
        drafts.set(ctx.from.id, d);

        await ctx.reply(
          '✅ Cupom removido. A Auri não vai mencionar cupom nessa oferta.',
          Markup.removeKeyboard()
        );

        return renderApprovalCard(
          ctx,
          d.data
        );
      }

      d.data.product.couponCode =
        value;

      d.data.product.couponVerified =
        true;

      // Se o texto ainda era da IA, atualiza para poder incluir
      // o cupom informado. Se você já editou manualmente, preserva.
      if (
        d.data.aiGenerated !== false &&
        !d.data.manuallyEdited
      ) {
        const copy =
          await generateOfferCopy(
            d.data.product,
            'Inclua o cupom somente porque ele foi informado e confirmado pela usuária. Não invente regra, validade, valor mínimo ou benefício além do texto exato do cupom.'
          );

        d.data.text =
          copy.text;

        d.data.aiProvider =
          copy.provider;

        d.data.aiGenerated =
          true;
      }

      saveSuggestionDraft(d);

      d.step = 'suggestion_review';
      drafts.set(ctx.from.id, d);

      await ctx.reply(
        '✅ Cupom adicionado. Ele só será usado porque VOCÊ informou esse cupom.',
        Markup.removeKeyboard()
      );

      return renderApprovalCard(
        ctx,
        d.data
      );
    }

    if (d.step === 'suggestion_affiliate_link') {
      const affiliateUrl =
        String(text || '').trim();

      if (!/^https?:\/\//i.test(affiliateUrl)) {
        return ctx.reply(
          '⚠️ Cole um link completo começando com http:// ou https://.'
        );
      }

      const item = d.data;
      const platform =
        item?.product?.platform || '';

      const lower =
        affiliateUrl.toLowerCase();

      const looksRight =
        platform === 'mercadolivre'
          ? (
              lower.includes('meli.la') ||
              lower.includes('mercadolivre') ||
              lower.includes('mercadolibre')
            )
          : platform === 'shein'
            ? lower.includes('shein')
            : platform === 'shopee'
              ? (
                  lower.includes('shopee') ||
                  lower.includes('shope.ee')
                )
              : true;

      if (!looksRight) {
        return ctx.reply(
          `⚠️ Esse link não parece ser do mesmo marketplace (${platform}). Confira e cole o seu link de afiliada correto.`
        );
      }

      const product = {
        ...(item.product || {}),
        affiliateLink: affiliateUrl
      };

      const draft = {
        step: 'confirm',
        mode: 'suggestion',
        data: {
          ...item,
          id:
            item.id ||
            crypto.randomBytes(4).toString('hex'),
          link: affiliateUrl,
          publicLink:
            item.publicLink ||
            item.link ||
            product.publicLink ||
            product.canonicalUrl,
          product,
          suggestionId: item.id
        }
      };

      drafts.set(
        ctx.from.id,
        draft
      );

      await ctx.reply(
        '✅ Link de afiliada recebido. Agora confira a prévia final:',
        Markup.keyboard([[BTN.cancel]]).resize()
      );

      return previewOffer(
        ctx,
        draft
      );
    }

    if (d.step === 'wa_phone') {
      try {
        const code = await requestWhatsAppPairingCode(text);
        drafts.delete(ctx.from.id);

        return ctx.reply(
          `🔐 Código de pareamento:\n\n${code}\n\n` +
            'WhatsApp → Aparelhos conectados → Conectar aparelho → Conectar com número.',
          mainMenu()
        );
      } catch (e) {
        return ctx.reply(`⚠️ ${e.message}`);
      }
    }

    if (d.step === 'search_keyword') {
      const platform =
        d.data.platform;

      drafts.delete(
        ctx.from.id
      );

      const filters =
        searchFilterState();

      await ctx.reply(
        `🔎 Buscando até ${filters.resultLimit} produtos com ${filters.minSales}+ vendas…`
      );

      try {
        let found = [];

        if (
          platform ===
          'shein'
        ) {
          found =
            await searchSheinOffers(
              text,
              filters.resultLimit
            );
        } else if (
          platform ===
          'shopee'
        ) {
          found =
            await searchShopeeOffersBroad(
              text,
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
            );
        } else {
          found =
            await searchMarketplace(
              platform,
              text,
              filters.resultLimit
            );
        }

        const sortRows =
          (rows) => {
            const copy =
              [...rows];

            if (
              filters.sortBy ===
              'discount'
            ) {
              return copy.sort(
                (a, b) =>
                  Number(
                    b.discountPct ||
                    0
                  ) -
                  Number(
                    a.discountPct ||
                    0
                  )
              );
            }

            if (
              filters.sortBy ===
              'rating'
            ) {
              return copy.sort(
                (a, b) =>
                  Number(
                    b.rating ||
                    0
                  ) -
                  Number(
                    a.rating ||
                    0
                  )
              );
            }

            if (
              filters.sortBy ===
              'balanced'
            ) {
              return copy.sort(
                (a, b) =>
                  Number(
                    b.score ||
                    b.verifiedScore ||
                    0
                  ) -
                  Number(
                    a.score ||
                    a.verifiedScore ||
                    0
                  )
              );
            }

            return copy.sort(
              (a, b) =>
                Number(
                  b.sales ||
                  0
                ) -
                Number(
                  a.sales ||
                  0
                )
            );
          };

        lastSearch =
          sortRows(
            found.filter(
              (p) =>
                Number(
                  p.sales || 0
                ) >=
                filters.minSales
            )
          ).slice(
            0,
            filters.resultLimit
          );

        if (
          !lastSearch.length
        ) {
          return ctx.reply(
            `⚠️ Não encontrei nenhum resultado com ${filters.minSales}+ vendas confirmadas.\n\n` +
              (
                platform ===
                'shopee'
                  ? 'Com a busca ampla ligada, a Auri já tenta variações do termo e até 5 páginas. Você também pode reduzir o filtro de vendas em 🎛️ Filtros.'
                  : 'Tente um termo mais simples ou ajuste 🎛️ Filtros.'
              ),
            mainMenu()
          );
        }

        const rows =
          lastSearch.map(
            (p, i) => [
              Markup.button.callback(
                `${String(
                  p.name ||
                  'Produto'
                ).slice(0, 33)} • 🛒 ${Number(
                  p.sales
                ).toLocaleString(
                  'pt-BR'
                )}`,
                `pick:${i}`
              )
            ]
          );

        return ctx.reply(
          `${marketplaceLabel(platform)}\n\n` +
            `✅ ${lastSearch.length} produto(s) encontrados.\n` +
            `Filtro: ${filters.minSales}+ vendas • ${searchSortLabel(filters.sortBy)}.\n\n` +
            'Escolha um para abrir na Caixa de aprovação:',
          Markup.inlineKeyboard(
            rows
          )
        );
      } catch (e) {
        return ctx.reply(
          `⚠️ ${e.message}`,
          mainMenu()
        );
      }
    }
  });

  bot.action('mp:menu', async (ctx) => {
    await ctx.answerCbQuery();

    return showMarketplaces(
      ctx
    );
  });

  bot.action(/^mp:toggle:(.+)$/, async (ctx) => {
    const id =
      String(
        ctx.match[1]
      );

    const catalog =
      marketplaceCatalog();

    if (!catalog[id]) {
      return ctx.answerCbQuery(
        'Marketplace inválido.'
      );
    }

    let enabledNow =
      false;

    updateStore((s) => {
      const current =
        new Set(
          Array.isArray(
            s.enabledMarketplaces
          )
            ? s.enabledMarketplaces
            : []
        );

      if (
        current.has(id)
      ) {
        current.delete(id);
      } else {
        current.add(id);
        enabledNow = true;
      }

      s.enabledMarketplaces = [
        ...current
      ];

      return s;
    });

    await ctx.answerCbQuery(
      enabledNow
        ? 'Ativado'
        : 'Desativado'
    );

    return showMarketplaces(
      ctx
    );
  });

  bot.action('mp:add', async (ctx) => {
    drafts.set(
      ctx.from.id,
      {
        step:
          'marketplace_add_name',
        mode:
          'marketplace',
        data: {}
      }
    );

    await ctx.answerCbQuery(
      'Adicionar marketplace'
    );

    return ctx.reply(
      '➕ Qual marketplace você quer adicionar?\n\nEx.: Magalu, AliExpress, Temu.\n\nAmazon já aparece como opção pronta no menu de Marketplaces.',
      Markup.keyboard([
        [BTN.cancel]
      ]).resize()
    );
  });

  bot.action('mp:deletecustom', async (ctx) => {
    const custom =
      readStore()
        .customMarketplaces ||
      [];

    await ctx.answerCbQuery();

    if (!custom.length) {
      return ctx.reply(
        'Não há marketplace personalizado para excluir.'
      );
    }

    return ctx.reply(
      '🗑️ Qual marketplace personalizado você quer excluir?',
      Markup.inlineKeyboard(
        custom.map(
          (item) => [
            Markup.button.callback(
              `🗑️ ${item.name}`,
              `mp:delete:${item.id}`
            )
          ]
        )
      )
    );
  });

  bot.action(/^mp:delete:(.+)$/, async (ctx) => {
    const id =
      String(
        ctx.match[1]
      );

    updateStore((s) => {
      s.customMarketplaces =
        (
          s.customMarketplaces ||
          []
        ).filter(
          (x) =>
            x.id !== id
        );

      s.enabledMarketplaces =
        (
          s.enabledMarketplaces ||
          []
        ).filter(
          (x) =>
            x !== id
        );

      return s;
    });

    await ctx.answerCbQuery(
      'Excluído'
    );

    return showMarketplaces(
      ctx
    );
  });

  bot.action('mp:all', async (ctx) => {
    updateStore((s) => {
      s.enabledMarketplaces = [
        'shopee',
        'shein',
        'mercadolivre',
        'amazon',
        ...(
          s.customMarketplaces ||
          []
        ).map(
          (x) => x.id
        )
      ];

      return s;
    });

    await ctx.answerCbQuery(
      'Todos ativados'
    );

    return showMarketplaces(
      ctx
    );
  });

  bot.action('mp:none', async (ctx) => {
    updateStore((s) => {
      s.enabledMarketplaces =
        [];

      return s;
    });

    await ctx.answerCbQuery(
      'Todos desativados'
    );

    return showMarketplaces(
      ctx
    );
  });

  bot.action('filter:menu', async (ctx) => {
    await ctx.answerCbQuery();

    return showSearchFilters(
      ctx
    );
  });

  bot.action(/^filter:min:(\d+)$/, async (ctx) => {
    const value =
      Math.max(
        50,
        Number(
          ctx.match[1] ||
          50
        )
      );

    updateStore((s) => {
      s.searchFilters = {
        ...(s.searchFilters || {}),
        minSales:
          value
      };

      return s;
    });

    await ctx.answerCbQuery(
      `Mínimo ${value}`
    );

    return showSearchFilters(
      ctx
    );
  });

  bot.action(/^filter:limit:(\d+)$/, async (ctx) => {
    const value =
      Math.max(
        5,
        Math.min(
          20,
          Number(
            ctx.match[1] ||
            20
          )
        )
      );

    updateStore((s) => {
      s.searchFilters = {
        ...(s.searchFilters || {}),
        resultLimit:
          value
      };

      return s;
    });

    await ctx.answerCbQuery(
      `Até ${value} produtos`
    );

    return showSearchFilters(
      ctx
    );
  });

  bot.action('filter:broad', async (ctx) => {
    updateStore((s) => {
      const current =
        s.searchFilters
          ?.broadSearch !==
        false;

      s.searchFilters = {
        ...(s.searchFilters || {}),
        broadSearch:
          !current
      };

      return s;
    });

    await ctx.answerCbQuery(
      'Busca ampla atualizada'
    );

    return showSearchFilters(
      ctx
    );
  });

  bot.action(/^filter:sort:(.+)$/, async (ctx) => {
    const value =
      String(
        ctx.match[1]
      );

    if (
      ![
        'sales',
        'discount',
        'rating',
        'balanced'
      ].includes(value)
    ) {
      return ctx.answerCbQuery(
        'Filtro inválido.'
      );
    }

    updateStore((s) => {
      s.searchFilters = {
        ...(s.searchFilters || {}),
        sortBy:
          value
      };

      return s;
    });

    await ctx.answerCbQuery(
      'Ordenação atualizada'
    );

    return showSearchFilters(
      ctx
    );
  });

  bot.action(/^q:page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    return showQueueManager(
      ctx,
      Number(
        ctx.match[1]
      )
    );
  });

  bot.action(/^q:open:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    return showQueueItem(
      ctx,
      Number(
        ctx.match[1]
      ),
      Number(
        ctx.match[2]
      )
    );
  });

  bot.action(/^q:edittext:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    if (
      !readStore().queue?.[index]
    ) {
      return ctx.answerCbQuery(
        'Oferta não encontrada.'
      );
    }

    drafts.set(
      ctx.from.id,
      {
        step:
          'queue_edit_text',
        mode:
          'queue',
        data: {
          queueIndex:
            index,
          queuePage:
            page
        }
      }
    );

    await ctx.answerCbQuery(
      'Editar texto'
    );

    return ctx.reply(
      '✏️ Envie o NOVO texto completo dessa oferta.\n\nO link continuará separado e não precisa ser colocado no texto.',
      Markup.keyboard([
        [BTN.cancel]
      ]).resize()
    );
  });

  bot.action(/^q:editlink:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    if (
      !readStore().queue?.[index]
    ) {
      return ctx.answerCbQuery(
        'Oferta não encontrada.'
      );
    }

    drafts.set(
      ctx.from.id,
      {
        step:
          'queue_edit_link',
        mode:
          'queue',
        data: {
          queueIndex:
            index,
          queuePage:
            page
        }
      }
    );

    await ctx.answerCbQuery(
      'Editar link'
    );

    return ctx.reply(
      '🔗 Cole o NOVO link de afiliada que deve ser enviado nessa oferta.',
      Markup.keyboard([
        [BTN.cancel]
      ]).resize()
    );
  });

  bot.action(/^q:editphoto:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    if (
      !readStore().queue?.[index]
    ) {
      return ctx.answerCbQuery(
        'Oferta não encontrada.'
      );
    }

    drafts.set(
      ctx.from.id,
      {
        step:
          'queue_edit_photo',
        mode:
          'queue',
        data: {
          queueIndex:
            index,
          queuePage:
            page
        }
      }
    );

    await ctx.answerCbQuery(
      'Trocar foto'
    );

    return ctx.reply(
      '📸 Envie a nova foto dessa oferta.',
      Markup.keyboard([
        [BTN.cancel]
      ]).resize()
    );
  });

  bot.action(/^q:up:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    if (index <= 0) {
      return ctx.answerCbQuery(
        'Já está no topo.'
      );
    }

    moveQueueItem(
      index,
      index - 1
    );

    await ctx.answerCbQuery(
      'Subiu uma posição'
    );

    return showQueueItem(
      ctx,
      index - 1,
      page
    );
  });

  bot.action(/^q:down:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    const queue =
      readStore().queue ||
      [];

    if (
      index >=
      queue.length - 1
    ) {
      return ctx.answerCbQuery(
        'Já está no fim.'
      );
    }

    moveQueueItem(
      index,
      index + 1
    );

    await ctx.answerCbQuery(
      'Desceu uma posição'
    );

    return showQueueItem(
      ctx,
      index + 1,
      page
    );
  });

  bot.action(/^q:top:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    if (index <= 0) {
      return ctx.answerCbQuery(
        'Já está no topo.'
      );
    }

    moveQueueItem(
      index,
      0
    );

    await ctx.answerCbQuery(
      'Movida para o topo'
    );

    return showQueueItem(
      ctx,
      0,
      0
    );
  });

  bot.action(/^q:bottom:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const queue =
      readStore().queue ||
      [];

    if (
      index >=
      queue.length - 1
    ) {
      return ctx.answerCbQuery(
        'Já está no fim.'
      );
    }

    moveQueueItem(
      index,
      queue.length - 1
    );

    await ctx.answerCbQuery(
      'Movida para o fim'
    );

    const newIndex =
      queue.length - 1;

    return showQueueItem(
      ctx,
      newIndex,
      Math.floor(
        newIndex /
        8
      )
    );
  });

  bot.action(/^q:move:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    const queue =
      readStore().queue ||
      [];

    if (!queue[index]) {
      return ctx.answerCbQuery(
        'Oferta não encontrada.'
      );
    }

    drafts.set(
      ctx.from.id,
      {
        step:
          'queue_move_position',
        mode:
          'queue',
        data: {
          queueIndex:
            index,
          queuePage:
            page
        }
      }
    );

    await ctx.answerCbQuery(
      'Mover oferta'
    );

    return ctx.reply(
      `🔢 Digite a nova posição dessa oferta, de 1 a ${queue.length}.`,
      Markup.keyboard([
        [BTN.cancel]
      ]).resize()
    );
  });

  bot.action(/^q:delete:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    const item =
      readStore().queue?.[index];

    if (!item) {
      return ctx.answerCbQuery(
        'Oferta não encontrada.'
      );
    }

    await ctx.answerCbQuery();

    return ctx.reply(
      `🗑️ Excluir da fila?\n\n${queueItemTitle(
        item
      )}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sim, excluir',
            `q:deleteconfirm:${index}:${page}`
          ),
          Markup.button.callback(
            '❌ Não',
            `q:open:${index}:${page}`
          )
        ]
      ])
    );
  });

  bot.action(/^q:deleteconfirm:(\d+):(\d+)$/, async (ctx) => {
    const index =
      Number(
        ctx.match[1]
      );

    const page =
      Number(
        ctx.match[2]
      );

    updateStore((s) => {
      if (
        Array.isArray(
          s.queue
        ) &&
        s.queue[index]
      ) {
        s.queue.splice(
          index,
          1
        );
      }

      return s;
    });

    await ctx.answerCbQuery(
      'Excluída'
    );

    await ctx.reply(
      '🗑️ Oferta removida da fila.'
    );

    const queue =
      readStore().queue ||
      [];

    if (!queue.length) {
      return ctx.reply(
        '📦 A fila ficou vazia.',
        mainMenu()
      );
    }

    return showQueueManager(
      ctx,
      Math.min(
        page,
        Math.floor(
          (queue.length - 1) /
          8
        )
      )
    );
  });

  bot.action('results:shopee', async (ctx) => {
    await ctx.answerCbQuery('Consultando Shopee…');
    return showShopeeResults(ctx);
  });

  bot.action('results:menu', async (ctx) => {
    await ctx.answerCbQuery();
    return showResults(ctx);
  });

  bot.action('meli:cancel', async (ctx) => {
    drafts.delete(ctx.from.id);

    await ctx.answerCbQuery('Cancelado.');

    await ctx.editMessageText(
      '❌ Autorização do Mercado Livre cancelada.'
    );

    await ctx.reply(
      '💜 Painel da Auri',
      mainMenu()
    );
  });

  bot.action(/^coupon:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = String(ctx.match[1]);

    if (
      !d ||
      String(d.data.id) !== id
    ) {
      return ctx.answerCbQuery(
        'Sugestão expirou.'
      );
    }

    d.step =
      'suggestion_coupon';

    drafts.set(
      ctx.from.id,
      d
    );

    await ctx.answerCbQuery(
      'Adicionar cupom'
    );

    return ctx.reply(
      '🎟️ Envie o cupom EXATAMENTE como ele aparece no anúncio/app/painel oficial.\\n\\n' +
        'Pode ser o código (ex.: CUPOM10) ou a condição completa que você conferiu.\\n\\n' +
        'A Auri NÃO pesquisa nem inventa cupons por conta própria. Se não tiver, envie “Sem cupom”.',
      Markup.keyboard([
        ['Sem cupom'],
        [BTN.cancel]
      ]).resize()
    );
  });

  bot.action(/^couponremove:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = String(ctx.match[1]);

    if (
      !d ||
      String(d.data.id) !== id
    ) {
      return ctx.answerCbQuery(
        'Sugestão expirou.'
      );
    }

    if (d.data.product) {
      delete d.data.product.couponCode;
      delete d.data.product.coupon;
      d.data.product.couponVerified = false;
    }

    saveSuggestionDraft(d);

    d.step =
      'suggestion_review';

    drafts.set(
      ctx.from.id,
      d
    );

    await ctx.answerCbQuery(
      'Cupom removido'
    );

    return renderApprovalCard(
      ctx,
      d.data
    );
  });

  bot.action(/^affauto:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = String(ctx.match[1]);

    if (
      !d ||
      String(d.data.id) !== id
    ) {
      return ctx.answerCbQuery(
        'Sugestão expirou.'
      );
    }

    const product =
      d.data.product || {};

    const affiliateUrl =
      String(
        product.affiliateLink || ''
      ).trim();

    const verified =
      product.platform === 'shopee' &&
      product.affiliateLinkVerified === true &&
      Boolean(affiliateUrl);

    if (!verified) {
      return ctx.answerCbQuery(
        'Esse link automático não está confirmado. Use o seu link.'
      );
    }

    const draft = {
      step: 'confirm',
      mode: 'suggestion',
      data: {
        ...d.data,
        id,
        link: affiliateUrl,
        product,
        suggestionId:
          d.data.suggestionId ||
          id
      }
    };

    drafts.set(
      ctx.from.id,
      draft
    );

    await ctx.answerCbQuery(
      'Link automático selecionado'
    );

    await ctx.reply(
      '✅ Link automático selecionado. Confira a PRÉVIA FINAL antes de salvar na fila:',
      Markup.removeKeyboard()
    );

    return previewOffer(
      ctx,
      draft
    );
  });

  bot.action(/^aff:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = String(ctx.match[1]);

    if (
      !d ||
      String(d.data.id) !== id
    ) {
      return ctx.answerCbQuery(
        'Sugestão expirou.'
      );
    }

    d.step = 'suggestion_affiliate_link';
    drafts.set(ctx.from.id, d);

    await ctx.answerCbQuery(
      'Enviar link'
    );

    return ctx.reply(
      '🔗 Agora cole o SEU link de afiliada deste mesmo produto.\n\n' +
        'Se for Shopee, pode gerar/copiar pelo seu próprio painel para conferir. ' +
        'A Auri vai substituir somente o link e manter os dados reais do anúncio. ' +
        'Depois ela mostra a prévia final antes de salvar na fila.',
      Markup.keyboard([[BTN.cancel]]).resize()
    );
  });

  bot.action(/^ignore:(.+)$/, async (ctx) => {
    const id = String(ctx.match[1]);

    updateStore((s) => {
      s.suggestions = (s.suggestions || []).filter(
        (x) => String(x.id) !== id
      );
      return s;
    });

    drafts.delete(ctx.from.id);

    await ctx.answerCbQuery(
      'Ignorada'
    );

    try {
      await ctx.editMessageText(
        '❌ Sugestão ignorada.'
      );
    } catch {}

    const next =
      (readStore().suggestions || [])[0];

    if (next) {
      await ctx.reply(
        '➡️ Próxima da caixa:'
      );
      return renderApprovalCard(
        ctx,
        next
      );
    }

    return ctx.reply(
      '📥 Caixa de aprovação vazia.',
      mainMenu()
    );
  });

  bot.action(/^sugnext:(.+)$/, async (ctx) => {
    const id = String(ctx.match[1]);
    const list =
      readStore().suggestions || [];

    if (!list.length) {
      return ctx.answerCbQuery(
        'Caixa vazia.'
      );
    }

    const index = list.findIndex(
      (x) => String(x.id) === id
    );

    const nextIndex =
      index >= 0
        ? (index + 1) % list.length
        : 0;

    await ctx.answerCbQuery(
      'Próxima'
    );

    return renderApprovalCard(
      ctx,
      list[nextIndex]
    );
  });

  bot.action(/^photoedit:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = ctx.match[1];

    if (
      !d ||
      d.data.id !== id
    ) {
      return ctx.answerCbQuery(
        'Prévia expirou.'
      );
    }

    d.step = 'edit_photo';
    drafts.set(ctx.from.id, d);

    await ctx.answerCbQuery(
      'Enviar foto'
    );

    const rows = [];

    if (d.data.product?.imageUrl) {
      rows.push(['Usar foto automática']);
    }

    rows.push(['Sem foto']);
    rows.push([BTN.cancel]);

    return ctx.reply(
      '📸 Envie agora a foto que você quer usar nessa oferta.\n\n' +
        'Pode mandar qualquer foto do produto pelo Telegram. Ela vai substituir a imagem automática apenas nessa oferta.',
      Markup.keyboard(rows).resize()
    );
  });

  bot.action(/^edit:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = ctx.match[1];

    if (
      !d ||
      d.data.id !== id
    ) {
      return ctx.answerCbQuery(
        'Prévia expirou.'
      );
    }

    d.step = 'edit_text';
    drafts.set(ctx.from.id, d);

    await ctx.answerCbQuery(
      'Editar texto'
    );

    return ctx.reply(
      '✏️ Envie agora o texto COMPLETO que você quer usar.\n\n' +
        'Pode mudar título, emojis, preço destacado, descrição — o que quiser.\n\n' +
        'O link de afiliada NÃO precisa ser colocado no texto; a Auri adiciona automaticamente no envio.',
      Markup.keyboard([[BTN.cancel]]).resize()
    );
  });

  bot.action(/^approve:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = ctx.match[1];

    if (
      !d ||
      d.step !== 'confirm' ||
      d.data.id !== id
    ) {
      return ctx.answerCbQuery('Prévia expirou.');
    }

    if (isDuplicate(d.data.product, d.data.link)) {
      return ctx.answerCbQuery('Produto duplicado.');
    }

    enqueue(d.data);

    if (d.data.suggestionId) {
      updateStore((x) => {
        x.suggestions = (x.suggestions || []).filter(
          (item) =>
            String(item.id) !==
            String(d.data.suggestionId)
        );
        return x;
      });
    }

    drafts.delete(ctx.from.id);

    await ctx.answerCbQuery('Salvo!');

    await ctx.editMessageText(
      `✅ Oferta salva!\n📦 Posição na fila: ${readStore().queue.length}`
    );

    return ctx.reply(
      'Pode fechar o Telegram. Eu cuido do envio 💜',
      mainMenu()
    );
  });

  bot.action(/^regen:(.+)$/, async (ctx) => {
    const d = drafts.get(ctx.from.id);
    const id = ctx.match[1];

    if (!d || d.data.id !== id) {
      return ctx.answerCbQuery('Prévia expirou.');
    }

    await ctx.answerCbQuery('Gerando…');

    const previousText = d.data.text || '';
    const copy = await generateOfferCopy(
      d.data.product || {},
      regenerateInstruction(d, previousText)
    );

    d.data.text = copy.text;
    d.data.aiProvider = copy.provider;
    d.data.aiGenerated = true;

    saveSuggestionDraft(d);

    const waitingAffiliate =
      d.mode === 'suggestion-review' &&
      !(
        d.data.product?.affiliateLink ||
        (
          d.data.product?.platform === 'shopee' &&
          d.data.link
        )
      );

    if (waitingAffiliate) {
      d.step = 'suggestion_review';
      drafts.set(ctx.from.id, d);

      return renderApprovalCard(
        ctx,
        d.data
      );
    }

    return previewOffer(ctx, d);
  });

  bot.action(/^reject:/, async (ctx) => {
    drafts.delete(ctx.from.id);
    await ctx.answerCbQuery('Cancelado.');
    await ctx.editMessageText('❌ Oferta cancelada.');
    await ctx.reply('💜 Painel da Auri', mainMenu());
  });

  bot.action(/^sp:(.+)$/, async (ctx) => {
    const platform =
      ctx.match[1];

    await ctx.answerCbQuery();

    if (
      !automaticMarketplaces()
        .includes(
          platform
        )
    ) {
      return ctx.reply(
        '⚠️ Esse marketplace não está ativo para pesquisa automática. Para Amazon e marketplaces personalizados, use 🔗 Oferta por link.',
        mainMenu()
      );
    }

    const filters =
      searchFilterState();

    drafts.set(
      ctx.from.id,
      {
        step:
          'search_keyword',
        mode:
          'search',
        data: {
          platform
        }
      }
    );

    return ctx.reply(
      `${marketplaceLabel(platform)}\n\n` +
        'Digite o que quer procurar.\n' +
        'Ex.: perfume, vestido, cafeteira, mochila, skincare, cadeira, chocolate…\n\n' +
        `🎛️ Filtros: ${filters.minSales}+ vendas • até ${filters.resultLimit} produtos • ${filters.broadSearch ? 'busca ampla' : 'busca exata'}.`,
      Markup.keyboard([
        [BTN.cancel]
      ]).resize()
    );
  });

  bot.action(/^pick:(\d+)$/, async (ctx) => {
    const p = lastSearch[Number(ctx.match[1])];

    if (!p) {
      return ctx.answerCbQuery('Busca expirou.');
    }

    await ctx.answerCbQuery(
      'Abrindo Caixa de aprovação…'
    );

    const filters =
      searchFilterState();

    if (
      Number(
        p.sales || 0
      ) <
      filters.minSales
    ) {
      return ctx.reply(
        `⚠️ Esse produto foi bloqueado porque não tem ${filters.minSales}+ vendas confirmadas.`,
        mainMenu()
      );
    }

    const product = { ...p };

    const publicLink = String(
      product.productLink ||
      product.publicLink ||
      product.canonicalUrl ||
      ''
    ).trim();

    if (!publicLink) {
      return ctx.reply(
        '⚠️ Não consegui confirmar a página pública desse produto. Ele não será usado.',
        mainMenu()
      );
    }

    product.publicLink = publicLink;
    product.canonicalUrl =
      product.canonicalUrl || publicLink;
    product.salesVerified = true;
    product.factsVerified = true;

    if (product.platform === 'shopee') {
      const apiAffiliateLink = String(
        product.affiliateLink || ''
      ).trim();

      const affiliateVerified = Boolean(
        apiAffiliateLink &&
        apiAffiliateLink !== publicLink
      );

      product.affiliateLink =
        affiliateVerified
          ? apiAffiliateLink
          : '';

      product.affiliateLinkVerified =
        affiliateVerified;

      product.affiliateLinkSource =
        affiliateVerified
          ? 'offerLink'
          : '';

      product.dataSource =
        'Shopee Affiliate Open API';
    } else {
      product.affiliateLink = null;
      product.affiliateLinkVerified = false;
      product.affiliateLinkSource = '';
      product.dataSource =
        product.platform === 'mercadolivre'
          ? 'Mercado Livre API'
          : 'Página oficial SHEIN';
    }

    if (
      !Array.isArray(product.verifiedFacts) ||
      !product.verifiedFacts.length
    ) {
      product.verifiedFacts = [
        product.name
          ? `Nome do anúncio: ${product.name}`
          : null,
        Number(product.price || 0) > 0
          ? `Preço atual confirmado: R$ ${Number(product.price)
              .toFixed(2)
              .replace('.', ',')}`
          : null,
        Number(product.discountPct || 0) > 0
          ? `Desconto confirmado: ${Math.round(
              Number(product.discountPct)
            )}%`
          : null,
        Number(product.sales || 0) > 0
          ? `Vendas confirmadas: ${Number(
              product.sales
            ).toLocaleString('pt-BR')}`
          : null,
        Number(product.rating || 0) > 0
          ? `Nota confirmada: ${Number(product.rating)
              .toFixed(1)
              .replace('.', ',')}`
          : null,
        product.shopName
          ? `Loja confirmada: ${product.shopName}`
          : null
      ].filter(Boolean);
    }

    const copy = await generateOfferCopy(
      product,
      'Use somente os fatos verificados do produto. Não invente características, benefícios, urgência, cupom, frete ou detalhes.'
    );

    const item = {
      id: crypto.randomBytes(4).toString('hex'),
      text: copy.text,
      publicLink,
      link:
        product.affiliateLink ||
        publicLink,
      photoPath: null,
      product,
      aiGenerated: true,
      aiProvider: copy.provider,
      source: `search-${product.platform}`,
      createdAt: new Date().toISOString()
    };

    updateStore((s) => {
      s.suggestions = [
        item,
        ...(s.suggestions || [])
      ].slice(
        0,
        config.discoverySuggestionCap || 180
      );
      return s;
    });

    await ctx.reply(
      '📥 Produto colocado na Caixa de aprovação.\n\n' +
        (
          product.platform === 'shopee'
            ? 'Você pode conferir o link automático da Shopee ou substituí-lo pelo seu.'
            : 'Agora coloque o SEU link de afiliada antes de salvar na fila.'
        )
    );

    return renderApprovalCard(
      ctx,
      item
    );
  });


  bot.action(/^gt:(\d+):(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    const g = lastGroups[idx];

    if (!g) {
      return ctx.answerCbQuery('Lista expirou.');
    }

    const s = readStore();
    const current = [...(s.targetGroups || [])];
    const exists = current.some(
      (x) => x.jid === g.jid
    );

    setTargetGroups(
      exists
        ? current.filter((x) => x.jid !== g.jid)
        : [...current, g]
    );

    await ctx.answerCbQuery(
      exists ? 'Removido' : 'Selecionado'
    );

    try {
      await ctx.editMessageReplyMarkup(
        (await buildGroupKeyboard(page)).reply_markup
      );
    } catch {}
  });

  async function buildGroupKeyboard(page = 0) {
    const s = readStore();
    const selected = new Set(
      (s.targetGroups || []).map((g) => g.jid)
    );

    const perPage = 12;
    const pages = Math.max(
      1,
      Math.ceil(lastGroups.length / perPage)
    );

    page = Math.max(
      0,
      Math.min(pages - 1, page)
    );

    const slice = lastGroups.slice(
      page * perPage,
      (page + 1) * perPage
    );

    const rows = slice.map((g) => [
      Markup.button.callback(
        `${selected.has(g.jid) ? '✅' : '⬜'} ${g.name} (${g.size})`,
        `gt:${lastGroups.indexOf(g)}:${page}`
      )
    ]);

    const nav = [];

    if (page > 0) {
      nav.push(
        Markup.button.callback('⬅️', `gp:${page - 1}`)
      );
    }

    nav.push(
      Markup.button.callback(`${page + 1}/${pages}`, 'noop')
    );

    if (page < pages - 1) {
      nav.push(
        Markup.button.callback('➡️', `gp:${page + 1}`)
      );
    }

    rows.push(nav);
    rows.push([
      Markup.button.callback('✅ Concluir', 'groups:done')
    ]);

    return Markup.inlineKeyboard(rows);
  }

  bot.action(/^gp:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    try {
      await ctx.editMessageReplyMarkup(
        (
          await buildGroupKeyboard(
            Number(ctx.match[1])
          )
        ).reply_markup
      );
    } catch {}
  });

  bot.action('groups:done', async (ctx) => {
    await ctx.answerCbQuery();

    const n = readStore().targetGroups.length;

    await ctx.editMessageText(
      `✅ ${n} grupo(s) selecionado(s).`
    );

    await ctx.reply(
      '💜 Painel da Auri',
      mainMenu()
    );
  });

  bot.action('noop', (ctx) =>
    ctx.answerCbQuery()
  );

  bot.action(/^ai:(.+)$/, async (ctx) => {
    const provider = ctx.match[1];

    updateStore((s) => {
      s.aiProvider = provider;
      return s;
    });

    await ctx.answerCbQuery('IA atualizada');
    await showAI(ctx);
  });

  bot.action('disc:toggle', async (ctx) => {
    updateStore((s) => {
      s.autoDiscovery = !s.autoDiscovery;
      return s;
    });

    await ctx.answerCbQuery();
    await showDiscovery(ctx);
  });

  bot.action('disc:now', async (ctx) => {
    await ctx.answerCbQuery('Buscando…');

    try {
      const list = await discoverWebOffers({
        force: true
      });

      await ctx.reply(
        `✅ Encontrei ${list.length} oportunidade(s).`,
        mainMenu()
      );
    } catch (e) {
      await ctx.reply(
        `⚠️ ${e.message}`,
        mainMenu()
      );
    }
  });

  bot.action('disc:suggestions', async (ctx) => {
    await ctx.answerCbQuery();
    return showSuggestions(ctx, 0);
  });

  bot.action(/^sugpage:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return showSuggestions(
      ctx,
      Number(ctx.match[1])
    );
  });

  bot.action(/^sug:(.+)$/, async (ctx) => {
    const id = String(ctx.match[1]);
    const s = readStore();

    let item =
      (s.suggestions || []).find(
        (x) => String(x.id) === id
      );

    if (!item && /^\d+$/.test(id)) {
      item =
        s.suggestions[Number(id)];
    }

    if (!item) {
      return ctx.answerCbQuery(
        'Sugestão expirou.'
      );
    }

    await ctx.answerCbQuery(
      'Abrindo…'
    );

    return renderApprovalCard(
      ctx,
      item
    );
  });

  bot.command('remover', async (ctx) => {
    const id = ctx.message.text.split(/\s+/)[1];

    if (!id) {
      return ctx.reply('Use /remover ID');
    }

    removeFromQueue(id);

    return ctx.reply(
      '🗑️ Removida, se o ID existia.',
      mainMenu()
    );
  });

  bot.catch((err) =>
    console.error('Telegram:', err)
  );

  bot.launch();

  console.log('🤖 Auri conectada ao Telegram.');

  process.once('SIGINT', () =>
    bot.stop('SIGINT')
  );

  process.once('SIGTERM', () =>
    bot.stop('SIGTERM')
  );

  return bot;
}
