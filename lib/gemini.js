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

// Strict scoring rubric used to gate notes before drafting.
const scoringPrompt = readFileSync(
  path.join(process.cwd(), 'prompts', 'scoring-prompt.txt'),
  'utf8',
).trim();

if (!scoringPrompt) {
  throw new Error('prompts/scoring-prompt.txt is empty');
}

// Notes scoring below this never reach draftPost.
export const MIN_DRAFT_SCORE = 6;

// Sent as Gemini's system instruction on every draft.
const systemInstruction = `You turn Meera's rough notes into a finished draft post, written in her voice as described below. Reply with the post only, with no preamble or commentary.

${voiceProfile}`;

export async function draftPost(note) {
  return generate(systemInstruction, note);
}

// Scores a note 0-10 before drafting. Returns { score, reason }, or null when Gemini's reply
// isn't valid scoring JSON after one retry. Callers must treat null as "do not draft".
export async function scoreNote(note) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate(scoringPrompt, note, SCORING_CONFIG);
    const result = parseScore(raw);
    if (result) return result;
    console.warn(`Unusable scoring reply (attempt ${attempt + 1}): ${raw.slice(0, 500)}`);
  }
  return null;
}

// JSON mode plus a schema, at temperature 0 so the same note gets the same score.
const SCORING_CONFIG = {
  temperature: 0,
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'OBJECT',
    properties: {
      score: { type: 'INTEGER' },
      reason: { type: 'STRING' },
    },
    required: ['score', 'reason'],
  },
};

// Accepts only {"score": <integer 0-10>, "reason": "<non-empty string>"}; anything else is null.
// Tolerates code fences or stray text around the object, but never guesses a score.
export function parseScore(raw) {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const keys = Object.keys(parsed).sort().join(',');
  if (keys !== 'reason,score') return null;

  const { score, reason } = parsed;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10) return null;
  if (typeof reason !== 'string' || !reason.trim()) return null;

  return { score, reason: reason.replace(/\s+/g, ' ').trim() };
}

const OVERLOAD_RETRY_DELAYS_MS = [2000, 5000];

async function generate(instruction, note, generationConfig) {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const request = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instruction }] },
      contents: [{ role: 'user', parts: [{ text: note }] }],
      ...(generationConfig && { generationConfig }),
    }),
  };

  // 503 means Gemini is temporarily overloaded; wait and retry a couple of times before giving up.
  let res = await fetch(url, request);
  for (const delayMs of OVERLOAD_RETRY_DELAYS_MS) {
    if (res.status !== 503) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await fetch(url, request);
  }

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
