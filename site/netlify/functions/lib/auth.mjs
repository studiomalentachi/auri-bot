import crypto from 'node:crypto';

function secret() {
  return process.env.DASHBOARD_SESSION_SECRET || process.env.DASHBOARD_PASSWORD || '';
}

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function issueToken() {
  const s = secret();
  if (!s) throw new Error('DASHBOARD_PASSWORD não configurada');
  const payload = { exp: Date.now() + 12 * 60 * 60 * 1000 };
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', s).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  try {
    const s = secret();
    if (!s || !token) return false;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', s).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig || ''), Buffer.from(expected))) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return Number(payload.exp) > Date.now();
  } catch { return false; }
}

export function isWorkerAuthorized(event) {
  const expected = process.env.AURI_WORKER_TOKEN || '';
  const received = event.headers?.['x-auri-worker-token'] || event.headers?.['X-Auri-Worker-Token'] || '';
  return Boolean(expected && received && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected)));
}
