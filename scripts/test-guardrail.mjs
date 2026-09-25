// Runs notes through the real webhook handler (api/telegram.js) with Telegram stubbed out, and checks
// the scoring guardrail routing, the Google News step and the score/sources footer. Nothing is sent to Telegram.
//
//   Live (real Gemini):  node --env-file=.env scripts/test-guardrail.mjs
//   Offline (canned Gemini replies, incl. malformed JSON):  node scripts/test-guardrail.mjs --mock
//
// Nothing is sent to Telegram in either mode.

const MOCK = process.argv.includes('--mock');
if (MOCK) {
  process.env.GEMINI_API_KEY ||= 'mock';
  process.env.TELEGRAM_BOT_TOKEN ||= 'mock';
}
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set. Run with --env-file=.env, or use --mock.');
  process.exit(1);
}

const CHAT_ID = Number(process.env.ALLOWED_CHAT_ID) || 12345;
const DRAFT_MARKER = 'You turn Meera';
const KEYWORD_MARKER = 'Extract search keywords';
const NEWS_MARKER = 'Recent Google News headlines related to this note';

// Mock Google News feed in the real RSS shape (title suffix, entities, source tag).
const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"niacinamide pH" - Google News</title>
<item><title>Why your niacinamide serum&#39;s pH matters more than its percentage - The Hindu</title><link>https://news.google.com/rss/articles/AAA</link><pubDate>Mon, 21 Sep 2026 06:00:00 GMT</pubDate><source url="https://www.thehindu.com">The Hindu</source></item>
<item><title>CDSCO tightens cosmetic labelling &amp; testing rules - Economic Times</title><link>https://news.google.com/rss/articles/BBB</link><pubDate>Wed, 23 Sep 2026 09:30:00 GMT</pubDate><source url="https://economictimes.indiatimes.com">Economic Times</source></item>
</channel></rss>`;
const EMPTY_FEED = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';

const TEST_A =
  "I’ve noticed that customers often ask whether our niacinamide is 5% or 10%, but the percentage alone doesn't tell you much. The pH, delivery base and batch consistency can all affect what the finished product actually delivers. We should explain why concentration on the label is only the beginning of the question.";
const TEST_B = 'Write something about niacinamide tomorrow.';
const TEST_C = 'Need to write about climate and skincare formulations.';

// --- fetch stub: record Telegram calls; send Gemini calls to the real API or to canned replies ---
const realFetch = globalThis.fetch;
let log;
let cannedScores = []; // mock mode: raw scoring replies, consumed in order
let cannedKeywords; // mock mode: raw keyword reply (default below)
let feeds; // mock mode: RSS bodies (or Error) per news request, in order
let cannedDraft; // mock mode: raw draft reply

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org')) {
    const method = u.split('/').pop();
    const body = JSON.parse(init.body);
    if (method === 'sendMessage') log.telegram.push(body.text);
    return json({ ok: true, result: true });
  }
  if (u.startsWith('https://news.google.com/rss/search')) {
    log.newsQueries.push(new URL(u).searchParams.get('q'));
    if (!MOCK) return realFetch(url, init);
    const next = feeds.shift() ?? EMPTY_FEED;
    if (next instanceof Error) throw next;
    return new Response(next, { status: 200 });
  }
  if (u.includes('generativelanguage.googleapis.com')) {
    const body = JSON.parse(init.body);
    const sys = body.systemInstruction.parts[0].text;
    if (sys.startsWith(KEYWORD_MARKER)) {
      log.keywordCalls++;
      if (!MOCK) return realFetch(url, init);
      return geminiText(cannedKeywords);
    }
    const isDraft = sys.startsWith(DRAFT_MARKER);
    if (isDraft) log.draftCalls.push(body);
    else {
      log.scoreCalls++;
      log.scoreModels.push(u.match(/models\/([^:]+):/)[1]);
    }
    if (!MOCK) {
      const res = await realFetch(url, init);
      if (!isDraft) {
        const clone = await res.clone().json();
        log.rawScores.push(clone.candidates?.[0]?.content?.parts?.[0]?.text);
      }
      return res;
    }
    if (isDraft) return geminiText(cannedDraft);
    const next = cannedScores.shift();
    if (next instanceof Error) return json({ error: { message: next.message } }, 500);
    if (next?.status) return json({ error: { message: 'This model is currently experiencing high demand.' } }, next.status);
    return geminiText(next ?? 'no more canned replies');
  }
  throw new Error(`Unexpected fetch to ${u}`);
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function geminiText(text) {
  return json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
}

const { POST } = await import('../api/telegram.js');
const { webhookSecret } = await import('../lib/telegram.js');

async function run(note) {
  log = { telegram: [], draftCalls: [], scoreCalls: 0, scoreModels: [], rawScores: [], keywordCalls: 0, newsQueries: [] };
  const req = new Request('https://example.test/api/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: CHAT_ID }, text: note } }),
  });
  const res = await POST(req);
  return { status: res.status, ...log };
}

const REJECT_PREFIX = "I didn't create a draft because this note isn't substantive enough yet: ";
let failures = 0;
function check(name, cond, detail) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures++;
}

// Capture the handler's "Note scored X/10" log line.
const realLog = console.log;
let lastScoreLine = null;
console.log = (...args) => {
  const line = args.join(' ');
  if (line.startsWith('Note scored ')) lastScoreLine = line;
  else if (line.startsWith('News for ')) realLog(`  ${line}`);
  else realLog(...args);
};

async function caseRun(title, note, canned, expect, mock = {}) {
  realLog(`\n${title}`);
  cannedScores = canned ?? [];
  cannedKeywords = mock.keywords ?? '{"keywords": ["niacinamide", "pH", "batch consistency", "CoA"], "query": "niacinamide pH"}';
  feeds = [...(mock.feeds ?? [SAMPLE_FEED])];
  cannedDraft = mock.draft ?? 'MOCK DRAFT\nUSED: 1';
  lastScoreLine = null;
  const r = await run(note);
  const score = lastScoreLine ? Number(lastScoreLine.match(/Note scored (\d+)/)[1]) : null;
  realLog(`  score line: ${lastScoreLine ?? '(none)'}`);
  if (r.rawScores.length) realLog(`  raw Gemini scoring reply: ${r.rawScores.join(' | ')}`);
  if (r.newsQueries.length) realLog(`  news queries: ${JSON.stringify(r.newsQueries)}`);
  if (r.draftCalls[0]) realLog(`  news in draft request: ${r.draftCalls[0].contents[0].parts[0].text.includes(NEWS_MARKER) ? 'yes' : 'no'}`);
  if (!MOCK && r.telegram[0]?.includes('Note score:')) realLog(`  --- reply footer ---\n${r.telegram.join('').split('———')[1]?.replace(/^/gm, '  ')}`);
  realLog(`  telegram replies: ${JSON.stringify(r.telegram.map((t) => t.slice(0, 160)))}`);
  expect(r, score);
}

await caseRun('TEST A: substantive note', TEST_A, ['{"score": 8, "reason": "The note makes a specific argument about why label concentration is incomplete, naming pH, delivery base and batch consistency."}'], (r, score) => {
  check('score >= 6', score !== null && score >= 6, `score=${score}`);
  // Live runs may send the draft request twice when the main model is busy and the backup answers.
  check('drafting step called', r.draftCalls.length >= 1 && (MOCK ? r.draftCalls.length === 1 : true));
  check('draft sent to Telegram', r.telegram.length === 1 && !r.telegram[0].startsWith("I didn't create"));
  check('score shown at the end of the draft', score !== null && r.telegram.at(-1)?.includes(`\n\n———\nNote score: ${score}/10\n`));
  check('keywords extracted', MOCK ? r.keywordCalls === 1 : r.keywordCalls >= 1);
  check('Google News searched', r.newsQueries.length >= 1);
  check('headlines passed to drafting', r.draftCalls[0]?.contents[0].parts[0].text.includes(NEWS_MARKER));
  const reply = r.telegram.join('');
  check('sources listed after the score', /Note score: [\s\S]*\n\nSources/.test(reply) || /Note score: [\s\S]*\n\nGoogle News headlines given/.test(reply));
  check('no USED: marker left in the post', !/^USED:/im.test(reply));
});

await caseRun('TEST B: task/reminder', TEST_B, ['{"score": 2, "reason": "The note is a reminder to write about a topic and contains no actual idea or content."}'], (r, score) => {
  check('score <= 3', score !== null && score <= 3, `score=${score}`);
  check('drafting step NOT called', r.draftCalls.length === 0);
  check('no keyword or news lookup', r.keywordCalls === 0 && r.newsQueries.length === 0);
  check('rejection message sent', r.telegram.length === 1 && r.telegram[0].startsWith(REJECT_PREFIX));
});

await caseRun('TEST C: topic / general thought', TEST_C, ['{"score": 3, "reason": "The note names a topic but gives no observation, argument or detail to draft from."}'], (r, score) => {
  check('score < 6', score !== null && score < 6, `score=${score}`);
  check('drafting step NOT called', r.draftCalls.length === 0);
  check('no keyword or news lookup', r.keywordCalls === 0 && r.newsQueries.length === 0);
  check('rejection message sent', r.telegram.length === 1 && r.telegram[0].startsWith(REJECT_PREFIX));
});

if (MOCK) {
  const FAIL_CLOSED = "I didn't create a draft because I couldn't score this note. Please send it again.";
  const malformed = [
    ['not JSON at all, twice', ['Sure! This note is great, 9/10.', 'Score: 9']],
    ['score as string "9", twice', ['{"score": "9", "reason": "x."}', '{"score": "9", "reason": "x."}']],
    ['non-integer score 6.5, twice', ['{"score": 6.5, "reason": "x."}', '{"score": 6.5, "reason": "x."}']],
    ['out of range 11, twice', ['{"score": 11, "reason": "x."}', '{"score": 11, "reason": "x."}']],
    ['extra field, twice', ['{"score": 9, "reason": "x.", "draft": "..."}', '{"score": 9, "reason": "x.", "draft": "..."}']],
    ['missing reason, twice', ['{"score": 9}', '{"score": 9}']],
  ];
  for (const [label, canned] of malformed) {
    await caseRun(`MALFORMED: ${label}`, TEST_A, canned, (r) => {
      check('drafting step NOT called', r.draftCalls.length === 0);
      check('fail-closed message sent', r.telegram.length === 1 && r.telegram[0] === FAIL_CLOSED);
    });
  }

  await caseRun('MALFORMED then valid on retry', TEST_A, ['oops', '{"score": 7, "reason": "Specific and draftable."}'], (r, score) => {
    check('retried once', r.scoreCalls === 2);
    check('score 7 routes to drafting', score === 7 && r.draftCalls.length === 1);
  });

  await caseRun('Fenced JSON is accepted', TEST_A, ['```json\n{"score": 7, "reason": "Specific and draftable."}\n```'], (r, score) => {
    check('score parsed', score === 7 && r.draftCalls.length === 1);
  });

  await caseRun('Boundary: score exactly 6 drafts', TEST_A, ['{"score": 6, "reason": "Minimum substance present."}'], (r) => {
    check('drafting step called', r.draftCalls.length === 1);
  });

  await caseRun('Boundary: score 5 rejects', TEST_A, ['{"score": 5, "reason": "Underdeveloped."}'], (r) => {
    check('drafting step NOT called', r.draftCalls.length === 0);
    check('rejection text has reason', r.telegram[0] === `${REJECT_PREFIX}Underdeveloped.`);
  });

  // An empty reply throws in the shared Gemini call, so it lands in the existing error handler.
  await caseRun('Empty scoring reply', TEST_A, [''], (r) => {
    check('drafting step NOT called', r.draftCalls.length === 0);
    check('existing error reply sent', r.telegram[0]?.startsWith('Sorry, something went wrong'));
  });

  await caseRun('Gemini API error during scoring', TEST_A, [new Error('quota exceeded')], (r) => {
    check('drafting step NOT called', r.draftCalls.length === 0);
    check('existing error reply sent', r.telegram[0]?.startsWith('Sorry, something went wrong'));
  });

  const OVERLOADED = { status: 503 };
  const OUT_OF_QUOTA = { status: 429 };
  await caseRun('Main model busy (503): backup model answers', TEST_A, [OVERLOADED, '{"score": 8, "reason": "Specific."}'], (r, score) => {
    check('switched from main to backup model', r.scoreModels.join(',') === 'gemini-3.5-flash,gemini-3.5-flash-lite', r.scoreModels.join(' -> '));
    check('scored and drafted', score === 8 && r.draftCalls.length === 1 && r.telegram[0].startsWith('MOCK DRAFT'));
  });

  await caseRun('Main model out of quota (429): backup model answers', TEST_A, [OUT_OF_QUOTA, '{"score": 7, "reason": "Specific."}'], (r, score) => {
    check('switched to backup model', r.scoreModels[1] === 'gemini-3.5-flash-lite', r.scoreModels.join(' -> '));
    check('scored and drafted', score === 7 && r.draftCalls.length === 1);
  });

  await caseRun('Both models busy at first, main recovers after a pause', TEST_A, [OVERLOADED, OVERLOADED, '{"score": 9, "reason": "Strong."}'], (r, score) => {
    check('main, backup, then main again', r.scoreModels.join(',') === 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.5-flash', r.scoreModels.join(' -> '));
    check('scored and drafted', score === 9 && r.draftCalls.length === 1);
  });

  await caseRun('Both models busy on every try', TEST_A, [OVERLOADED, OUT_OF_QUOTA, OVERLOADED, OVERLOADED], (r) => {
    check('gave up after 4 tries (2 per model)', r.scoreCalls === 4, r.scoreModels.join(' -> '));
    check('drafting step NOT called', r.draftCalls.length === 0);
    check('existing error reply sent', r.telegram[0]?.startsWith('Sorry, something went wrong'));
  });

  await caseRun('Non-retryable error (500) does not switch models', TEST_A, [new Error('internal')], (r) => {
    check('only one attempt', r.scoreCalls === 1);
    check('existing error reply sent', r.telegram[0]?.startsWith('Sorry, something went wrong'));
  });

  const savedModel = process.env.GEMINI_FALLBACK_MODEL;
  process.env.GEMINI_FALLBACK_MODEL = 'custom-backup';
  await caseRun('GEMINI_FALLBACK_MODEL setting is respected', TEST_A, [OVERLOADED, '{"score": 8, "reason": "Specific."}'], (r) => {
    check('uses the configured backup', r.scoreModels[1] === 'custom-backup', r.scoreModels.join(' -> '));
  });
  if (savedModel === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
  else process.env.GEMINI_FALLBACK_MODEL = savedModel;

  await caseRun('Reply format: post, score footer, sources', TEST_A, ['{"score": 7, "reason": "Specific and draftable."}'], (r) => {
    check('post, score, then sources', r.telegram[0] === 'MOCK DRAFT\n\n———\nNote score: 7/10\nSpecific and draftable.\n\nSources used from Google News:\n1. CDSCO tightens cosmetic labelling & testing rules (Economic Times, 2026-09-23)\nhttps://news.google.com/rss/articles/BBB', JSON.stringify(r.telegram[0]));
    check('score not sent to Gemini for drafting', !r.draftCalls[0].contents[0].parts[0].text.includes('Note score'));
  });

  await caseRun('Rejected notes get no score footer', TEST_A, ['{"score": 4, "reason": "Too thin."}'], (r) => {
    check('rejection message unchanged', r.telegram[0] === `${REJECT_PREFIX}Too thin.`);
  });

  await caseRun('No news found: drafting request is exactly the note', TEST_A, ['{"score": 9, "reason": "Strong."}'], (r) => {
    const body = r.draftCalls[0];
    check('tried query, then keyword fallback', r.newsQueries.length === 2 && r.newsQueries[1].startsWith('niacinamide OR pH'), JSON.stringify(r.newsQueries));
    check('only systemInstruction + contents keys (no generationConfig)', body && Object.keys(body).join(',') === 'systemInstruction,contents');
    check('note passed through verbatim', body?.contents[0].parts[0].text === TEST_A);
    check('reply says no news found', r.telegram[0].endsWith('\n\nSources: none (no related Google News found)'));
  }, { feeds: [EMPTY_FEED, EMPTY_FEED], draft: 'MOCK DRAFT' });

  await caseRun('Fallback query finds news', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    check('headlines passed to drafting', r.draftCalls[0]?.contents[0].parts[0].text.includes(NEWS_MARKER));
    check('source listed', r.telegram[0].includes('Sources used from Google News:\n1. CDSCO'));
  }, { feeds: [EMPTY_FEED, SAMPLE_FEED] });

  await caseRun('Headlines in the draft request have no links (Gemini cannot paste them)', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    const req = r.draftCalls[0]?.contents[0].parts[0].text ?? '';
    check('no URLs sent to Gemini', !req.includes('https://'));
    check('asks for USED line', req.includes('"USED: 1, 3"'));
  });

  await caseRun('Gemini used headline 2 only', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    const reply = r.telegram[0];
    check('only headline 2 listed', reply.includes("1. Why your niacinamide serum's pH matters more than its percentage (The Hindu, 2026-09-21)\nhttps://news.google.com/rss/articles/AAA") && !reply.includes('CDSCO'));
    check('USED line removed from post', reply.startsWith('Post body.\n\n———'));
  }, { draft: 'Post body.\nUSED: 2' });

  await caseRun('Gemini used both headlines (bold marker, repeats)', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    const reply = r.telegram[0];
    check('both listed once each', (reply.match(/\n\d\. /g) || []).length === 2);
    check('marker removed', !reply.includes('USED'));
  }, { draft: 'Post body.\n**USED: 1, 2, 2**' });

  await caseRun('Gemini used none of the headlines', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    check('says headlines not used', r.telegram[0].endsWith('\n\nSources: none (the related Google News headlines were not used)'));
    check('marker removed', !r.telegram[0].includes('USED'));
  }, { draft: 'Post body.\nUSED: none' });

  await caseRun('Gemini cited a headline number that does not exist', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    check('invalid number ignored, valid kept', r.telegram[0].includes('1. CDSCO') && !r.telegram[0].includes('Hindu'));
  }, { draft: 'Post body.\nUSED: 9, 1' });

  await caseRun('Gemini forgot the USED line', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    const reply = r.telegram[0];
    check('post kept whole', reply.startsWith('Post body without marker.\n\n———'));
    check('all headlines listed with a check-them warning', reply.includes("didn't say which it used") && reply.includes('CDSCO') && reply.includes('Hindu'));
  }, { draft: 'Post body without marker.' });

  await caseRun('Google News unreachable: still drafts', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    check('draft made without news', r.draftCalls.length === 1 && r.draftCalls[0].contents[0].parts[0].text === TEST_A);
    check('draft sent with no-news sources line', r.telegram[0].startsWith('MOCK DRAFT') && r.telegram[0].endsWith('Sources: none (no related Google News found)'));
  }, { feeds: [new Error('network down'), new Error('network down')], draft: 'MOCK DRAFT' });

  await caseRun('Keyword reply malformed: still drafts', TEST_A, ['{"score": 8, "reason": "Specific."}'], (r) => {
    check('no news search', r.newsQueries.length === 0);
    check('draft made without news', r.draftCalls.length === 1 && r.draftCalls[0].contents[0].parts[0].text === TEST_A);
  }, { keywords: 'not json', draft: 'MOCK DRAFT' });

  realLog('\nRSS parser');
  const { parseFeed } = await import('../lib/news.js');
  const items = parseFeed(SAMPLE_FEED);
  check('parses 2 items, newest first', items.length === 2 && items[0].published === '2026-09-23', JSON.stringify(items.map((i) => i.published)));
  check('strips " - Source" and decodes entities', items[0].title === 'CDSCO tightens cosmetic labelling & testing rules' && items[1].title === "Why your niacinamide serum's pH matters more than its percentage");
  check('keeps source and link', items[0].source === 'Economic Times' && items[0].link === 'https://news.google.com/rss/articles/BBB');
  check('empty feed gives []', parseFeed(EMPTY_FEED).length === 0);
}

realLog(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
