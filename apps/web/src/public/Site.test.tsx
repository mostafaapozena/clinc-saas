import { existsSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderRoute } from '../test/render';
import { PUBLIC_PATHS, SOLUTIONS } from './solutions';

// The redesigned public website (docs/FRONTEND_REDESIGN_IMPLEMENTATION.md): navigation, footer,
// the new pages, the contact form and the product screenshots.
const signedOut = { user: null, csrfToken: null, memberships: [] };
const noContact = { contact: { email: null, phone: null, hours: null } };
const site = (extra: Record<string, unknown> = {}) => mockApi({ 'GET /api/v1/auth/session': signedOut, 'GET /api/v1/public/support-contact': noContact, ...extra });

/** Every internal link of a public page leads to a route that exists. */
const KNOWN = [
  /^\/$/,
  /^\/solutions(\/[a-z-]+)?$/,
  /^\/custom-solutions(\/request(\?interest=[a-z_]+)?)?$/,
  /^\/(tour|about|contact|faq|security|privacy|login|status|app)$/,
  /^\/start(\?(specialty=[a-z]+|type=medical_center))?$/,
  /^\/product\/(ar|en)\/[a-z]+\.jpg$/,
];

describe('every public page', () => {
  it.each(PUBLIC_PATHS)('%s renders one heading and only working links', async (route) => {
    site();
    renderRoute(route);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '').filter((h) => !h.startsWith('#'));
    for (const href of hrefs) expect(KNOWN.some((re) => re.test(href)), `${route} → ${href}`).toBe(true);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('uses only product screenshots that exist, in both languages', () => {
    const shots = new Set(['appointments', 'record', 'finance', 'week', 'patients', 'home', 'services', ...SOLUTIONS.map((s) => s.shot)]);
    for (const language of ['ar', 'en']) {
      for (const shot of shots) expect(existsSync(path.resolve(__dirname, `../../public/product/${language}/${shot}.jpg`)), `${language}/${shot}`).toBe(true);
    }
  });
});

describe('header and footer', () => {
  it('opens the solutions menu with every solution and the custom path, and closes on Escape', async () => {
    site();
    renderRoute('/');
    const trigger = await screen.findByRole('button', { name: /^الحلول/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = document.getElementById('menu-solutions')!;
    expect(within(menu).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      ...SOLUTIONS.map((s) => `/solutions/${s.slug}`),
      '/custom-solutions',
      '/solutions',
    ]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('has grouped footer links to real pages, and the company menu lists the company pages', async () => {
    site();
    renderRoute('/about');
    const footer = (await screen.findByRole('contentinfo')) as HTMLElement;
    for (const name of ['الحلول', 'المنتج', 'الشركة', 'الحساب']) expect(within(footer).getByRole('heading', { name })).toBeInTheDocument();
    // In the company column and again in the bottom bar.
    expect(within(footer).getAllByRole('link', { name: 'الخصوصية' }).map((a) => a.getAttribute('href'))).toEqual(['/privacy', '/privacy']);
    expect(footer).toHaveTextContent('Devware');
    fireEvent.click(screen.getByRole('button', { name: /^الشركة/ }));
    expect(within(document.getElementById('menu-company')!).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/about', '/contact', '/security', '/privacy']);
  });
});

describe('contact page', () => {
  it('asks for a name and a way to reply, then stores the message once and shows its reference', async () => {
    const bodies: unknown[] = [];
    const keys: string[] = [];
    site({
      'POST /api/v1/public/contact-messages': (init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
        return Response.json({ reference: 'C-ABCDEFGH', replayed: false }, { status: 201 });
      },
    });
    renderRoute('/contact');
    expect(await screen.findByTestId('contact-no-channels')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    expect(await screen.findByText('اكتب اسمك.')).toBeInTheDocument();
    expect(screen.getByText('اكتب بريدًا إلكترونيًا أو رقم هاتف لنتمكن من الرد عليك.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.id).toBe('contact-name'));

    fireEvent.click(screen.getByRole('radio', { name: 'سؤال عن raclinic' }));
    fireEvent.change(screen.getByLabelText('اسمك'), { target: { value: 'سلمى عادل' } });
    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني/), { target: { value: 'salma@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    fireEvent.change(await screen.findByLabelText('رسالتك'), { target: { value: 'هل يدعم raclinic عدة فروع؟' } });
    fireEvent.change(screen.getByLabelText(/التخصص/), { target: { value: 'ent' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الرسالة' }));

    expect(await screen.findByTestId('contact-reference')).toHaveTextContent('C-ABCDEFGH');
    expect(bodies).toEqual([
      { intent: 'question', contactName: 'سلمى عادل', email: 'salma@example.test', specialty: 'ent', message: 'هل يدعم raclinic عدة فروع؟', language: 'ar' },
    ]);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,}$/);
    expect(screen.getByText(/لا يُرسل بريد تلقائي/)).toBeInTheDocument();
  });

  it('shows only the configured contact channels', async () => {
    site({ 'GET /api/v1/public/support-contact': { contact: { email: 'help@example.test', phone: null, hours: null } } });
    renderRoute('/contact');
    expect(await screen.findByRole('link', { name: 'help@example.test' })).toHaveAttribute('href', 'mailto:help@example.test');
    expect(screen.queryByTestId('contact-no-channels')).toBeNull();
    expect(screen.queryByText('الهاتف')).toBeNull();
  });

  it('returns to the first step when the server rejects a contact detail', async () => {
    site({
      'POST /api/v1/public/contact-messages': Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'x', fields: { 'phone.number': 'invalid_phone' } } },
        { status: 400 },
      ),
    });
    renderRoute('/contact');
    fireEvent.change(await screen.findByLabelText('اسمك'), { target: { value: 'Omar' } });
    fireEvent.change(screen.getByLabelText('رقم الهاتف (اختياري)'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /التالي/ }));
    fireEvent.change(await screen.findByLabelText('رسالتك'), { target: { value: 'A question that is long enough.' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الرسالة' }));
    expect(await screen.findByText('رقم الهاتف غير صحيح للدولة المختارة.')).toBeInTheDocument();
    expect(screen.getByLabelText('اسمك')).toHaveValue('Omar');
  });
});

describe('FAQ page', () => {
  it('filters by category and by search (Arabic spelling variants), and marks up every question', async () => {
    site();
    renderRoute('/faq');
    const list = await screen.findByTestId('faq-list');
    const total = within(list).getAllByRole('group').length;
    expect(total).toBeGreaterThan(15);
    const data = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}');
    expect(data.mainEntity).toHaveLength(total);

    fireEvent.click(screen.getByRole('button', { name: /البيانات والخصوصية/ }));
    expect(within(screen.getByTestId('faq-list')).getAllByRole('group').length).toBeLessThan(total);
    fireEvent.click(screen.getByRole('button', { name: /^الكل/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'الاسنان' } }); // "الأسنان" without the hamza
    expect(within(screen.getByTestId('faq-list')).getAllByRole('group').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } });
    expect(screen.getByText('لا توجد أسئلة تطابق بحثك.')).toBeInTheDocument();
  });
});

describe('product tour', () => {
  it('shows real screenshots in the page language', async () => {
    site();
    renderRoute('/tour?lang=en');
    await screen.findByRole('heading', { level: 1, name: 'raclinic as it is' });
    const images = [...document.querySelectorAll('img[src^="/product/"]')].map((img) => img.getAttribute('src'));
    expect(images.length).toBeGreaterThan(8);
    expect(images.every((src) => src?.startsWith('/product/en/'))).toBe(true);
  });
});
