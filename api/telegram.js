import { waitUntil } from '@vercel/functions';
import { draftPost, scoreNote, extractKeywords, MIN_DRAFT_SCORE } from '../lib/gemini.js';
import { searchNews } from '../lib/news.js';
import { sendMessage, sendTyping, webhookSecret, escapeHtml } from '../lib/telegram.js';

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

  // Answer Telegram straight away and draft in the background: drafting can take longer than
  // Telegram waits, and a timed-out webhook gets retried (duplicate drafts or none at all).
  const work = processMessage(message.chat.id, message).finally(() => pending.delete(work));
  pending.add(work);
  waitUntil(work);

  // Always 200 once authenticated, otherwise Telegram keeps retrying the same update.
  return ok();
}

// Background drafts still running. Tests await these; on Vercel, waitUntil keeps them alive.
export const pending = new Set();

async function processMessage(chatId, message) {
  try {
    await handleMessage(chatId, message);
  } catch (err) {
    console.error(err);
    await sendMessage(chatId, `Sorry, something went wrong making that draft.\n\n${err.message}`).catch(
      (sendErr) => console.error(sendErr),
    );
  }
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

  const news = await findNews(text);
  const draft = await draftPost(text, news);
  await sendMessage(chatId, formatReply(draft, verdict, news), { html: true });
}

// Bold headline, post, score, then Google News sources. Everything from Gemini is escaped.
export function formatReply(draft, verdict, news) {
  return [
    draft.headline && `<b>${escapeHtml(draft.headline)}</b>`,
    escapeHtml(draft.post),
    escapeHtml(scoreFooter(verdict)),
    sourcesFooter(draft, news),
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Note keywords -> Google News RSS. Best effort: any failure means drafting without news.
async function findNews(note) {
  const extracted = await extractKeywords(note);
  if (!extracted) return [];
  const [first, second] = extracted.keywords;
  const either = [first, second].filter(Boolean).join(' OR ');
  // Narrowest first, widening until something turns up, so almost every draft has a news link.
  const attempts = [
    [extracted.query, '30d'],
    [either, '30d'],
    [first, '30d'],
    [either, '1y'],
  ];
  const tried = new Set();
  for (const [query, window] of attempts) {
    if (tried.has(`${query}|${window}`)) continue;
    tried.add(`${query}|${window}`);
    const news = await searchNews(query, window);
    if (news.length) {
      console.log(`News for [${extracted.keywords.join(', ')}] via "${query}" (${window}): ${news.length} headline(s)`);
      return news;
    }
  }
  console.log(`News for [${extracted.keywords.join(', ')}]: nothing found`);
  return [];
}

// Appended to every draft so Meera can see how strong the note was.
export function scoreFooter({ score, reason }) {
  return `———\nNote score: ${score}/10\n${reason}`;
}

// Listed after the score so Meera can check anything the draft took from Google News.
// Returns HTML: each headline links to its Google News article.
export function sourcesFooter({ sources, confirmed }, news) {
  if (!news.length) return 'Sources: none (no related Google News found)';
  let heading = 'Sources used from Google News:';
  let list = sources;
  if (!confirmed) {
    heading = "Google News headlines given to the draft (it didn't say which it used, so check all of them):";
  } else if (!sources.length) {
    heading = 'Related Google News (not used in the post):';
    list = news;
  }
  const items = list.map((n, i) => {
    const meta = [n.source, n.published].filter(Boolean).join(', ') || 'unknown source';
    return `${i + 1}. <a href="${escapeHtml(n.link)}">${escapeHtml(n.title)}</a> (${escapeHtml(meta)})`;
  });
  return [heading, ...items].join('\n');
}

function ok() {
  return new Response('ok');
}
