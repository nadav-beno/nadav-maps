import { describe, expect, it } from 'vitest';
import { displayPhone, socialLabel } from './contact.ts';

describe('contact formatting', () => {
  it('formats Israeli phone numbers the local way', () => {
    expect(displayPhone('+97235236058')).toBe('03-523-6058');
    expect(displayPhone('+972 52-123-4567')).toBe('052-123-4567');
    expect(displayPhone('03 523 6058; 03 523 6059')).toBe('03-523-6058');
  });
  it('leaves foreign numbers as given', () => {
    expect(displayPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });
  it('names social networks', () => {
    expect(socialLabel('https://www.facebook.com/123')).toBe('פייסבוק');
    expect(socialLabel('https://instagram.com/bistro')).toBe('אינסטגרם');
    expect(socialLabel('https://x.com/bistro')).toBe('X (טוויטר)');
    expect(socialLabel('https://www.box.com/bistro/')).toBe('box.com/bistro');
  });
});
