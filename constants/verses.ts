export interface Verse {
  text: string;
  reference: string;
}

export const VERSES: Verse[] = [
  { text: 'They are new every morning: great is thy faithfulness.', reference: 'Lamentations 3:23' },
  { text: 'But they that wait upon the Lord shall renew their strength.', reference: 'Isaiah 40:31' },
  { text: 'I can do all things through Christ which strengtheneth me.', reference: 'Philippians 4:13' },
  { text: 'The Lord is my shepherd; I shall not want.', reference: 'Psalm 23:1' },
  { text: 'Trust in the Lord with all thine heart and lean not unto thine own understanding.', reference: 'Proverbs 3:5' },
  { text: 'Be strong and courageous. Do not be afraid; do not be discouraged.', reference: 'Joshua 1:9' },
  { text: 'For I know the plans I have for you, declares the Lord.', reference: 'Jeremiah 29:11' },
];

/** Returns a deterministic verse for a given date so it stays consistent all day. */
export function getVerseOfDay(date: Date = new Date()): Verse {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000
  );
  return VERSES[dayOfYear % VERSES.length];
}
