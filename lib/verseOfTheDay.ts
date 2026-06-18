import AsyncStorage from '@react-native-async-storage/async-storage';

const FEED_URL = 'https://feeds.feedburner.com/hl-devos-votd';
const CACHE_KEY = 'VERSE_OF_THE_DAY_CACHE'; // value: "YYYY-MM-DD|text|reference"

export interface Verse {
  text: string;
  reference: string;
}

// Used only if the feed is unreachable — a real, accurately-quoted verse,
// never AI-generated.
const FALLBACK_VERSE: Verse = {
  text: 'They are new every morning: great is thy faithfulness.',
  reference: 'Lamentations 3:23',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '—');
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

async function fetchFromFeed(): Promise<Verse | null> {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) return null;
    const xml = await res.text();

    const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
    if (!itemMatch) return null;
    const item = itemMatch[1];

    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const reference = titleMatch ? decodeEntities(titleMatch[1]).replace(/^Verse of the Day\s*-\s*/, '').trim() : '';

    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
    if (!descMatch) return null;
    const desc = decodeEntities(descMatch[1]);

    const firstP = desc.match(/<p>([\s\S]*?)<\/p>/);
    const text = firstP ? firstP[1].replace(/<[^>]+>/g, '').trim() : '';

    if (!text || !reference) return null;
    return { text, reference };
  } catch {
    return null;
  }
}

/** Returns today's verse, cached so the same one shows everywhere all day
 * and the network is hit at most once per day. */
export async function getVerseOfTheDay(): Promise<Verse> {
  const today = todayKey();

  const cached = await AsyncStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { date: string; verse: Verse };
      if (parsed.date === today && parsed.verse?.text && parsed.verse?.reference) return parsed.verse;
    } catch {
      // fall through to refetch
    }
  }

  const fresh = await fetchFromFeed();
  const verse = fresh ?? FALLBACK_VERSE;
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, verse }));
  return verse;
}
