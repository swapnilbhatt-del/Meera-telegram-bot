import { telegramApi, webhookSecret } from '../lib/telegram.js';

// Open https://<your-app>.vercel.app/api/setup once in a browser to connect Telegram to this deployment.
export async function GET(request) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return new Response('TELEGRAM_BOT_TOKEN is not set in Vercel.', { status: 500 });
  }

  const url = `https://${new URL(request.url).host}/api/telegram`;

  try {
    await telegramApi('setWebhook', {
      url,
      secret_token: webhookSecret(),
      allowed_updates: ['message'],
    });
  } catch (err) {
    return new Response(`Could not connect Telegram: ${err.message}`, { status: 500 });
  }

  return new Response(`Done. Telegram now sends messages to ${url}`);
}
