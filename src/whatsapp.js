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

const logger = pino({ level: 'silent' });
let sock = null;
let connected = false;
let reconnectTimer = null;
let authRegistered = false;

export function isWhatsAppConnected() {
  return connected;
}

export async function startWhatsApp() {
  const baseDir = process.env.PERSIST_DIR ? path.resolve(process.env.PERSIST_DIR) : path.resolve('.');
  const authDir = path.join(baseDir, 'wa_auth');
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  authRegistered = Boolean(state.creds?.registered);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    authRegistered = Boolean(sock?.authState?.creds?.registered);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscaneie este QR no WhatsApp > Aparelhos conectados:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      connected = true;
      authRegistered = true;
      console.log('✅ WhatsApp conectado.');
    }

    if (connection === 'close') {
      connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(loggedOut ? '❌ WhatsApp desconectado da conta.' : '⚠️ WhatsApp caiu; tentando reconectar...');

      if (!loggedOut && !reconnectTimer) {
        reconnectTimer = setTimeout(async () => {
          reconnectTimer = null;
          try { await startWhatsApp(); } catch (e) { console.error(e); }
        }, 5000);
      }
    }
  });

  return sock;
}


export async function requestWhatsAppPairingCode(phoneNumber) {
  if (!sock) throw new Error('WhatsApp ainda não foi inicializado.');
  if (connected || authRegistered || sock?.authState?.creds?.registered) {
    throw new Error('Este WhatsApp já está conectado.');
  }

  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Número inválido. Envie com DDI e DDD, somente números. Ex.: 5544999999999');
  }

  const code = await sock.requestPairingCode(digits);
  return String(code || '').replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

export async function listWhatsAppGroups() {
  if (!sock || !connected) throw new Error('WhatsApp ainda não está conectado.');
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g) => ({ jid: g.id, name: g.subject || 'Grupo sem nome', size: g.participants?.length || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function sendOfferToGroup(groupJid, item) {
  if (!sock || !connected) throw new Error('WhatsApp não conectado.');
  if (!groupJid) throw new Error('Nenhum grupo foi escolhido.');

  const caption = [item.text?.trim(), item.link?.trim()].filter(Boolean).join('\n\n');

  if (item.photoPath && fs.existsSync(item.photoPath)) {
    const image = fs.readFileSync(item.photoPath);
    await sock.sendMessage(groupJid, { image, caption });
  } else {
    await sock.sendMessage(groupJid, { text: caption });
  }
}
