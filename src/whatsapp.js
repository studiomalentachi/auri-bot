import fs from 'node:fs';
import path from 'node:path';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import { config } from './config.js';

const logger = pino({ level: 'silent' });
let sock = null;
let connected = false;
let reconnectTimer = null;
let authRegistered = false;
let pendingPairing = null;
let pairingTimeout = null;

export function isWhatsAppConnected() { return connected; }

function getAuthDir() {
  const baseDir = process.env.PERSIST_DIR ? path.resolve(process.env.PERSIST_DIR) : path.resolve('.');
  return path.join(baseDir, 'wa_auth');
}

function clearAuthFiles() {
  try { fs.rmSync(getAuthDir(), { recursive: true, force: true }); } catch {}
}

function clearPairing(error = null, code = null) {
  if (pairingTimeout) clearTimeout(pairingTimeout);
  pairingTimeout = null;
  const p = pendingPairing;
  pendingPairing = null;
  if (!p) return;
  error ? p.reject(error) : p.resolve(code);
}

async function createSocket() {
  const authDir = getAuthDir();
  fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  authRegistered = Boolean(state.creds?.registered);
  const { version } = await fetchLatestBaileysVersion();
  const localSock = makeWASocket({
    version, auth: state, logger, browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false, syncFullHistory: false
  });
  sock = localSock;

  localSock.ev.on('creds.update', async () => {
    await saveCreds();
    authRegistered = Boolean(state.creds?.registered);
  });

  localSock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && pendingPairing && !state.creds?.registered) {
      try {
        const code = await localSock.requestPairingCode(pendingPairing.digits);
        clearPairing(null, String(code || '').replace(/(.{4})/g, '$1-').replace(/-$/, ''));
      } catch (e) { console.error('Pareamento:', e?.message || e); }
    } else if (qr && !pendingPairing) {
      console.log('\nQR disponível para pareamento manual:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      connected = true; authRegistered = true;
      console.log('✅ WhatsApp conectado.');
    }

    if (connection === 'close') {
      connected = false;
      if (sock !== localSock) return;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      if (loggedOut) {
        if (pendingPairing) clearPairing(new Error('O WhatsApp encerrou a sessão. Gere um novo código.'));
        return;
      }
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(async () => {
          reconnectTimer = null;
          try { await createSocket(); } catch (e) { console.error('Reconexão WhatsApp:', e?.message || e); }
        }, pendingPairing ? 1500 : 5000);
      }
    }
  });
  return localSock;
}

export async function startWhatsApp() { return sock || createSocket(); }

async function freshPairingSocket() {
  const old = sock;
  sock = null; connected = false; authRegistered = false;
  clearAuthFiles();
  try { old?.ws?.close(); } catch {}
  return createSocket();
}

export async function requestWhatsAppPairingCode(phoneNumber) {
  if (connected || authRegistered) throw new Error('Este WhatsApp já está conectado.');
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) throw new Error('Número inválido. Use DDI + DDD + número, somente números.');
  if (pendingPairing) clearPairing(new Error('Solicitação substituída por uma nova.'));
  return new Promise(async (resolve, reject) => {
    pendingPairing = { digits, resolve, reject };
    pairingTimeout = setTimeout(() => clearPairing(new Error('O WhatsApp demorou para liberar o pareamento. Tente novamente.')), 45000);
    try { await freshPairingSocket(); } catch (e) { clearPairing(e); }
  });
}

export async function listWhatsAppGroups() {
  if (!sock || !connected) throw new Error('WhatsApp ainda não está conectado.');
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map(g => ({ jid: g.id, name: g.subject || 'Grupo sem nome', size: g.participants?.length || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(a, b) {
  const min = Math.min(a, b), max = Math.max(a, b);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function formatOfferMessage(item) {
  const text = String(item.text || '').trim();
  const link = String(item.link || item.product?.affiliateLink || '').trim();
  return link ? `${text}\n\n🛍️ Compre aqui: ${link}` : text;
}

export async function sendOfferToGroups(groups, item) {
  if (!sock || !connected) throw new Error('WhatsApp não conectado.');
  if (!groups?.length) throw new Error('Nenhum grupo foi escolhido.');
  const caption = formatOfferMessage(item);
  let sent = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (item.photoPath && fs.existsSync(item.photoPath)) {
      await sock.sendMessage(g.jid, { image: fs.readFileSync(item.photoPath), caption });
    } else if (item.product?.imageUrl) {
      try {
        const res = await fetch(item.product.imageUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          await sock.sendMessage(g.jid, { image: buf, caption });
        } else await sock.sendMessage(g.jid, { text: caption });
      } catch { await sock.sendMessage(g.jid, { text: caption }); }
    } else {
      await sock.sendMessage(g.jid, { text: caption });
    }
    sent += 1;
    if (i < groups.length - 1) {
      const secs = randomBetween(config.groupDelayMinSeconds, config.groupDelayMaxSeconds);
      await sleep(secs * 1000);
    }
  }
  return sent;
}

// compatibilidade com versão anterior
export async function sendOfferToGroup(groupJid, item) {
  return sendOfferToGroups([{ jid: groupJid, name: 'Grupo' }], item);
}
