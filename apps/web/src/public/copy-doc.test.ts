import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '../i18n/locales/ar.json';
import en from '../i18n/locales/en.json';
import { buildCopyDoc } from './copy-doc';

// jsdom gives import.meta.url an http: URL, so resolve from the file's directory instead.
const docPath = path.resolve(__dirname, '../../../../docs/PUBLIC_COPY.md');

/** Words that would advertise something raclinic does not do (checked in both languages). */
const FORBIDDEN = [
  /ذكاء اصطناعي/,
  /\bAI-powered\b|\bartificial intelligence\b|\bchatbot\b/i,
  /روبوت|شات ?بوت/,
  /مجان|free trial|free plan|for free|free of charge/i,
  /\b\d+\s*(EGP|SAR|USD)\b|جنيه|ريال/i,
  /معتمد|certified|compliant|HIPAA|ISO ?\d/i,
  /عملاؤنا|our customers|testimonial/i,
  /منصة العيادات|Clinics Platform/,
];

describe('public copy', () => {
  it('the review document matches the locale files', () => {
    const generated = buildCopyDoc(ar, en);
    if (process.env.UPDATE_COPY_DOC) writeFileSync(docPath, generated);
    expect(readFileSync(docPath, 'utf8')).toBe(generated);
  });

  it('makes no unsupported claims (AI, prices, free trials, certifications, customers)', () => {
    const texts = [JSON.stringify(ar.site), JSON.stringify(en.site), JSON.stringify(ar.app), JSON.stringify(en.app)];
    for (const text of texts) {
      // The FAQ answer that explicitly denies AI and diagnosis is the one allowed mention.
      const withoutDenial = text.replace(ar.site.home.faq.ai.q, '').replace(ar.site.home.faq.ai.a, '').replace(en.site.home.faq.ai.q, '').replace(en.site.home.faq.ai.a, '');
      for (const pattern of FORBIDDEN) expect(withoutDenial, String(pattern)).not.toMatch(pattern);
    }
  });

  it('uses the approved name, tagline and call to action', () => {
    expect([ar.app.name, en.app.name]).toEqual(['raclinic', 'raclinic']);
    expect(ar.app.tagline).toBe('مساعدك الذكي في كل تفاصيل العيادة');
    expect(en.app.tagline).toBe('Smart clinic management');
    expect(ar.site.cta.create).toBe('أنشئ مساحة عمل لعيادتك');
  });
});
