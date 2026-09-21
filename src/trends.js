import { config } from './config.js';
import { readStore } from './store.js';
import {
  searchShopeeOffersBroad
} from './shopee.js';
import {
  searchSheinOffers
} from './discovery.js';
import {
  searchMarketplace
} from './marketplaces.js';
import {
  getBrazilSeasonalContext
} from './seasonality.js';

const BANNED =
  /\b(beb[eê]|bebes|bebês|maternidade|gestante|amamenta(?:ção|cao)|fralda|mamadeira|chupeta|berço|berco|carrinho de bebê|carrinho de bebe)\b/i;

const POOLS = {
  shopee: [
    'bolsa estruturada feminina',
    'perfume árabe feminino',
    'skincare coreano',
    'joias minimalistas',
    'jogo de cama premium',
    'cafeteira inox',
    'air fryer',
    'robô aspirador',
    'cadeira ergonômica',
    'mesa lateral',
    'rack para tv',
    'organizador de cozinha',
    'luminária de mesa',
    'fone bluetooth',
    'smartwatch',
    'mochila elegante',
    'taças de vidro',
    'panelas cerâmica',
    'aspirador portátil',
    'sapateira'
  ],

  mercadolivre: [
    'cafeteira',
    'robô aspirador',
    'air fryer',
    'microondas',
    'cooktop',
    'máquina de lavar',
    'cadeira ergonômica',
    'rack para tv',
    'mesa de jantar',
    'aspirador de pó',
    'fone bluetooth',
    'smartwatch',
    'kit ferramentas',
    'acessórios automotivos',
    'perfume importado feminino',
    'café especial',
    'panela elétrica',
    'ventilador',
    'purificador de água',
    'mixer'
  ],

  shein: [
    'bolsa estruturada',
    'alfaiataria feminina',
    'vestido midi',
    'joias minimalistas',
    'óculos feminino',
    'tênis casual feminino',
    'conjunto feminino',
    'skincare',
    'maquiagem',
    'necessaire',
    'organizador de maquiagem',
    'decoração minimalista',
    'luminária decorativa',
    'organizador de cozinha',
    'itens para home office',
    'acessórios de cabelo',
    'carteira feminina',
    'mochila feminina',
    'roupa fitness feminina',
    'itens de viagem'
  ]
};

function localDateParts() {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  )
    .formatToParts(new Date())
    .reduce(
      (acc, part) => {
        acc[part.type] = part.value;
        return acc;
      },
      {}
    );

  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    br: `${parts.day}/${parts.month}`
  };
}

function daySeed() {
  const { iso } = localDateParts();

  return [...iso]
    .reduce(
      (acc, ch) =>
        acc +
        ch.charCodeAt(0),
      0
    );
}

function rotatePool(
  list,
  count,
  offset = 0
) {
  if (!list.length) {
    return [];
  }

  const start =
    (
      daySeed() +
      offset
    ) %
    list.length;

  const out = [];

  for (
    let i = 0;
    i < Math.min(
      count,
      list.length
    );
    i += 1
  ) {
    out.push(
      list[
        (
          start + i
        ) %
        list.length
      ]
    );
  }

  return out;
}

function minSales() {
  const s = readStore();

  return Math.max(
    50,
    Number(
      s.searchFilters?.minSales ||
      config.discoveryMinSales ||
      50
    )
  );
}

function validProduct(
  product,
  minimum
) {
  if (!product) {
    return false;
  }

  const title =
    String(
      product.name ||
      ''
    ).trim();

  return Boolean(
    title &&
    !BANNED.test(title) &&
    Number(
      product.sales ||
      0
    ) >= minimum
  );
}

function bestSales(rows) {
  return Math.max(
    0,
    ...rows.map(
      (x) =>
        Number(
          x.sales || 0
        )
    )
  );
}

async function searchOne(
  platform,
  term,
  minimum
) {
  try {
    if (
      platform ===
      'shopee'
    ) {
      const rows =
        await searchShopeeOffersBroad(
          term,
          {
            minSales:
              minimum,
            desired:
              3,
            pages:
              2,
            limitPerPage:
              20,
            sortType:
              5,
            broadSearch:
              true,
            sortBy:
              'sales'
          }
        );

      return rows.filter(
        (x) =>
          validProduct(
            x,
            minimum
          )
      );
    }

    if (
      platform ===
      'mercadolivre'
    ) {
      const rows =
        await searchMarketplace(
          'mercadolivre',
          term,
          3
        );

      return rows.filter(
        (x) =>
          validProduct(
            x,
            minimum
          )
      );
    }

    if (
      platform ===
      'shein'
    ) {
      const rows =
        await searchSheinOffers(
          term,
          3
        );

      return rows.filter(
        (x) =>
          validProduct(
            x,
            minimum
          )
      );
    }
  } catch {}

  return [];
}

async function collectPlatform(
  platform,
  terms,
  minimum
) {
  const confirmed = [];

  for (
    const term of
    terms
  ) {
    if (
      BANNED.test(term)
    ) {
      continue;
    }

    const rows =
      await searchOne(
        platform,
        term,
        minimum
      );

    if (!rows.length) {
      continue;
    }

    confirmed.push({
      term,
      sales:
        bestSales(rows),
      example:
        rows
          .sort(
            (a, b) =>
              Number(
                b.sales || 0
              ) -
              Number(
                a.sales || 0
              )
          )[0]
    });
  }

  return confirmed
    .sort(
      (a, b) =>
        b.sales -
        a.sales
    )
    .slice(
      0,
      config.trendsTermsPerMarketplace
    );
}

function platformSection(
  title,
  rows
) {
  const lines = [
    title
  ];

  if (!rows.length) {
    lines.push(
      '• sem termos confirmados nesta rodada'
    );

    return lines.join(
      '\n'
    );
  }

  for (
    const row of
    rows
  ) {
    lines.push(
      `• ${row.term}`
    );
  }

  return lines.join(
    '\n'
  );
}

function priorityTerms(
  all
) {
  const seen =
    new Set();

  return all
    .flat()
    .sort(
      (a, b) =>
        b.sales -
        a.sales
    )
    .filter(
      (x) => {
        const key =
          x.term
            .toLowerCase()
            .trim();

        if (
          !key ||
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);
        return true;
      }
    )
    .slice(
      0,
      5
    )
    .map(
      (x) =>
        x.term
    );
}

export async function buildTrendDigest() {
  const minimum =
    minSales();

  const seasonal =
    getBrazilSeasonalContext(
      config.timezone
    );

  const seedCount =
    config
      .trendsSeedsPerMarketplace;

  // Em cada marketplace, algumas vagas de pesquisa são reservadas
  // para a época/estação atual. O restante continua variando ao longo
  // dos dias para o resumo não ficar repetitivo.
  const seasonalSeeds =
    seasonal.keywords
      .filter(
        (x) =>
          !BANNED.test(x)
      )
      .slice(
        0,
        Math.min(
          3,
          seedCount
        )
      );

  const mergeSeeds = (
    platform,
    offset
  ) => {
    const normal =
      rotatePool(
        POOLS[platform],
        seedCount,
        offset
      );

    return [
      ...new Set([
        ...seasonalSeeds,
        ...normal
      ])
    ].slice(
      0,
      Math.max(
        seedCount,
        seasonalSeeds.length
      )
    );
  };

  const shopeeTerms =
    mergeSeeds(
      'shopee',
      0
    );

  const mlTerms =
    mergeSeeds(
      'mercadolivre',
      7
    );

  const sheinTerms =
    mergeSeeds(
      'shein',
      13
    );

  const [
    shopee,
    mercadolivre,
    shein
  ] =
    await Promise.all([
      collectPlatform(
        'shopee',
        shopeeTerms,
        minimum
      ),
      collectPlatform(
        'mercadolivre',
        mlTerms,
        minimum
      ),
      collectPlatform(
        'shein',
        sheinTerms,
        minimum
      )
    ]);

  const priorities =
    priorityTerms([
      shopee,
      mercadolivre,
      shein
    ]);

  const date =
    localDateParts();

  const seasonalLabels =
    seasonal.labels
      .map(
        (x) =>
          String(x)
            .trim()
      )
      .filter(Boolean);

  const sections = [
    `📈 TENDÊNCIAS PARA PESQUISAR — ${date.br}`,
    '',
    `🌦️ MOMENTO DO ANO: ${seasonalLabels.join(' • ')}`,
    '',
    platformSection(
      '🧡 Shopee',
      shopee
    ),
    '',
    platformSection(
      '💛 Mercado Livre',
      mercadolivre
    ),
    '',
    platformSection(
      '🖤 SHEIN',
      shein
    )
  ];

  if (
    seasonalSeeds.length
  ) {
    sections.push(
      '',
      '📅 TERMOS SAZONAIS PARA FICAR DE OLHO:',
      seasonalSeeds.join(
        ' • '
      )
    );
  }

  if (
    priorities.length
  ) {
    sections.push(
      '',
      '⭐ VALE PESQUISAR PRIMEIRO:',
      priorities.join(
        ' • '
      )
    );
  }

  sections.push(
    '',
    `🔎 Auri conferiu produtos com ${minimum}+ vendas antes de sugerir os termos.`,
    '🚫 Maternidade e bebê ficam fora desta seleção.',
    '✨ A seleção considera também a estação do ano e períodos comerciais relevantes no Brasil.'
  );

  return {
    text:
      sections.join(
        '\n'
      ),
    date:
      date.iso,
    seasonal,
    counts: {
      shopee:
        shopee.length,
      mercadolivre:
        mercadolivre.length,
      shein:
        shein.length
    }
  };
}
