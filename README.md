# Meera's note-to-draft bot

Meera texts a note to a Telegram bot. The bot sends the note to Gemini along with her voice
profile and replies in the same chat with a draft post.

```
Meera (Telegram) ──► Telegram ──► Vercel: /api/telegram ──► Gemini
        ▲                                   │
        └──────────── draft post ◄──────────┘
```

No dependencies: it uses Node's built-in `fetch` for both the Telegram and Gemini APIs.

## Files

| File | What it does |
| --- | --- |
| `api/telegram.js` | The webhook Telegram calls for every message. Checks the request is from Telegram, gets a draft, replies. |
| `api/setup.js` | Open once in a browser to connect Telegram to the deployment. |
| `lib/gemini.js` | Sends the note to Gemini with `prompts/voice-skill.txt` as the system instruction. |
| `lib/telegram.js` | Sends replies (split into 4096-char chunks) and the "typing…" indicator. |
| `prompts/voice-skill.txt` | **Meera's voice profile.** Sent to Gemini with every note. |
| `vercel.json` | Bundles `prompts/` with the function and allows up to 60s per request. |
| `.env.example` | Every environment variable the project uses. |

## Setup

You only need two keys.

1. **Bot token:** in Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, copy the token.
2. **Gemini key:** create one at [Google AI Studio](https://aistudio.google.com/apikey).
3. **Deploy:** import this GitHub repo in Vercel. In **Settings → Environment Variables** add
   `TELEGRAM_BOT_TOKEN` and `GEMINI_API_KEY`, then deploy.
4. **Connect Telegram:** open `https://<your-app>.vercel.app/api/setup` in a browser once.
   It should say "Done."

That's it. Message the bot and it replies with a draft.

### Optional: lock the bot to Meera
Anyone who finds the bot can use it (and your Gemini credits). To stop that, add
`ALLOWED_CHAT_ID` in Vercel with Meera's Telegram chat ID and redeploy. Other chats are then ignored.

## Troubleshooting

- **No reply at all:** open `/api/setup` again. If you changed the bot token, you must do this.
- **"Sorry, something went wrong…":** the error text is included in the reply; full details are in
  Vercel → Project → Logs.
- **Changed `voice-skill.txt`:** commit and push; Vercel redeploys automatically.
- **Deployment check:** opening `https://<your-app>.vercel.app/api/telegram` should show
  "Meera bot is running."
