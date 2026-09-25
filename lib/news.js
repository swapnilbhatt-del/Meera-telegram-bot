// Google News RSS: recent headlines for a search query. No API key needed.
// https://news.google.com/rss/search?q=<query>&hl=en-IN&gl=IN&ceid=IN:en

const FEED = 'https://news.google.com/rss/search';
const MAX_ITEMS = 5;
const TIMEOUT_MS = 5000;

// Returns up to 5 { title, source, link, published } items, newest first. window is a Google
// News age limit such as '30d' or '1y'. Never throws: any failure returns [].
export async function searchNews(query, window = '30d') {
  if (!query?.trim()) return [];
  const params = new URLSearchParams({
    q: `${query} when:${window}`,
    hl: process.env.NEWS_LANGUAGE || 'en-IN',
    gl: process.env.NEWS_COUNTRY || 'IN',
    ceid: `${process.env.NEWS_COUNTRY || 'IN'}:en`,
  });
  try {
    const res = await fetch(`${FEED}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Google News ${res.status}`);
    return parseFeed(await res.text());
  } catch (err) {
    console.warn(`News lookup failed for "${query}": ${err.message}`);
    return [];
  }
}

export function parseFeed(xml) {
  const items = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = tag(item, 'source');
    let title = tag(item, 'title');
    // Google News titles end with " - <Source>"; drop it since source is kept separately.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(item, 'link');
    if (!title || !link) continue;
    const date = new Date(tag(item, 'pubDate'));
    items.push({
      title,
      source,
      link,
      published: Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10),
    });
  }
  return items
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, MAX_ITEMS);
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  if (!m) return '';
  return decode(m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')).trim();
}

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
