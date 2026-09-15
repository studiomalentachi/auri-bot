import { readStore } from './store.js';

function providerOrder() {
  const chosen = readStore().aiProvider || process.env.AI_PROVIDER || 'auto';
  if (chosen !== 'auto') return [chosen];
  return ['openai', 'gemini', 'anthropic'];
}

export function availableAIProviders() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY)
  };
}

function cleanText(s) {
  return String(s || '')
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY não configurada');

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 650
    })
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
  }

  if (json.output_text) return cleanText(json.output_text);

  const text = json?.output
    ?.flatMap((x) => x.content || [])
    .map((x) => x.text || '')
    .join('\n');

  return cleanText(text);
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message || `Gemini HTTP ${res.status}`);
  }

  return cleanText(
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('\n')
  );
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
      max_tokens: 650,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);
  }

  return cleanText(json?.content?.map((c) => c.text || '').join('\n'));
}

export async function askAI(prompt) {
  const errors = [];

  for (const p of providerOrder()) {
    try {
      if (p === 'openai' && process.env.OPENAI_API_KEY) {
        return { text: await callOpenAI(prompt), provider: 'openai' };
      }

      if (p === 'gemini' && process.env.GEMINI_API_KEY) {
        return { text: await callGemini(prompt), provider: 'gemini' };
      }

      if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
        return { text: await callAnthropic(prompt), provider: 'anthropic' };
      }
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }

  throw new Error(
    errors.length ? errors.join(' | ') : 'Nenhuma IA configurada'
  );
}

function money(v) {
  const n = Number(v);

  return Number.isFinite(n) && n > 0
    ? n.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      })
    : null;
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

function verifiedCoupon(product) {
  const code =
    product?.couponCode ||
    product?.voucherCode ||
    product?.coupon ||
    null;

  if (!code) return null;
  if (product?.couponVerified === false) return null;

  return String(code).trim() || null;
}

export function fallbackOfferCopy(product) {
  const price = money(product.price || product.priceMin);
  const rating = Number(product.rating || 0);
  const sales = Number(product.sales || 0);
  const name = isPlaceholderName(product.name)
    ? ''
    : String(product.name).trim();
  const coupon = verifiedCoupon(product);

  const title = name
    ? `😍 OLHA ESSE ACHADO: ${
        name.length > 52 ? `${name.slice(0, 49)}...` : name
      }`
    : '😍 OLHA ESSE ACHADO QUE EU ENCONTREI';

  const lines = [title.toUpperCase()];

  if (price) {
    lines.push(`\nTá saindo por ${price}.`);
  }

  lines.push(
    '\nÉ daqueles produtos bonitos e úteis que fazem diferença de verdade na rotina. Dá pra usar bastante e ainda tem aquele jeitinho de achado que parece bem mais caro do que custa 😂'
  );

  if (rating > 0 || sales > 0) {
    const bits = [];

    if (rating > 0) {
      bits.push(`⭐ ${rating.toFixed(1).replace('.', ',')}`);
    }

    if (sales > 0) {
      bits.push(`${sales.toLocaleString('pt-BR')} vendidos`);
    }

    lines.push(`\n${bits.join(' • ')}`);
  }

  if (coupon) {
    lines.push(`\n🎟️ Cupom: ${coupon}`);
  }

  return lines.join('\n');
}

export async function generateOfferCopy(product, extra = '') {
  const prompt = `Você escreve mensagens de ofertas para um grupo brasileiro de achadinhos no WhatsApp.

ESTILO OBRIGATÓRIO:
- Escreva como uma pessoa real indicando um produto para amigas, nunca como anúncio corporativo e nunca com cara de IA.
- O texto precisa ser mais completo, parecido com mensagens de grupo de promoções: de 5 a 9 linhas, com respiros entre os blocos.
- Comece com um título chamativo, espontâneo e ESPECÍFICO em caixa alta, com 1 emoji.
- Exemplos de tom: "🙋‍♀️ ISSO AQUI FACILITA MUITO ARRUMAR O CABELO", "🚨 ESSE JOGO DE TAÇAS TÁ LINDO DEMAIS", "😍 OLHA O QUE EU ACHEI PRA ORGANIZAR A COZINHA". Não copie esses títulos se não combinarem com o produto.
- Depois diga o que é o produto e o preço, se o preço estiver nos dados.
- Em seguida escreva 1 parágrafo natural de 2 a 3 frases explicando por que é útil, bonito, prático ou interessante.
- Use detalhes reais dos dados; não invente características.
- Se houver avaliação e/ou vendas, coloque uma linha separada com ⭐ e esses números.
- Se houver um cupom REAL E VERIFICADO nos dados, coloque uma linha separada: "🎟️ Cupom: CÓDIGO". Se não houver cupom verificado, NÃO mencione cupom.
- Pode usar humor leve e linguagem informal brasileira, tipo "pra quem...", "sem ficar...", "eu achei...", quando fizer sentido.
- Use de 2 a 5 emojis no texto inteiro, sem exagerar.

NUNCA FAÇA:
- Não escreva "Produto Shopee", "Produto SHEIN", "Produto Amazon", "Produto Mercado Livre" ou apenas "Produto" como título ou descrição.
- Não cite o nome do marketplace no texto, a menos que seja indispensável.
- Não use frases genéricas como "produto incrível", "imperdível", "você merece", "eleve sua rotina" ou "achadinho que vale a pena".
- Não invente preço, avaliação, quantidade vendida, desconto, cupom, frete, material, tamanho ou benefício.
- Não escreva o link e não escreva "Compre aqui"; o sistema adiciona o link depois.

DADOS DO PRODUTO:
${JSON.stringify(product, null, 2)}
${extra ? `\nOBSERVAÇÃO: ${extra}` : ''}

Retorne somente o texto final da oferta, sem explicações.`;

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
