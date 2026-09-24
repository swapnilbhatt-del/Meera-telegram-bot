// Points the Telegram bot at the deployed Vercel function.
//   npm run set-webhook    register the webhook
//   npm run webhook-info   show what Telegram currently has (incl. last error)
import { telegramApi } from '../lib/telegram.js';

const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_URL } = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

if (process.argv.includes('--info')) {
  console.log(await telegramApi('getWebhookInfo', {}));
  process.exit(0);
}

if (!TELEGRAM_WEBHOOK_SECRET || !PUBLIC_URL) {
  console.error('Missing TELEGRAM_WEBHOOK_SECRET or PUBLIC_URL in .env');
  process.exit(1);
}

const url = `${PUBLIC_URL.replace(/\/$/, '')}/api/telegram`;

await telegramApi('setWebhook', {
  url,
  secret_token: TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ['message'],
  drop_pending_updates: true,
});

console.log(`Webhook set to ${url}`);
