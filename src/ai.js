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
  if (Array.isArray(product?.verifiedFacts) && product.verifiedFacts.length) {
    return product.verifiedFacts.map(String).filter(Boolean);
  }
  const out = [];
  if (product?.name) out.push(`Nome: ${product.name}`);
  if (money(product?.price)) out.push(`Preço: ${money(product.price)}`);
  if (Number(product?.sales || 0) > 0) {
    out.push(`Vendas: ${Number(product.sales).toLocaleString('pt-BR')}`);
  }
  if (Number(product?.rating || 0) > 0) {
    out.push(`Nota: ${Number(product.rating).toFixed(1).replace('.', ',')}`);
  }
  return out;
}

export function fallbackOfferCopy(product) {
  const name = String(product?.name || 'Produto').trim();
  const price = money(product?.price);
  const old = money(product?.originalPrice);
  const sales = Number(product?.sales || 0);
  const rating = Number(product?.rating || 0);
  const discount = Number(product?.discountPct || 0);

  const titles = [
    `👀 OLHA ESSE ${name.toUpperCase()}`,
    `🔥 ACHEI ESSE ${name.toUpperCase()}`,
    `🛍️ PRA QUEM TAVA PROCURANDO ${name.toUpperCase()}`,
    `😳 OLHA O VALOR DESSE ${name.toUpperCase()}`
  ];

  const lines = [titles[Math.floor(Math.random() * titles.length)]];
  if (old && price && Number(product.originalPrice) > Number(product.price)) {
    lines.push(`\nDe ~${old}~ por *${price}*`);
  } else if (price) {
    lines.push(`\n*${price}*`);
  }
  if (discount > 0) {
    lines.push(`\n🔥 *${Math.round(discount)}% DE DESCONTO*`);
  }
  if (sales > 0) {
    lines.push(`\n🛒 ${sales.toLocaleString('pt-BR')} vendas confirmadas`);
  }
  if (rating > 0) {
    lines.push(`\n⭐ Nota ${rating.toFixed(1).replace('.', ',')}`);
  }
  return lines.join('\n');
}

export async function generateOfferCopy(product, extra = '') {
  const verified = facts(product);

  const prompt = `Escreva uma mensagem CURTA para um grupo brasileiro de achadinhos no WhatsApp.

REGRA ABSOLUTA:
Use SOMENTE fatos presentes em FATOS VERIFICADOS.
Não deduza, não complete e não invente nada.

FATOS VERIFICADOS:
${verified.map((x) => `- ${x}`).join('\n')}

FONTE: ${product?.dataSource || 'fonte verificada'}

ESTILO:
- título em CAIXA ALTA com 1 emoji;
- 3 a 7 blocos curtos;
- preço com *asteriscos*;
- mostre vendas confirmadas;
- mostre desconto/nota somente se constarem nos fatos;
- tom espontâneo, de achadinho.

PROIBIDO:
- inventar material, tamanho, cor, fragrância, benefício, uso, público, frete, cupom, desconto, urgência, originalidade ou qualidade;
- dizer "chique", "premium", "luxuoso", "confortável", "resistente", "perfeito" etc. se isso não estiver nos fatos;
- escrever link;
- escrever "Compre aqui";
- acrescentar qualquer detalhe ausente dos FATOS VERIFICADOS.

${extra ? `OBSERVAÇÃO: ${extra}` : ''}

Retorne SOMENTE a mensagem final.`;

  try {
    const result = await askAI(prompt);
    return {
      text: result.text || fallbackOfferCopy(product),
      provider: result.provider,
      fallback: false
    };
  } catch {
    return {
      text: fallbackOfferCopy(product),
      provider: 'local',
      fallback: true
    };
  }
}
