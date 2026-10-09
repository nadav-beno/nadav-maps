/** How contact details read on the place card. */

/** "+97235236058" -> "03-523-6058" for Israeli numbers; others as given. */
export function displayPhone(phone: string): string {
  const raw = phone.split(';')[0].trim();
  const digits = raw.replace(/[\s()-]/g, '');
  const m = /^(?:\+972|0)(\d{8,9})$/.exec(digits);
  if (!m) return raw;
  const n = `0${m[1]}`;
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}` : `${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5)}`;
}

export function socialLabel(url: string): string {
  if (/(^|\/\/|\.)facebook\.com/.test(url)) return 'פייסבוק';
  if (/(^|\/\/|\.)instagram\.com/.test(url)) return 'אינסטגרם';
  if (/(^|\/\/|\.)(twitter|x)\.com/.test(url)) return 'X (טוויטר)';
  if (/(^|\/\/|\.)tiktok\.com/.test(url)) return 'טיקטוק';
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}
