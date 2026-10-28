import { startTelegram } from './telegram.js';
import { startWhatsApp } from './whatsapp.js';
import { startScheduler } from './scheduler.js';

const token =
  process.env
    .TELEGRAM_BOT_TOKEN;

const adminId =
  process.env
    .TELEGRAM_ADMIN_ID;

if (!token) {
  throw new Error(
    'TELEGRAM_BOT_TOKEN não configurado.'
  );
}

if (!adminId) {
  throw new Error(
    'TELEGRAM_ADMIN_ID não configurado.'
  );
}

const bot =
  startTelegram({
    token,
    adminId
  });

startScheduler({
  telegram:
    bot.telegram,
  adminId
});

startWhatsApp()
  .catch(
    (e) =>
      console.error(
        'WhatsApp inicial:',
        e.message
      )
  );
