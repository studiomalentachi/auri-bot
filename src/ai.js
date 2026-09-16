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
      max_output_tokens: 500
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
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);
  }

  return cleanText(
    json?.content?.map((c) => c.text || '').join('\n')
  );
}

export async function askAI(prompt) {
  const errors = [];

  for (const p of providerOrder()) {
    try {
      if (p === 'openai' && process.env.OPENAI_API_KEY) {
        return {
          text: await callOpenAI(prompt),
          provider: 'openai'
        };
      }

      if (p === 'gemini' && process.env.GEMINI_API_KEY) {
        return {
          text: await callGemini(prompt),
          provider: 'gemini'
        };
      }

      if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
        return {
          text: await callAnthropic(prompt),
          provider: 'anthropic'
        };
      }
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }

  throw new Error(
    errors.length
      ? errors.join(' | ')
      : 'Nenhuma IA configurada'
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

function discountData(product) {
  const current = Number(product.price || product.priceMin || 0);
  const old = Number(product.originalPrice || product.priceBefore || 0);
  const pct = Number(product.discountPct || 0);

  return {
    current,
    old,
    pct:
      pct > 0
        ? pct
        : old > current && current > 0
          ? ((old - current) / old) * 100
          : 0
  };
}

function shortProductName(name) {
  const s = String(name || '').trim();
  if (!s) return 'esse achado';

  return s.length > 52
    ? `${s.slice(0, 49)}...`
    : s;
}

function platformName(product) {
  const p = String(product?.platform || '').toLowerCase();

  if (p === 'shopee') return 'Shopee';
  if (p === 'shein') return 'SHEIN';
  if (p === 'mercadolivre') return 'Mercado Livre';
  if (p === 'amazon') return 'Amazon';

  return '';
}

export function fallbackOfferCopy(product, extra = '') {
  const name = isPlaceholderName(product.name)
    ? ''
    : shortProductName(product.name);

  const price = money(product.price || product.priceMin);
  const coupon = verifiedCoupon(product);
  const { current, old, pct } = discountData(product);

  const regen = String(extra || '').match(/NOVA VERSÃO Nº\s*(\d+)/i);
  const variant = regen
    ? Math.max(0, Number(regen[1]) - 1) % 10
    : Math.floor(Math.random() * 10);

  const n = name || 'esse achado';
  const upper = n.toUpperCase();
  const platform = platformName(product);

  const titles = [
    `😍 ${upper} NESSE PREÇO?`,
    `👀 OLHA ESSE ${upper}`,
    `🔥 O PREÇO DESSE ${upper} ME PEGOU`,
    `🤭 NESSE PREÇO EU IA PELO MENOS ABRIR PRA VER KKKK`,
    `✨ UM ${upper} QUE NÃO PASSA BATIDO`,
    `🙋‍♀️ PRA QUEM TAVA PROCURANDO ${upper}: OLHA ISSO`,
    `🛍️ ACHEI ${upper} E O VALOR TÁ BOM`,
    `💸 ${price ? `${price} E OLHA ISSO` : `OLHA ESSE ${upper}`}`,
    `😳 GENTE, OLHA O VALOR DESSE ${upper}`,
    `🔥 ${platform ? `${platform.toUpperCase()}: ` : ''}${upper}`
  ];

  const lines = [titles[variant]];

  if (old > current && current > 0) {
    lines.push(
      `\nDe ~${money(old)}~ por *${money(current)}*${pct > 0 ? ` 😱` : ''}`
    );
  } else if (price) {
    lines.push(`\n*${price}*`);
  }

  if (pct > 0) {
    lines.push(`\n🔥 *${Math.round(pct)}% DE DESCONTO*`);
  }

  const featureBits = [];

  if (product.webReason) {
    featureBits.push(String(product.webReason).trim());
  }

  if (product.description) {
    featureBits.push(String(product.description).trim());
  }

  if (product.features && Array.isArray(product.features)) {
    featureBits.push(...product.features.slice(0, 2));
  }

  const generic = [
    `Pra quem já estava de olho em ${n.toLowerCase()}, eu abriria pra conferir os detalhes.`,
    `É o tipo de coisa que chama atenção mais pelo conjunto: produto útil + preço fácil de comparar.`,
    `Se você já queria algo assim, vale abrir e olhar as opções disponíveis.`,
    `Achei interessante justamente por ser simples, direto e com preço que chama atenção.`,
    `Pra quem gosta de garimpar antes de comprar, esse merece uma olhada.`,
    `Eu salvaria o link pra comparar depois, principalmente se já estava procurando algo desse tipo.`,
    `Tem cara de produto que resolve uma busca específica sem complicação.`,
    `Esse é daqueles que eu mandaria no grupo porque alguém sempre tá procurando algo parecido.`,
    `Sem enrolar: o que chamou atenção aqui foi o produto + o valor.`,
    `Pra quem curte esse tipo de produto, vale abrir e conferir as variações.`
  ];

  const body =
    featureBits.find(Boolean) ||
    generic[variant];

  lines.push(`\n${body}`);

  if (Number(product.rating || 0) > 0 || Number(product.sales || 0) > 0) {
    const bits = [];

    if (Number(product.rating || 0) > 0) {
      bits.push(
        `⭐ ${Number(product.rating).toFixed(1).replace('.', ',')}`
      );
    }

    if (Number(product.sales || 0) > 0) {
      bits.push(
        `${Number(product.sales).toLocaleString('pt-BR')} vendidos`
      );
    }

    lines.push(`\n${bits.join(' • ')}`);
  }

  if (coupon) {
    lines.push(`\n🎟️ Cupom: *${coupon}*`);
  }

  return lines.join('\n');
}

export async function generateOfferCopy(product, extra = '') {
  const prompt = `Você escreve textos para um grupo brasileiro de achadinhos no WhatsApp.

REFERÊNCIA DE ESTILO:
Os textos devem parecer com aqueles achadinhos curtos, diretos e espontâneos que a pessoa manda no grupo quando acabou de encontrar algo interessante.

ESTRUTURA QUE EU QUERO:
- Texto CURTO. Normalmente 4 a 7 blocos/linhas úteis, com espaços entre eles.
- Comece com um título espontâneo em CAIXA ALTA.
- O título deve ser específico para aquele produto.
- Use 1 ou 2 emojis no título.
- Pode usar humor leve e reação humana: "olha isso", "nesse preço eu ia pelo menos abrir pra ver kkkk", "pra quem tava procurando...", "olha o visual desse...", "pros pais de pet de plantão...", "isso aqui facilita muito...".
- Não use sempre a mesma fórmula. Varie bastante o jeito de abrir.
- Depois do título, vá direto ao produto.
- Se houver preço, ele deve aparecer bem visível.
- Use *asteriscos* para destacar preço, desconto e palavras importantes porque o WhatsApp mostra isso em negrito.
- Se houver preço anterior REAL, use formato semelhante a:
  De ~R$ 99,90~ por *R$ 47,98*
- Se houver desconto REAL, pode usar linha própria:
  🔥 *52% DE DESCONTO*
- Depois coloque apenas 1 ou 2 observações úteis sobre o produto.
- Essas observações precisam vir DOS DADOS: tamanho, material, variação, uso, característica, avaliação etc.
- Se os dados forem poucos, seja curto. NÃO encha linguiça.
- Se houver cupom REAL verificado, coloque em uma linha separada.
- Se houver avaliação/vendas reais, pode colocar numa linha curta com ⭐.
- O texto deve soar como uma indicação de amiga, não como copy profissional.

EXEMPLOS DE TOM E RITMO:
- "👟 UM TÊNIS BÁSICO QUE NÃO É SEM GRAÇA"
- "😎 R$ 27,90 E OLHA O VISUAL DESSE ÓCULOS"
- "💕 NESSE PREÇO EU IA PELO MENOS ABRIR PRA VER KKKK"
- "🐶 PROS PAIS DE PET DE PLANTÃO: OLHA ISSO"
- "🙋‍♀️ ISSO AQUI FACILITA MUITO..."
Esses exemplos servem só para TOM. Não copie se não combinar com o produto.

VARIAÇÃO:
- Alterne entre títulos focados em preço, uso, visual, público, surpresa e humor.
- Alguns textos podem ser bem curtinhos.
- Outros podem ter uma linha a mais quando houver informações úteis.
- Não repita frases prontas em todos os produtos.
- Quando eu pedir "gerar outro texto", mude de verdade o título, a ordem e a abordagem.

NUNCA FAÇA:
- Não invente urgência. Só diga "corre", "acaba rápido", "últimas unidades", "oferta relâmpago" ou semelhantes se isso estiver CONFIRMADO nos dados.
- Não invente preço, desconto, cupom, frete, avaliação, vendas, material, tamanho ou benefício.
- Não invente que um produto "é perfeito", "é incrível" ou "vai transformar sua rotina".
- Não use frases corporativas ou com cara de IA.
- Não use clichês como "imperdível", "você merece", "eleve sua rotina", "achadinho que vale a pena".
- Não faça parágrafos longos.
- Não coloque link.
- Não escreva "Compre aqui"; o sistema adiciona isso depois.
- Não escreva "Produto Shopee", "Produto SHEIN", "Produto Mercado Livre" etc.
- Pode mencionar o marketplace no título ocasionalmente, mas NÃO em todos os textos e somente se platform estiver nos dados.

DADOS DO PRODUTO:
${JSON.stringify(product, null, 2)}

${extra ? `OBSERVAÇÃO ADICIONAL:\n${extra}` : ''}

Retorne SOMENTE o texto final da oferta.`;

  try {
    const result = await askAI(prompt);

    return {
      text: result.text || fallbackOfferCopy(product, extra),
      provider: result.provider,
      fallback: false
    };
  } catch {
    return {
      text: fallbackOfferCopy(product, extra),
      provider: 'local',
      fallback: true
    };
  }
}
