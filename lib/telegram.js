import { createHash } from 'node:crypto';

const API = 'https://api.telegram.org';

// Webhook secret derived from the bot token, so there's no separate secret to configure.
export function webhookSecret() {
  return createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN ?? '').digest('hex');
}
const MAX_MESSAGE_LENGTH = 4096;

async function call(method, payload) {
  const res = await fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description}`);
  }
  return data.result;
}

// Plain text by default. With { html: true } the text must already be HTML-escaped (see escapeHtml);
// if Telegram rejects the formatting, that chunk is resent as plain text so the draft still arrives.
export async function sendMessage(chatId, text, { html = false } = {}) {
  for (const chunk of splitText(text)) {
    if (!html) {
      await call('sendMessage', { chat_id: chatId, text: chunk });
      continue;
    }
    try {
      await call('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      console.warn(`HTML send failed, resending as plain text: ${err.message}`);
      await call('sendMessage', { chat_id: chatId, text: htmlToPlain(chunk) });
    }
  }
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Links keep their URL in brackets so nothing is lost in the plain-text fallback.
function htmlToPlain(html) {
  return html
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function sendTyping(chatId) {
  return call('sendChatAction', { chat_id: chatId, action: 'typing' });
}

export { call as telegramApi };

// Telegram caps messages at 4096 characters; split on paragraph or line breaks where possible.
function splitText(text) {
  const chunks = [];
  let rest = text;
  while (rest.length > MAX_MESSAGE_LENGTH) {
    const window = rest.slice(0, MAX_MESSAGE_LENGTH);
    let cut = window.lastIndexOf('\n\n');
    if (cut < MAX_MESSAGE_LENGTH / 2) cut = window.lastIndexOf('\n');
    if (cut < MAX_MESSAGE_LENGTH / 2) cut = MAX_MESSAGE_LENGTH;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
