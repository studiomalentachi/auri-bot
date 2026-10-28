import { issueToken } from './lib/auth.mjs';

export default async (request) => {
  if (request.method !== 'POST') return new Response('Método inválido', { status:405 });
  const body = await request.json().catch(()=>({}));
  const expected = process.env.DASHBOARD_PASSWORD || '';
  if (!expected || body.password !== expected) return Response.json({ ok:false, error:'Senha incorreta' }, { status:401 });
  return Response.json({ ok:true, token: issueToken() });
};
