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
  return String(s || '').trim().replace(/^```(?:text)?\s*/i, '').replace(/```$/, '').trim();
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY não configurada');
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: prompt, max_output_tokens: 450 })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
  if (json.output_text) return cleanText(json.output_text);
  const text = json?.output?.flatMap(x => x.content || []).map(x => x.text || '').join('\n');
  return cleanText(text);
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Gemini HTTP ${res.status}`);
  return cleanText(json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n'));
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
    body: JSON.stringify({ model, max_tokens: 450, messages: [{ role: 'user', content: prompt }] })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);
  return cleanText(json?.content?.map(c => c.text || '').join('\n'));
}

export async function askAI(prompt) {
  const errors = [];
  for (const p of providerOrder()) {
    try {
      if (p === 'openai' && process.env.OPENAI_API_KEY) return { text: await callOpenAI(prompt), provider: 'openai' };
      if (p === 'gemini' && process.env.GEMINI_API_KEY) return { text: await callGemini(prompt), provider: 'gemini' };
      if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return { text: await callAnthropic(prompt), provider: 'anthropic' };
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  throw new Error(errors.length ? errors.join(' | ') : 'Nenhuma IA configurada');
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
}

export function fallbackOfferCopy(product) {
  const price = money(product.price || product.priceMin);
  const rating = Number(product.rating || 0);
  const sales = Number(product.sales || 0);
  const title = product.name || 'ACHADINHO QUE VALE A PENA';
  const cleanTitle = title.length > 70 ? `${title.slice(0, 67)}...` : title;
  const lines = [`✨ ${cleanTitle.toUpperCase()}`];
  if (price) lines.push(`\nPor ${price}.`);
  lines.push('\nBonito, útil e com cara de achado que facilita a rotina sem gastar demais.');
  if (rating > 0 || sales > 0) {
    const bits = [];
    if (rating > 0) bits.push(`⭐ ${rating.toFixed(1).replace('.', ',')}`);
    if (sales > 0) bits.push(`${sales.toLocaleString('pt-BR')} vendidos`);
    lines.push(`\n${bits.join(' • ')}`);
  }
  return lines.join('\n');
}

export async function generateOfferCopy(product, extra = '') {
  const prompt = `Você escreve ofertas curtas para um grupo brasileiro de achadinhos no WhatsApp.
Tom: natural, feminino, direto, específico e espontâneo; não pareça texto de IA.
Não invente preço, avaliação, vendas, cupom, desconto ou benefício que não esteja nos dados.
Não escreva link e não escreva \"Compre aqui\"; o sistema adiciona o link depois.
Evite clichês excessivos. Pode usar 2 a 4 emojis no texto inteiro.
Estrutura desejada: título chamativo em 1 linha; preço se houver; 1 parágrafo curto de uso/benefício; prova social se houver.

DADOS DO PRODUTO:
${JSON.stringify(product, null, 2)}
${extra ? `\nOBSERVAÇÃO: ${extra}` : ''}

Retorne apenas o texto da oferta.`;
  try {
    const result = await askAI(prompt);
    return { text: result.text || fallbackOfferCopy(product), provider: result.provider, fallback: false };
  } catch {
    return { text: fallbackOfferCopy(product), provider: 'local', fallback: true };
  }
}
