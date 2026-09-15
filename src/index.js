import 'dotenv/config';
import { startWhatsApp } from './whatsapp.js';
import { startScheduler } from './scheduler.js';
import { startTelegram } from './telegram.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = process.env.TELEGRAM_ADMIN_ID;
const timezone = process.env.TZ || 'America/Sao_Paulo';
const include22 = String(process.env.INCLUDE_22 || 'false').toLowerCase() === 'true';

if (!token || token.includes('COLE_SEU_TOKEN')) {
  console.error('❌ Configure TELEGRAM_BOT_TOKEN no arquivo .env');
  process.exit(1);
}
if (!adminId) {
  console.error('❌ Configure TELEGRAM_ADMIN_ID no arquivo .env');
  process.exit(1);
}

console.log('🚀 Iniciando Auri...');
await startWhatsApp();
startScheduler({ timezone, include22 });
startTelegram({ token, adminId });
