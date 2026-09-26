import { readStore } from './store.js';

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

const OFFER_TITLES = [
  'ACHADINHO 🛍️',
  'OLHA ESSE ACHADO 👀',
  'ACHEI ISSO AQUI 😍',
  'ACHADO DO DIA ✨',
  'OFERTA BOA DEMAIS 🔥',
  'OLHA O QUE EU ACHEI 🛒',
  'ESSE VALE O CLIQUE 👀',
  'PASSANDO PRA DEIXAR ESSE ACHADO ✨',
  'ENCONTREI ESSE AQUI 🛍️',
  'ACHADINHO DA VEZ 💜'
];

function nextTitle(product) {
  const seed =
    String(
      product?.itemId ||
      product?.name ||
      Date.now()
    );

  let hash = 0;

  for (
    let i = 0;
    i < seed.length;
    i += 1
  ) {
    hash =
      (
        hash * 31 +
        seed.charCodeAt(i)
      ) >>> 0;
  }

  const jitter =
    Math.floor(
      Math.random() *
      OFFER_TITLES.length
    );

  return OFFER_TITLES[
    (
      hash +
      jitter
    ) %
    OFFER_TITLES.length
  ];
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

  const discount =
    verifiedDiscount(product);

  const rating =
    verifiedRating(product);

  const lines = [
    title,
    '',
    name,
    ''
  ];

  if (price) {
    lines.push(
      `Por: *${price}*`
    );
  }

  if (discount > 0) {
    lines.push(
      `Desconto: ${discount}%`
    );
  }

  if (rating > 0) {
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
