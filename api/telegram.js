import { draftPost, scoreNote, MIN_DRAFT_SCORE } from '../lib/gemini.js';
import { sendMessage, sendTyping, webhookSecret } from '../lib/telegram.js';

// Telegram webhook: POST /api/telegram
export async function POST(request) {
  // Telegram echoes back the secret that /api/setup registered, so fake requests are rejected.
  if (request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret()) {
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
  // Optional lock: when ALLOWED_CHAT_ID is set, only that chat gets drafts.
  const allowed = process.env.ALLOWED_CHAT_ID;
  if (allowed && String(chatId) !== String(allowed)) return;

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

  // Guardrail: score the note first; only notes scoring MIN_DRAFT_SCORE or higher get drafted.
  const verdict = await scoreNote(text);
  if (!verdict) {
    // Fail closed: an unreadable score never lets a note through.
    await sendMessage(chatId, "I didn't create a draft because I couldn't score this note. Please send it again.");
    return;
  }
  console.log(`Note scored ${verdict.score}/10: ${verdict.reason}`);
  if (verdict.score < MIN_DRAFT_SCORE) {
    await sendMessage(
      chatId,
      `I didn't create a draft because this note isn't substantive enough yet: ${verdict.reason}`,
    );
    return;
  }

  const draft = await draftPost(text);
  await sendMessage(chatId, draft);
}

function ok() {
  return new Response('ok');
}
