import { readStore, updateStore } from './store.js';

function cleanText(s) {
  return String(s || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/```$/, '').trim();
}

export function availableAIProviders() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY)
  };
}

function providerOrder() {
  const chosen = readStore().aiProvider || process.env.AI_PROVIDER || 'auto';
  if (chosen !== 'auto') return [chosen];
  if (process.env.GEMINI_API_KEY) return ['gemini'];
  if (process.env.ANTHROPIC_API_KEY) return ['anthropic'];
  return [];
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');

  const models = [...new Set([
    process.env.GEMINI_MODEL,
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite'
  ].filter(Boolean))];

  const errors = [];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500 }
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        errors.push(`${model}: ${json?.error?.message || `HTTP ${res.status}`}`);
        continue;
      }
      const text = cleanText(json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n'));
      if (text) return text;
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'Gemini indisponível');
}

async function callAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);
  }
  return cleanText(json?.content?.map((x) => x.text || '').join('\n'));
}

export async function askAI(prompt) {
  const errors = [];
  for (const p of providerOrder()) {
    try {
      if (p === 'gemini') return { text: await callGemini(prompt), provider: 'gemini' };
      if (p === 'anthropic') return { text: await callAnthropic(prompt), provider: 'anthropic' };
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'Nenhuma IA disponível');
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null;
}

function facts(product) {
  const out =
    Array.isArray(product?.verifiedFacts) &&
    product.verifiedFacts.length
      ? product.verifiedFacts
          .map(String)
          .filter(Boolean)
      : [];

  if (!out.length) {
    if (product?.name) {
      out.push(`Nome: ${product.name}`);
    }

    if (money(product?.price)) {
      out.push(
        `Preço: ${money(product.price)}`
      );
    }

    if (Number(product?.sales || 0) > 0) {
      out.push(
        `Vendas: ${Number(product.sales).toLocaleString('pt-BR')}`
      );
    }

    if (Number(product?.rating || 0) > 0) {
      out.push(
        `Nota: ${Number(product.rating).toFixed(1).replace('.', ',')}`
      );
    }
  }

  const coupon =
    String(
      product?.couponCode ||
      product?.coupon ||
      ''
    ).trim();

  if (
    product?.couponVerified === true &&
    coupon &&
    !out.some(
      (x) =>
        String(x)
          .toLowerCase()
          .includes('cupom')
    )
  ) {
    out.push(
      `Cupom informado e confirmado pela usuária: ${coupon}`
    );
  }

  return out;
}

function cleanProductName(value) {
  const raw =
    String(
      value ||
      'Produto'
    )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  if (
    raw.length <= 150
  ) {
    return raw;
  }

  const cut =
    raw.slice(
      0,
      150
    );

  const lastSpace =
    cut.lastIndexOf(
      ' '
    );

  return (
    lastSpace > 90
      ? cut.slice(
          0,
          lastSpace
        )
      : cut
  ).trim();
}

function verifiedPrice(product) {
  return money(
    product?.price
  );
}

function verifiedDiscount(product) {
  const pct =
    Number(
      product?.discountPct ||
      0
    );

  return (
    Number.isFinite(
      pct
    ) &&
    pct > 0
  )
    ? Math.round(pct)
    : 0;
}

function verifiedRating(product) {
  const rating =
    Number(
      product?.rating ||
      0
    );

  return (
    Number.isFinite(
      rating
    ) &&
    rating > 0
  )
    ? rating
    : 0;
}

const OFFER_TITLES = {
  shopee: [
    'PREÇO DESPENCOU NA SHÔ 👀🔥',
    'NESSE PREÇO É LOUCURAAA 🤯',
    'ACHADINHO NA SHÔ 🛍️✨',
    'OLHA ESSA OFERTA NA SHÔ 👀',
    'TÁ VALENDO MUITO 🔥',
    'ACHADO DO DIA NA SHÔ ✨'
  ],
  mercadolivre: [
    'PREÇO BAIXOU NO ML 👀🔥',
    'ACHADINHO NO MERCADO LIVRE 💛',
    'OLHA ESSA OFERTA NO ML 🛒',
    'NESSE PREÇO VALE DEMAIS 🤯',
    'ACHADO DO DIA NO ML ✨',
    'OFERTA BOA NO MERCADO LIVRE 🔥'
  ],
  shein: [
    'ACHADINHO NA SHEIN 🖤✨',
    'OLHA ESSA OFERTA NA SHEIN 👀',
    'PREÇO BOM NA SHEIN 🔥',
    'ACHEI ISSO NA SHEIN 😍',
    'ACHADO DO DIA NA SHEIN ✨',
    'VALE DAR UMA OLHADA 🖤'
  ],
  generic: [
    'ACHADINHO 🛍️',
    'OLHA ESSE ACHADO 👀',
    'NESSE PREÇO É LOUCURAAA 🤯',
    'ACHADO DO DIA ✨',
    'OFERTA BOA DEMAIS 🔥',
    'PASSANDO PRA DEIXAR ESSE ACHADO ✨'
  ]
};

function titleBank(product) {
  const platform =
    String(
      product?.platform ||
      ''
    ).toLowerCase();

  return (
    OFFER_TITLES[platform] ||
    OFFER_TITLES.generic
  );
}

function nextTitle(product) {
  const custom =
    String(
      product?.customTitle ||
      ''
    ).trim();

  if (custom) {
    return custom;
  }

  const bank =
    titleBank(product);

  let selected =
    bank[0];

  updateStore((s) => {
    const current =
      Number(
        s.copyTitleIndex || 0
      );

    selected =
      bank[
        current %
        bank.length
      ];

    s.copyTitleIndex =
      current + 1;

    return s;
  });

  return selected;
}

function verifiedOriginalPrice(product) {
  const oldPrice =
    Number(
      product?.originalPrice ||
      0
    );

  const current =
    Number(
      product?.price ||
      0
    );

  return (
    Number.isFinite(oldPrice) &&
    Number.isFinite(current) &&
    oldPrice > current &&
    current > 0
  )
    ? money(oldPrice)
    : null;
}

function verifiedCoupon(product) {
  const coupon =
    String(
      product?.couponCode ||
      product?.coupon ||
      ''
    ).trim();

  return (
    product?.couponVerified === true &&
    coupon
  )
    ? coupon
    : '';
}

export function fallbackOfferCopy(product) {
  const title =
    nextTitle(product);

  const name =
    cleanProductName(
      product?.name
    );

  const price =
    verifiedPrice(product);

  const oldPrice =
    verifiedOriginalPrice(
      product
    );

  const discount =
    verifiedDiscount(product);

  const rating =
    verifiedRating(product);

  const coupon =
    verifiedCoupon(product);

  const lines = [
    title,
    '',
    name,
    ''
  ];

  if (oldPrice) {
    lines.push(
      `De: ~${oldPrice}~`
    );
    lines.push('');
  }

  if (price) {
    lines.push(
      `Por: *${price}* ✅`
    );
  }

  // Se não houver preço antigo confirmado, ainda podemos mostrar
  // a porcentagem oficial de desconto, quando ela existir.
  if (
    !oldPrice &&
    discount > 0
  ) {
    lines.push(
      `Desconto: ${discount}%`
    );
  }

  if (coupon) {
    lines.push('');
    lines.push(
      `🎟️ Use cupom *${coupon}*`
    );
  }

  if (rating > 0) {
    lines.push('');
    lines.push(
      `Nota: ${rating
        .toFixed(1)
        .replace('.', ',')}`
    );
  }

  return lines
    .join('\n')
    .trim();
}

export async function generateOfferCopy(
  product,
  extra = ''
) {
  // O texto do WhatsApp segue um formato fixo.
  // A variação fica no título.
  // O link é acrescentado automaticamente pelo whatsapp.js.
  return {
    text:
      fallbackOfferCopy(
        product
      ),
    provider:
      'local-format',
    fallback:
      false
  };
}
