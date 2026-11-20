import { describe, expect, it } from 'vitest';
import { fitNoteText } from './draw';

// Every character as wide as half the font size: enough to tell short from long text.
const measure = (text: string, size: number) => text.length * size * 0.5;

describe('note text', () => {
  it('writes a short note large and makes the font smaller as the text grows, down to a floor', () => {
    const short = fitNoteText('Idee', 200, 200, measure);
    const long = fitNoteText('Wir sollten das Onboarding neu denken und mit den Kunden zuerst sprechen, bevor wir bauen', 200, 200, measure);
    const endless = fitNoteText('wort '.repeat(400), 200, 200, measure);
    expect(short.fontSize).toBeGreaterThan(long.fontSize);
    expect(long.lines.length * long.lineHeight).toBeLessThanOrEqual(200);
    expect(long.lines.join(' ')).toBe('Wir sollten das Onboarding neu denken und mit den Kunden zuerst sprechen, bevor wir bauen');
    expect(endless.fontSize).toBe(10);
  });
});
