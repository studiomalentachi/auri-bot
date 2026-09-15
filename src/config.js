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
  discoveryEveryMinutes: Math.max(30, envInt('AUTO_DISCOVERY_EVERY_MINUTES', 120)),
  discoveryMaxPerRun: Math.max(1, envInt('AUTO_DISCOVERY_MAX_PER_RUN', 3)),
  discoveryMinScore: Math.max(0, envInt('AUTO_DISCOVERY_MIN_SCORE', 58)),
  discoveryKeywords: env('AUTO_DISCOVERY_KEYWORDS', 'casa bonita,organização,cozinha,beleza,moda feminina,acessórios,home office,tecnologia,utilidades,infantil')
    .split(',').map(x => x.trim()).filter(Boolean)
};
