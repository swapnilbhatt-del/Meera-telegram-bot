import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MODEL = 'gemini-3.5-flash';

// Meera's voice profile. Read once per cold start; vercel.json bundles prompts/** with the function.
const voiceProfile = readFileSync(
  path.join(process.cwd(), 'prompts', 'voice-skill.txt'),
  'utf8',
).trim();

if (!voiceProfile) {
  throw new Error('prompts/voice-skill.txt is empty');
}

// Sent as Gemini's system instruction on every draft.
const systemInstruction = `You turn Meera's rough notes into a finished draft post, written in her voice as described below. Reply with the post only, with no preamble or commentary.

${voiceProfile}`;

export async function draftPost(note) {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: note }] }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${data.error?.message ?? 'unknown error'}`);
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the note (${data.promptFeedback.blockReason})`);
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error(`Gemini returned no text (finishReason: ${candidate?.finishReason ?? 'none'})`);
  }
  return text;
}
