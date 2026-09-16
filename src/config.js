export function env(name, fallback = '') {
  return process.env[name] ?? fallback;
}

export function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(raw);
}

export const config = {
  timezone: env('TZ', 'America/Sao_Paulo'),
  include22: envBool('INCLUDE_22', true),

  // 08:00 até 22:00, incluindo os dois extremos:
  // 14h = 840 min; 840/10 + 1 = 85 horários.
  sendIntervalMinutes: Math.max(
    1,
    envInt('SEND_INTERVAL_MINUTES', 10)
  ),

  groupDelayMinSeconds: Math.max(
    0,
    envInt('GROUP_DELAY_MIN_SECONDS', 60)
  ),
  groupDelayMaxSeconds: Math.max(
    0,
    envInt('GROUP_DELAY_MAX_SECONDS', 120)
  ),

  // Pesquisa em lotes. 12 por rodada x até 8 rodadas/dia
  // = até 96 candidatas antes de deduplicar/filtrar.
  discoveryEveryMinutes: Math.max(
    60,
    envInt('AUTO_DISCOVERY_EVERY_MINUTES', 60)
  ),
  discoveryMaxPerRun: Math.max(
    3,
    envInt('AUTO_DISCOVERY_MAX_PER_RUN', 6)
  ),
  discoveryDailyTarget: Math.max(
    1,
    envInt('AUTO_DISCOVERY_DAILY_TARGET', 85)
  ),
  discoverySuggestionCap: Math.max(
    30,
    envInt('AUTO_DISCOVERY_SUGGESTION_CAP', 140)
  ),

  // Três temas por rodada para variar muito ao longo do dia.
  discoveryCategoriesPerRun: Math.max(
    1,
    Math.min(
      6,
      envInt('AUTO_DISCOVERY_CATEGORIES_PER_RUN', 2)
    )
  ),

  discoveryKeywords: env(
    'AUTO_DISCOVERY_KEYWORDS',
    [
      'alimentos',
      'bebidas',
      'doces e snacks',
      'café e mercearia',
      'produtos de limpeza',
      'lavanderia',
      'casa',
      'decoração',
      'cozinha',
      'organização',
      'banheiro',
      'utilidades domésticas',
      'beleza',
      'maquiagem',
      'skincare',
      'cabelo',
      'higiene pessoal',
      'moda feminina',
      'moda masculina',
      'calçados',
      'bolsas e acessórios',
      'bebê',
      'infantil',
      'brinquedos',
      'papelaria',
      'material escolar',
      'tecnologia',
      'eletrônicos',
      'celular e acessórios',
      'home office',
      'computadores e acessórios',
      'pet',
      'automotivo',
      'ferramentas',
      'fitness',
      'esporte',
      'viagem',
      'malas e organização de viagem',
      'jardim',
      'organização de carro',
      'itens sazonais',
      'presentes',
      'achados baratos',
      'produtos úteis do dia a dia'
    ].join(',')
  )
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
};
