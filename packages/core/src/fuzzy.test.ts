import { describe, expect, it } from 'vitest';
import {
  editDistance,
  fuzzyScore,
  hebrewToLatin,
  highlightMatch,
  latinToHebrew,
  lightKey,
  makeIndex,
  makeIndexAsync,
  mergeNames,
  phonKey,
  searchIndex,
  skeletonKey,
  suggestCorrections,
  swapKeyboardLayout,
} from './fuzzy.ts';
import { BUILTIN_NAMES, parseNameLines } from './names/index.ts';
import { parseNamesFile } from './name-dictionary.ts';

const index = makeIndex(BUILTIN_NAMES);
const top = (q: string, prefix = true) => searchIndex(index, q, { limit: 3, prefix })[0]?.entry.n;
const corr = (q: string) => suggestCorrections(q, index)[0]?.text;

describe('normalization keys', () => {
  it('drops final letters, niqqud, punctuation and hyphens', () => {
    expect(lightKey('תֵּל-אָבִיב–יָפוֹ')).toBe('תל אביב יפו');
    expect(lightKey('Café  Noga’s')).toBe('cafe nogas');
    expect(lightKey('ת"א')).toBe('תל אביב');
  });
  it('treats ktiv male and haser, and sound-alike letters, as the same', () => {
    expect(phonKey('קריית')).toBe(phonKey('קרית'));
    expect(phonKey('שלום')).toBe(phonKey('שלם'));
    expect(phonKey('דיזינגוף')).toBe(phonKey('דיזנגוף'));
    expect(phonKey('תקוה')).toBe(phonKey('תקווה'));
    expect(phonKey('טבריה')).toBe(phonKey('תבריה'));
    expect(phonKey('קפה')).toBe(phonKey('כפא'));
    expect(phonKey('עכו')).toBe(phonKey('אכו'));
    expect(phonKey('dizengoff')).toBe(phonKey('dizengof'));
    expect(phonKey('Philadelphia')).toBe(phonKey('filadelfia'));
  });
  it('maps both scripts to the same consonant skeleton', () => {
    expect(skeletonKey('dizengoff')).toBe(skeletonKey('דיזנגוף'));
    expect(skeletonKey('Azrieli')).toBe(skeletonKey('עזריאלי'));
    expect(skeletonKey('Jerusalem')).toBe(skeletonKey('ירושלים'));
    expect(skeletonKey('Tel Aviv')).toBe(skeletonKey('תל אביב'));
    expect(skeletonKey('Sheinkin')).toBe(skeletonKey('שינקין'));
  });
  it('edit distance counts a swap of neighbours as one edit', () => {
    expect(editDistance('abcd', 'abdc')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('keyboard layout and transliteration', () => {
  it('reads Hebrew typed on an English layout, and back', () => {
    expect(swapKeyboardLayout('shzbdu;')).toBe('דיזנגוף');
    expect(swapKeyboardLayout('אקך שהןה')).toBe('tel aviv');
    expect(swapKeyboardLayout('יאשבג')).toBe('htacd');
    expect(swapKeyboardLayout('x')).toBeNull();
    expect(swapKeyboardLayout('תל אביב 5')).toBeNull();
  });
  it('transliterates well enough to find the name', () => {
    expect(latinToHebrew('dizengoff')).toBe('דיזנגוף');
    expect(latinToHebrew('shalom')).toBe('שלום');
    expect(hebrewToLatin('תל אביב')).toBe('tl aviv');
    expect(fuzzyScore('azrieli', 'עזריאלי')).toBeGreaterThan(0.7);
  });
});

describe('fuzzy search over the built-in dictionary', () => {
  const cases: [string, string][] = [
    ['דיזנגוב', 'דיזנגוף'],
    ['דיזינגוף', 'דיזנגוף'],
    ['דזנגוף', 'דיזנגוף'],
    ['עזראלי', 'עזריאלי'],
    ['אזריאלי', 'עזריאלי'],
    ['ירושליים', 'ירושלים'],
    ['ירושלם', 'ירושלים'],
    ['בארשבע', 'באר שבע'],
    ['באר-שבע', 'באר שבע'],
    ['פתח תקוה', 'פתח תקווה'],
    ['פתח-תקווה', 'פתח תקווה'],
    ['קרית גת', 'קריית גת'],
    ['תלאביב', 'תל אביב'],
    ['תל אביב יפו', 'תל אביב-יפו'],
    ['תל-אביב-יפו', 'תל אביב-יפו'],
    ['רמתגן', 'רמת גן'],
    ['חיפא', 'חיפה'],
    ['רעננא', 'רעננה'],
    ['הרצלייה', 'הרצליה'],
    ['נתנייה', 'נתניה'],
    ['אשדד', 'אשדוד'],
    ['אבן גבירל', 'אבן גבירול'],
    ['רוטשילט', 'רוטשילד'],
    ['פלרונטין', 'פלורנטין'],
    ['סורוקא', 'סורוקה'],
    ['איכלוב', 'איכילוב'],
    ['מצדא', 'מצדה'],
    ['טבריא', 'טבריה'],
    ['tel aviv', 'Tel Aviv'],
    ['tel avive', 'Tel Aviv'],
    ['telaviv', 'Tel Aviv'],
    ['jerusalm', 'Jerusalem'],
    ['jeruslaem', 'Jerusalem'],
    ['dizengof', 'Dizengoff'],
    ['azrieli', 'Azrieli'],
    ['azrielli', 'Azrieli'],
    ['petah tiqwa', 'Petah Tikva'],
    ['haifa', 'Haifa'],
    ['londn', 'London'],
    ['shzbdu;', 'דיזנגוף'],
  ];
  it.each(cases)('"%s" finds %s first', (q, want) => {
    expect(top(q, false)).toBe(want);
  });
  it('matches text still being typed', () => {
    expect(top('דיזנ')).toMatch(/^דיזנגוף/);
    expect(top('עזרי')).toMatch(/עזריאלי/);
    expect(top('jerus')).toBe('Jerusalem');
  });
  it('is word-order independent', () => {
    expect(top('אביב תל', false)).toBe('תל אביב');
    expect(top('סנטר דיזנגוף', false)).toBe('דיזנגוף סנטר');
  });
  it('finds a Hebrew name from English and back', () => {
    const hits = searchIndex(index, 'dizengoff', { limit: 5 }).map((m) => m.entry.n);
    expect(hits).toContain('דיזנגוף');
    expect(fuzzyScore('דיזנגוף', 'Dizengoff')).toBeGreaterThan(0.8);
  });
});

describe('suggestCorrections', () => {
  it('fixes misspelled names', () => {
    expect(corr('דיזנגוב')).toBe('דיזנגוף');
    expect(corr('עזראלי')).toBe('עזריאלי');
    expect(corr('ירושליים')).toBe('ירושלים');
    expect(corr('jerusalm')).toBe('Jerusalem');
    expect(corr('tel avive')).toBe('Tel Aviv');
    expect(corr('אבן גבירל')).toBe('אבן גבירול');
  });
  it('fixes a misspelled word inside a longer query', () => {
    expect(corr('דיזנגוב תל אביב')).toBe('דיזנגוף תל אביב');
    expect(corr('פיצא בתל אביב')).toBe('פיצה בתל אביב');
    expect(corr('קפה בפלרונטין')).toBe('קפה בפלורנטין');
  });
  it('fixes a keyboard layout slip', () => {
    expect(suggestCorrections('shzbdu;', index)[0]).toMatchObject({ text: 'דיזנגוף', kind: 'layout' });
  });
  it('says nothing for correct queries and known words', () => {
    for (const q of ['דיזנגוף', 'עזריאלי', 'פיצה בתל אביב', 'קפה', 'תל אביב', 'Tel Aviv', 'ראשון לציון', 'בתל אביב']) {
      expect(suggestCorrections(q, index), q).toEqual([]);
    }
  });
  it('does not turn short unknown words into something else', () => {
    expect(suggestCorrections('build', index)).toEqual([]);
    expect(suggestCorrections('ab', index)).toEqual([]);
  });
  it('keeps the other-language form of the correction', () => {
    expect(suggestCorrections('ירושליים', index)[0].alt).toBe('Jerusalem');
  });
});

describe('highlightMatch', () => {
  const bold = (name: string, q: string) => highlightMatch(name, q).filter((s) => s.bold).map((s) => s.text);
  it('bolds the typed part of each matching word', () => {
    expect(bold('דיזנגוף סנטר', 'דיזנגוף')).toEqual(['דיזנגוף']);
    expect(bold('קניון עזריאלי', 'עזראלי')).toEqual(['עזריאלי']);
    expect(bold('Tel Aviv-Yafo', 'tel av')).toEqual(['Tel', 'Av']);
    expect(highlightMatch('קפה לנדוור', 'zzz')).toEqual([{ text: 'קפה לנדוור', bold: false }]);
  });
  it('keeps the whole text', () => {
    const segs = highlightMatch('קניון עזריאלי', 'עזר');
    expect(segs.map((s) => s.text).join('')).toBe('קניון עזריאלי');
  });
});

describe('dictionaries', () => {
  it('parses curated lines into one entry per language', () => {
    const e = parseNameLines('דיזנגוף|Dizengoff|street|60|תל אביב-יפו\nפריז|Paris|2100');
    expect(e).toEqual([
      { n: 'דיזנגוף', k: 'street', w: 60, c: 'תל אביב-יפו', alt: 'Dizengoff' },
      { n: 'Dizengoff', k: 'street', w: 60, c: 'תל אביב-יפו', alt: 'דיזנגוף' },
      { n: 'פריז', k: 'city', w: 2100, alt: 'Paris' },
      { n: 'Paris', k: 'city', w: 2100, alt: 'פריז' },
    ]);
  });
  it('ships hundreds of Israeli names and every bundled world city', () => {
    expect(BUILTIN_NAMES.filter((e) => /[א-ת]/.test(e.n)).length).toBeGreaterThan(900);
    expect(BUILTIN_NAMES.some((e) => e.n === 'Buenos Aires')).toBe(true);
  });
  it('reads a names file and ignores junk', () => {
    expect(parseNamesFile([{ n: 'הרב קוק', k: 'street', w: 3, c: 'חיפה' }, { n: 5 }, null, { x: 1 }])).toEqual([
      { n: 'הרב קוק', k: 'street', w: 3, c: 'חיפה', alt: undefined },
    ]);
    expect(parseNamesFile({ names: [{ n: 'א ב' }] })).toHaveLength(1);
    expect(parseNamesFile('<html>')).toEqual([]);
  });
  it('merges lists keeping the heavier duplicate', () => {
    const m = mergeNames([{ n: 'דיזנגוף', w: 1, alt: 'Dizengoff' }], [{ n: 'דיזנגוף', w: 9 }, { n: 'חדש' }]);
    expect(m).toEqual([{ n: 'דיזנגוף', w: 9, alt: 'Dizengoff' }, { n: 'חדש' }]);
  });
  it('a names file adds correction targets', () => {
    const idx = makeIndex(mergeNames(BUILTIN_NAMES, [{ n: 'הרב קוק', k: 'street', w: 3 }]));
    expect(suggestCorrections('הרב קוג', idx)[0]?.text).toBe('הרב קוק');
  });
});

describe('performance', () => {
  it('searches 200k names in well under 100 ms', async () => {
    const words = BUILTIN_NAMES.map((e) => e.n);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const names = Array.from({ length: 200_000 }, () => `${words[Math.floor(rnd() * words.length)]} ${Math.floor(rnd() * 300)}`);
    names.push('דיזנגוף');
    const big = await makeIndexAsync(names);
    searchIndex(big, 'warm up');
    const t = performance.now();
    const queries = ['דיזנגוב', 'עזראלי', 'tel avive', 'ירושליים', 'shzbdu;'];
    for (const q of queries) expect(searchIndex(big, q, { limit: 5 }).length).toBeGreaterThan(0);
    const per = (performance.now() - t) / queries.length;
    // Typically 10-40 ms on a laptop; generous for a loaded CI machine.
    expect(per).toBeLessThan(100);
  }, 60_000);
});
