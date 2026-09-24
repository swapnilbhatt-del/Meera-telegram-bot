# Meera's note-to-draft bot

Meera texts a note to a Telegram bot. The bot sends the note to Gemini along with her voice
instructions and replies in the same chat with a draft post.

```
Meera (Telegram) ──► Telegram ──► Vercel: /api/telegram ──► Gemini
        ▲                                   │
        └──────────── draft post ◄──────────┘
```

No dependencies: it uses Node's built-in `fetch` for both the Telegram and Gemini APIs.

## Files

| File | What it does |
| --- | --- |
| `api/telegram.js` | The webhook Telegram calls for every message. Checks the secret, checks the chat is Meera's, gets a draft, replies. |
| `lib/gemini.js` | Sends the note to Gemini with `prompts/voice-skill.txt` as the system instruction. |
| `lib/telegram.js` | Sends replies (split into 4096-char chunks) and the "typing…" indicator. |
| `prompts/voice-skill.txt` | **Meera's voice profile.** Sent to Gemini with every note. |
| `scripts/set-webhook.js` | One-off script that tells Telegram where your Vercel function lives. |
| `vercel.json` | Bundles `prompts/` with the function and allows up to 60s per request. |
| `.env.example` | Every environment variable the project uses. |

## Setup

### 1. Create the bot
In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.

### 2. Add the voice instructions
Meera's voice profile is in `prompts/voice-skill.txt`. Edit that file to change how drafts are written.

### 3. Deploy to Vercel
Push this folder to a GitHub repo and import it in Vercel (or run `npx vercel` in this folder).
No build settings are needed.

In **Project → Settings → Environment Variables**, add:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Any random string, e.g. output of `openssl rand -hex 32` |
| `GEMINI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | Optional; defaults to `gemini-2.5-flash` |

Leave `ALLOWED_CHAT_ID` empty for now, then redeploy so the variables take effect.

### 4. Connect Telegram to the deployment
Copy `.env.example` to `.env` locally and fill in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
(same value as in Vercel) and `PUBLIC_URL` (your `https://….vercel.app` URL). Then:

```bash
npm run set-webhook
```

### 5. Lock the bot to Meera
Have Meera send the bot any message. While `ALLOWED_CHAT_ID` is empty the bot only replies with her
chat ID. Add that number as `ALLOWED_CHAT_ID` in Vercel and redeploy. From then on, her notes get
drafts and messages from anyone else are silently ignored.

## Troubleshooting

- **No reply at all:** run `npm run webhook-info` and look at `last_error_message`.
  A `401` there means the secret in `.env` and in Vercel don't match; rerun `set-webhook` after fixing.
- **"Sorry, something went wrong…":** the error text is included in the reply; full details are in
  Vercel → Project → Logs.
- **Changed `voice-skill.txt`:** redeploy. It's read when the function starts, not on every message.
- **Deployment URL check:** opening `https://…vercel.app/api/telegram` in a browser should show
  "Meera bot is running."
