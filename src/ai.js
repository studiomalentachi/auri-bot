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

function discountLabel(product) {
  const current = Number(product.price || product.priceMin || 0);
  const old = Number(product.originalPrice || product.priceBefore || 0);
  const pct = Number(product.discountPct || 0);

  if (old > current && current > 0) {
    return `De ${money(old)} por ${money(current)}`;
  }

  if (pct > 0) {
    return `${Math.round(pct)}% de desconto`;
  }

  return null;
}

export function fallbackOfferCopy(product, extra = '') {
  const price = money(product.price || product.priceMin);
  const rating = Number(product.rating || 0);
  const sales = Number(product.sales || 0);
  const name = isPlaceholderName(product.name)
    ? ''
    : String(product.name).trim();
  const coupon = verifiedCoupon(product);
  const discount = discountLabel(product);

  const regen = String(extra || '').match(/NOVA VERSÃO Nº\s*(\d+)/i);
  const variant = regen
    ? Math.max(0, Number(regen[1]) - 1) % 8
    : Math.floor(Math.random() * 8);

  const shortName = name
    ? (name.length > 48 ? `${name.slice(0, 45)}...` : name)
    : 'esse achado';

  const upperName = shortName.toUpperCase();

  const titles = [
    `😍 OLHA O QUE EU ACHEI: ${upperName}`,
    `👀 SE VOCÊ TAVA PROCURANDO ${upperName}, OLHA ISSO`,
    `🔥 O PREÇO DESSE ${upperName} ME CHAMOU ATENÇÃO`,
    `🫶 ESSE AQUI EU SALVARIA: ${upperName}`,
    `✨ PRA QUEM GOSTA DE COISA ÚTIL: ${upperName}`,
    `🤭 EU NÃO IA DEIXAR ESSE ${upperName} PASSAR BATIDO`,
    `🙋‍♀️ ALGUÉM MAIS TAVA PROCURANDO ${upperName}?`,
    `🛍️ ACHEI UMA OPÇÃO BOA DE ${upperName}`
  ];

  const priceLines = discount
    ? [
        `🔥 ${discount}`,
        `💸 ${discount}`,
        `🏷️ ${discount}`,
        `💰 ${discount}`,
        `🔥 Olha esse valor: ${discount}`,
        `💸 O preço ficou assim: ${discount}`,
        `🏷️ Tá saindo assim: ${discount}`,
        `💰 Valor agora: ${discount}`
      ]
    : price
      ? [
          `💰 Tá saindo por ${price}.`,
          `💸 Encontrei por ${price}.`,
          `🏷️ O valor agora é ${price}.`,
          `💰 Preço: ${price}.`,
          `💸 Vi por ${price}.`,
          `🏷️ Achei por ${price}.`,
          `💰 Está por ${price}.`,
          `💸 Valor atual: ${price}.`
        ]
      : [''];

  const paragraphs = [
    'Eu gosto desses achados que são fáceis de encaixar na rotina sem complicação. Se você já estava procurando algo assim, vale colocar na lista pra comparar.',
    'Esse me chamou atenção porque é o tipo de compra que tem uso de verdade no dia a dia. Sem inventar moda: é uma opção simples pra quem estava atrás desse tipo de produto.',
    'Sabe quando você encontra exatamente o tipo de coisa que já estava querendo pesquisar? Foi essa sensação aqui 😂 Eu salvaria o link pra não precisar procurar tudo de novo depois.',
    'Pra quem prefere coisa prática e funcional, esse é daqueles que fazem sentido olhar com calma. O valor também ajuda a deixar a comparação bem mais fácil.',
    'O que eu gostei foi a combinação de utilidade com um preço que dá pra comparar sem susto. Se estava na sua lista, esse merece pelo menos uma olhada.',
    'Achei uma opção interessante pra quem estava procurando esse tipo de produto sem querer perder horas pesquisando. Eu conferiria as avaliações e os detalhes antes de fechar, como sempre.',
    'Esse é o tipo de achado que eu mandaria no grupo porque pode resolver uma busca de alguém por aqui. Principalmente se você já tinha algo parecido salvo e estava esperando um valor melhor.',
    'Não vou inventar urgência onde não tem 😂 mas achei a opção interessante pelo conjunto das informações. Se faz sentido pra você, vale abrir e conferir os detalhes antes de comprar.'
  ];

  const lines = [titles[variant]];
  if (priceLines[variant]) lines.push(`\n${priceLines[variant]}`);
  lines.push(`\n${paragraphs[variant]}`);

  if (rating > 0 || sales > 0) {
    const bits = [];
    if (rating > 0) bits.push(`⭐ ${rating.toFixed(1).replace('.', ',')}`);
    if (sales > 0) bits.push(`${sales.toLocaleString('pt-BR')} vendidos`);
    lines.push(`\n${bits.join(' • ')}`);
  }

  if (coupon) lines.push(`\n🎟️ Cupom: ${coupon}`);
  return lines.join('\n');
}

export async function generateOfferCopy(product, extra = '') {
  const prompt = `Você escreve mensagens de ofertas para um grupo brasileiro de achadinhos no WhatsApp.

ESTILO OBRIGATÓRIO:
- Escreva como uma pessoa real indicando um produto para amigas.
- Nunca escreva como anúncio corporativo e nunca deixe o texto com cara de IA.
- Faça um texto de 5 a 9 linhas, com respiros entre os blocos.
- Comece com um título chamativo, espontâneo e ESPECÍFICO em caixa alta, com 1 emoji.
- Exemplos de TOM: "🙋‍♀️ ISSO AQUI FACILITA MUITO ARRUMAR O CABELO", "🚨 ESSE JOGO DE TAÇAS TÁ LINDO DEMAIS", "😍 OLHA O QUE EU ACHEI PRA ORGANIZAR A COZINHA". Não copie os exemplos se não combinarem com o produto.
- Fale claramente o preço atual quando existir.
- Se houver preço anterior e preço atual, destaque a mudança de preço de forma natural: "de R$ X por R$ Y".
- Se houver porcentagem de desconto, mencione o desconto.
- Se houver preço anterior E porcentagem, você pode usar os dois sem ficar repetitivo.
- Depois explique em 2 ou 3 frases por que o produto é bonito, útil, prático ou interessante.
- Use somente características presentes nos dados. Se os dados não informarem uma característica, não invente.
- Se houver avaliação e/ou vendas, coloque uma linha separada com ⭐.
- Se houver um cupom REAL informado nos dados, coloque uma linha separada: "🎟️ Cupom: ...".
- Se não houver cupom, NÃO fale sobre cupom.
- Pode usar humor leve e linguagem informal brasileira: "pra quem...", "sem ficar...", "eu achei...", quando fizer sentido.
- Use de 2 a 5 emojis no texto inteiro.
- A cada nova geração, mude de verdade a estrutura: não repita o mesmo título, não repita o mesmo parágrafo e não mantenha sempre preço + descrição na mesma fórmula.
- Alterne entre abordagens como reação espontânea, problema/solução, indicação para uma amiga, foco no preço, foco no uso, pergunta de abertura e comentário bem-humorado.

NUNCA FAÇA:
- Não escreva "Produto Shopee", "Produto SHEIN", "Produto Amazon", "Produto Mercado Livre" nem apenas "Produto".
- Não cite o marketplace no texto.
- Não use frases genéricas como "produto incrível", "imperdível", "você merece", "eleve sua rotina" ou "achadinho que vale a pena".
- Não invente preço, avaliação, vendas, desconto, cupom, frete, material, tamanho ou benefício.
- Não escreva link.
- Não escreva "Compre aqui"; o sistema adiciona isso depois.

DADOS DO PRODUTO:
${JSON.stringify(product, null, 2)}
${extra ? `\nOBSERVAÇÃO: ${extra}` : ''}

Retorne somente o texto final da oferta, sem explicações.`;

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
