import { draftPost } from '../lib/gemini.js';
import { sendMessage, sendTyping } from '../lib/telegram.js';

// Telegram webhook: POST /api/telegram
export async function POST(request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const update = await request.json();
  const message = update.message;

  // Ignore edits, channel posts, button callbacks, etc.
  if (!message) return ok();

  const chatId = message.chat.id;

  try {
    await handleMessage(chatId, message);
  } catch (err) {
    console.error(err);
    await sendMessage(chatId, `Sorry, something went wrong making that draft.\n\n${err.message}`).catch(
      (sendErr) => console.error(sendErr),
    );
  }

  // Always 200 once authenticated, otherwise Telegram keeps retrying the same update.
  return ok();
}

// Lets you open the URL in a browser to confirm the deployment is live.
export function GET() {
  return new Response('Meera bot is running.');
}

async function handleMessage(chatId, message) {
  const allowed = process.env.ALLOWED_CHAT_ID;

  // Setup mode: until ALLOWED_CHAT_ID is set, just tell whoever messages what their chat ID is.
  if (!allowed) {
    await sendMessage(
      chatId,
      `Your chat ID is ${chatId}.\n\nSet ALLOWED_CHAT_ID=${chatId} in Vercel and redeploy to start receiving drafts.`,
    );
    return;
  }

  if (String(chatId) !== String(allowed)) return;

  const text = message.text?.trim();

  if (text === '/start') {
    await sendMessage(chatId, 'Hi Meera! Send me a note and I’ll send back a draft post.');
    return;
  }

  if (!text) {
    await sendMessage(chatId, 'I can only read text notes for now. Please type or paste your note.');
    return;
  }

  await sendTyping(chatId).catch(() => {});
  const draft = await draftPost(text);
  await sendMessage(chatId, draft);
}

function ok() {
  return new Response('ok');
}
