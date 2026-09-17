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
  sendIntervalMinutes: Math.max(1, envInt('SEND_INTERVAL_MINUTES', 10)),
  groupDelayMinSeconds: Math.max(0, envInt('GROUP_DELAY_MIN_SECONDS', 60)),
  groupDelayMaxSeconds: Math.max(0, envInt('GROUP_DELAY_MAX_SECONDS', 120)),
  discoveryEveryMinutes: Math.max(60, envInt('AUTO_DISCOVERY_EVERY_MINUTES', 120)),
  discoveryMaxPerRun: Math.max(5, envInt('AUTO_DISCOVERY_MAX_PER_RUN', 20)),
  discoveryDailyTarget: Math.max(1, envInt('AUTO_DISCOVERY_DAILY_TARGET', 85)),
  discoverySuggestionCap: Math.max(50, envInt('AUTO_DISCOVERY_SUGGESTION_CAP', 180)),
  discoveryMinSales: Math.max(101, envInt('AUTO_DISCOVERY_MIN_SALES', 101)),
  discoveryCategoriesPerRun: Math.max(2, Math.min(12, envInt('AUTO_DISCOVERY_CATEGORIES_PER_RUN', 8))),
  discoveryKeywords: env(
    'AUTO_DISCOVERY_KEYWORDS',
    [
      'alimentos','bebidas','café','cafés especiais','chocolate','doces','snacks','biscoitos','mercearia','temperos','molhos','massas','cereais','granola','chás','itens de café da manhã',
      'produtos de limpeza','limpeza de cozinha','limpeza de banheiro','limpeza pesada','lavanderia','sabão','detergente','amaciante','organizadores de limpeza','utilidades para limpeza',
      'decoração para casa','decoração elegante','decoração minimalista','decoração moderna','móveis','móveis para sala','móveis para quarto','móveis para escritório','mesas','cadeiras','poltronas','estantes','prateleiras','nichos','espelhos','tapetes','cortinas','almofadas','roupa de cama','cama mesa e banho','iluminação','luminárias','organização da casa','organizadores','utilidades domésticas',
      'cozinha','panelas','frigideiras','louças','copos','taças','talheres','potes','organizadores de cozinha','utensílios de cozinha','formas e assadeiras','garrafas','canecas','itens para café',
      'eletrodomésticos','eletroportáteis','air fryer','liquidificador','mixer','cafeteira','aspirador','ventilador','umidificador','ferro de passar','secador de cabelo',
      'tecnologia','eletrônicos','celulares e acessórios','capinhas de celular','carregadores','cabos','fones de ouvido','caixas de som','smartwatch','tablet e acessórios','computador e acessórios','notebook e acessórios','home office','suporte para notebook','suporte para monitor','teclado','mouse','webcam','luminária de mesa',
      'perfume feminino','perfume masculino','perfumes','maquiagem','base maquiagem','corretivo','batom','gloss','blush','máscara de cílios','paleta de maquiagem','pincéis de maquiagem','skincare','protetor solar','hidratante facial','sérum facial','limpeza facial','cuidados com a pele','beleza feminina','beleza masculina',
      'produtos para cabelo','shampoo','condicionador','máscara capilar','óleo capilar','leave-in','protetor térmico','escova de cabelo','modelador de cabelo','chapinha','secador','acessórios de cabelo',
      'moda feminina','roupa feminina','vestidos','blusas femininas','calças femininas','saias','conjuntos femininos','alfaiataria feminina','roupa fitness feminina','pijamas femininos','lingerie','sapato feminino','tênis feminino','sandália feminina','chinelo feminino','bolsa feminina','mochila feminina','carteira feminina','acessórios femininos','óculos feminino','brincos','colares','pulseiras',
      'moda masculina','roupa masculina','camiseta masculina','camisa masculina','calça masculina','bermuda masculina','conjunto masculino','roupa fitness masculina','pijama masculino','sapato masculino','tênis masculino','chinelo masculino','mochila masculina','carteira masculina','relógio masculino','acessórios masculinos','barbear e cuidados masculinos',
      'bebê','itens para bebê','roupa de bebê','infantil','roupa infantil','calçado infantil','brinquedos','brinquedos educativos','material escolar infantil','maternidade',
      'pet','cachorro','gato','cama pet','brinquedo pet','comedouro pet','bebedouro pet','acessórios pet','higiene pet',
      'papelaria','material escolar','cadernos','canetas','marca-texto','estojos','mochilas','organizadores de mesa','estudo',
      'automotivo','acessórios para carro','organização de carro','suporte de celular para carro','limpeza automotiva',
      'fitness','academia','esporte','acessórios fitness','garrafa fitness','roupa de academia','tapete de yoga','faixas elásticas',
      'viagem','mala de viagem','mochila de viagem','necessaire','organizador de mala','acessórios de viagem',
      'presentes','itens úteis','produtos bonitos e úteis','produtos elegantes','achados chiques','achados baratos','produtos populares','itens sazonais'
    ].join(',')
  ).split(',').map((x) => x.trim()).filter(Boolean)
};
