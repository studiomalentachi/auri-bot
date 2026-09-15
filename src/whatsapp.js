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

let pendingPairing = null;
let pairingTimeout = null;

export function isWhatsAppConnected() {
  return connected;
}

function getAuthDir() {
  const baseDir = process.env.PERSIST_DIR
    ? path.resolve(process.env.PERSIST_DIR)
    : path.resolve('.');
  return path.join(baseDir, 'wa_auth');
}

function clearAuthFiles() {
  const authDir = getAuthDir();
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch (err) {
    console.error('Erro ao limpar sessão antiga do WhatsApp:', err?.message || err);
  }
}

function clearPairing(error = null, code = null) {
  if (pairingTimeout) {
    clearTimeout(pairingTimeout);
    pairingTimeout = null;
  }

  const pending = pendingPairing;
  pendingPairing = null;

  if (!pending) return;

  if (error) pending.reject(error);
  else pending.resolve(code);
}

async function createSocket() {
  const authDir = getAuthDir();
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  authRegistered = Boolean(state.creds?.registered);

  const { version } = await fetchLatestBaileysVersion();

  const localSock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock = localSock;

  localSock.ev.on('creds.update', async () => {
    await saveCreds();
    authRegistered = Boolean(state.creds?.registered);
  });

  localSock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && pendingPairing && !state.creds?.registered) {
      try {
        const code = await localSock.requestPairingCode(pendingPairing.digits);
        const formatted = String(code || '')
          .replace(/(.{4})/g, '$1-')
          .replace(/-$/, '');

        clearPairing(null, formatted);
      } catch (err) {
        console.error('Erro ao gerar código de pareamento:', err?.message || err);
      }
    } else if (qr && !pendingPairing) {
      console.log('\nQR disponível para pareamento manual:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      connected = true;
      authRegistered = true;
      console.log('✅ WhatsApp conectado.');
    }

    if (connection === 'close') {
      connected = false;

      if (sock !== localSock) return;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(
        loggedOut
          ? '❌ WhatsApp desconectado da conta.'
          : `⚠️ WhatsApp caiu (${statusCode || 'sem código'}); tentando reconectar...`
      );

      if (loggedOut) {
        if (pendingPairing) {
          clearPairing(new Error('O WhatsApp encerrou a sessão. Gere um novo código.'));
        }
        return;
      }

      if (!reconnectTimer) {
        reconnectTimer = setTimeout(async () => {
          reconnectTimer = null;
          try {
            await createSocket();
          } catch (e) {
            console.error('Erro ao reconectar WhatsApp:', e?.message || e);
          }
        }, pendingPairing ? 1500 : 5000);
      }
    }
  });

  return localSock;
}

export async function startWhatsApp() {
  if (sock) return sock;
  return createSocket();
}

async function startFreshSocketForPairing() {
  const oldSock = sock;

  sock = null;
  connected = false;
  authRegistered = false;

  // Remove chaves incompletas deixadas por tentativas anteriores de pareamento.
  clearAuthFiles();

  try {
    oldSock?.ws?.close();
  } catch {
    // o socket antigo pode já estar fechado
  }

  return createSocket();
}

export async function requestWhatsAppPairingCode(phoneNumber) {
  if (connected || authRegistered) {
    throw new Error('Este WhatsApp já está conectado.');
  }

  const digits = String(phoneNumber || '').replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 15) {
    throw new Error(
      'Número inválido. Envie com DDI e DDD, somente números. Ex.: 5544999999999'
    );
  }

  if (pendingPairing) {
    clearPairing(new Error('A solicitação anterior foi substituída por uma nova.'));
  }

  return new Promise(async (resolve, reject) => {
    pendingPairing = { digits, resolve, reject };

    pairingTimeout = setTimeout(() => {
      clearPairing(
        new Error('O WhatsApp demorou para liberar o pareamento. Toque em WhatsApp e tente novamente.')
      );
    }, 45000);

    try {
      await startFreshSocketForPairing();
    } catch (err) {
      clearPairing(err);
    }
  });
}

export async function listWhatsAppGroups() {
  if (!sock || !connected) {
    throw new Error('WhatsApp ainda não está conectado.');
  }

  const groups = await sock.groupFetchAllParticipating();

  return Object.values(groups)
    .map((g) => ({
      jid: g.id,
      name: g.subject || 'Grupo sem nome',
      size: g.participants?.length || 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function sendOfferToGroup(groupJid, item) {
  if (!sock || !connected) {
    throw new Error('WhatsApp não conectado.');
  }

  if (!groupJid) {
    throw new Error('Nenhum grupo foi escolhido.');
  }

  const text = item.text?.trim() || '';
const link = item.link?.trim() || '';

const caption = link
  ? `${text}\n\n🛍️ Compre aqui: ${link}`
  : text;

  if (item.photoPath && fs.existsSync(item.photoPath)) {
    const image = fs.readFileSync(item.photoPath);
    await sock.sendMessage(groupJid, { image, caption });
  } else {
    await sock.sendMessage(groupJid, { text: caption });
  }
}
