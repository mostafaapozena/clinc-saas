import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import catalogSeed from '../../../api/src/modules/specialties/specialty.seed.ts?raw';
import { safeNext } from '../lib/navigation';
import { parseSiteUrl, robotsTxt, sitemapXml } from '../lib/site-url';
import { apiError, mockApi, renderRoute } from '../test/render';
import { PUBLIC_PATHS, SOLUTIONS, SPECIALTY_SOLUTION_CODES } from './solutions';

const signedOut = { user: null, csrfToken: null, memberships: [] };
const user = { id: 'u1', email: 'new@example.test', displayName: 'Nada', preferredLanguage: 'ar', emailVerified: false };
const catalog = {
  data: [
    { code: 'dentistry', name: { ar: 'طب الأسنان', en: 'Dentistry' } },
    { code: 'physiotherapy', name: { ar: 'العلاج الطبيعي', en: 'Physiotherapy' } },
    { code: 'ent', name: { ar: 'الأنف والأذن والحنجرة', en: 'Ear, Nose & Throat' } },
  ],
};

/** Every internal link must lead to a route that exists (no dead CTAs). */
const KNOWN_ROUTES = [
  /^\/$/,
  /^\/solutions$/,
  new RegExp(`^/solutions/(${SOLUTIONS.map((s) => s.slug).join('|')})$`),
  /^\/custom-solutions$/,
  /^\/custom-solutions\/request(\?interest=[a-z_]+)?$/,
  /^\/start(\?(specialty=[a-z]+|type=medical_center))?$/,
  /^\/login$/,
  /^\/status$/,
  /^\/app$/,
];
function expectOnlyKnownLinks() {
  const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '').filter((h) => !h.startsWith('#'));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(KNOWN_ROUTES.some((re) => re.test(href)), href).toBe(true);
}

describe('post-login destinations', () => {
  it('accepts only internal workspace and onboarding paths', () => {
    expect(safeNext('/app/abc/queue')).toBe('/app/abc/queue');
    expect(safeNext('/onboarding?specialty=ent')).toBe('/onboarding?specialty=ent');
    for (const bad of ['//evil.example', '/\\evil.example', '/%5Cevil', 'https://evil.example/app', 'javascript:alert(1)', '/status', '/solutions', '/app\n/x', '', null]) {
      expect(safeNext(bad), String(bad)).toBe('/app');
    }
    expect(safeNext('/appointments-elsewhere')).toBe('/app');
    expect(safeNext('//evil', '/onboarding')).toBe('/onboarding');
  });
});

describe('indexing configuration', () => {
  it('accepts only plain https origins', () => {
    expect(parseSiteUrl('https://clinics.example/')).toBe('https://clinics.example');
    for (const bad of ['http://clinics.example', 'https://clinics.example/path', 'clinics.example', '', undefined]) expect(parseSiteUrl(bad)).toBeNull();
  });

  it('disallows everything unless indexing is enabled, and never lists private paths', () => {
    expect(robotsTxt(null, false)).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsTxt('https://clinics.example', false)).toBe('User-agent: *\nDisallow: /\n');
    const open = robotsTxt('https://clinics.example', true);
    expect(open).toContain('Disallow: /app');
    expect(open).toContain('Sitemap: https://clinics.example/sitemap.xml');
    const sitemap = sitemapXml('https://clinics.example', PUBLIC_PATHS);
    expect(sitemap).toContain('<loc>https://clinics.example/solutions/dentistry?lang=en</loc>');
    expect(sitemap).toContain('hreflang="x-default" href="https://clinics.example/solutions/dentistry"');
    for (const privatePath of ['/app', '/login', '/onboarding', '/start']) expect(sitemap).not.toContain(`clinics.example${privatePath}`);
  });
});

describe('solution catalog', () => {
  it('matches the platform specialty catalog exactly (no contradictory list, no radiology)', () => {
    const seeded = [...catalogSeed.matchAll(/code: '([a-z_-]+)'/g)].map((m) => m[1]);
    expect([...SPECIALTY_SOLUTION_CODES].sort()).toEqual([...seeded].sort());
    expect(SPECIALTY_SOLUTION_CODES).not.toContain('radiology');
  });
});

describe('public website', () => {
  it('home: Arabic by default, both paths, working entry points, honest notices, noindex here', async () => {
    mockApi({ 'GET /api/v1/auth/session': signedOut });
    renderRoute('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'عيادتك منظَّمة من أول حجز حتى آخر زيارة' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('hero-create')).toHaveAttribute('href', '/start');
    expect(screen.getByTestId('hero-create')).toHaveTextContent('أنشئ مساحة عمل لعيادتك');
    expect(screen.getAllByRole('link', { name: 'تسجيل الدخول' })[0]).toHaveAttribute('href', '/login');
    expect(screen.getAllByTestId('solution-card')).toHaveLength(4);
    expect(screen.getByTestId('solution-card-custom')).toHaveTextContent('مشروع مخصص');
    expect(screen.getByRole('heading', { name: 'غير متاح بعد' })).toBeInTheDocument();
    expect(screen.getByText(/لم تُعلن الأسعار وخطط الاشتراك بعد/)).toBeInTheDocument();
    expectOnlyKnownLinks();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(document.title).toBe('إدارة المواعيد والاستقبال وملفات المرضى · raclinic');
    const faq = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}');
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity).toHaveLength(8);
  });

  it('English via ?lang=en, left to right', async () => {
    mockApi({ 'GET /api/v1/auth/session': signedOut });
    renderRoute('/?lang=en');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your clinic, organized from the first booking to the last visit' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('a signed-in visitor is offered their workspace instead of sign-up', async () => {
    mockApi({ 'GET /api/v1/auth/session': { user, csrfToken: 'c', memberships: [] } });
    renderRoute('/solutions');
    const links = await screen.findAllByRole('link', { name: 'الانتقال إلى مساحة العمل' });
    expect(links.every((link) => link.getAttribute('href') === '/app')).toBe(true);
    expect(screen.queryByRole('link', { name: 'تسجيل الدخول' })).toBeNull();
  });

  it('solution pages separate what works today from planned tools, with both paths', async () => {
    mockApi({ 'GET /api/v1/auth/session': signedOut });
    renderRoute('/solutions/dentistry');
    expect(await screen.findByRole('heading', { level: 1, name: 'عيادات الأسنان' })).toBeInTheDocument();
    expect(within(screen.getByTestId('available-now')).getAllByRole('listitem').length).toBeGreaterThan(3);
    const planned = screen.getByTestId('planned-tools');
    expect(planned).toHaveTextContent('نسخة أولى');
    expect(planned).toHaveTextContent('مخطط الأسنان');
    expect(screen.getByTestId('solution-create')).toHaveAttribute('href', '/start?specialty=dentistry');
    expect(screen.getByTestId('solution-custom')).toHaveAttribute('href', '/custom-solutions/request?interest=dentistry');
    expectOnlyKnownLinks();
  });

  it('medical centers pre-select the center type; unknown solutions are not found and not indexed', async () => {
    mockApi({ 'GET /api/v1/auth/session': signedOut });
    const { router } = renderRoute('/solutions/medical-centers');
    expect(await screen.findByTestId('solution-create')).toHaveAttribute('href', '/start?type=medical_center');
    await router.navigate('/solutions/radiology');
    expect(await screen.findByRole('heading', { level: 1, name: 'الصفحة غير موجودة' })).toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });
});

describe('from a solution to the workspace setup', () => {
  it('keeps the chosen specialty through registration and pre-selects it in onboarding', async () => {
    let signedIn = false;
    mockApi({
      'GET /api/v1/auth/session': () => (signedIn ? { user, csrfToken: 'c', memberships: [] } : signedOut),
      'POST /api/v1/auth/register': () => {
        signedIn = true;
        return { user, csrfToken: 'c', memberships: [] };
      },
      'GET /api/v1/onboarding': { draft: null },
      'GET /api/v1/specialties': catalog,
    });
    const { router } = renderRoute('/start?specialty=ent&type=bogus');
    await screen.findByRole('heading', { name: 'إنشاء حساب' });
    expect(router.state.location.pathname).toBe('/register');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/onboarding?specialty=ent');

    fireEvent.change(screen.getByLabelText('الاسم الظاهر'), { target: { value: 'Nada' } });
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'new@example.test' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'long-enough-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء الحساب' }));

    expect(await screen.findByRole('heading', { name: 'إعداد المنشأة' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?specialty=ent');
    // The pre-selection waits on the specialties step.
    fireEvent.click(await screen.findByRole('radio', { name: /عيادة فردية/ }));
    expect(screen.getByLabelText('اسم المنشأة')).toHaveValue('');
  });

  it('a signed-in member is shown their workspaces first, not a new organization', async () => {
    mockApi({
      'GET /api/v1/auth/session': { user, csrfToken: 'c', memberships: [{ organization: { id: 'o1', name: 'عيادات النور' }, role: 'receptionist' }] },
      'GET /api/v1/onboarding': { draft: null },
      'GET /api/v1/specialties': catalog,
    });
    renderRoute('/start?specialty=dentistry');
    const existing = await screen.findByTestId('onboarding-existing');
    expect(within(existing).getByRole('link', { name: 'فتح عيادات النور' })).toHaveAttribute('href', '/app/o1');
    fireEvent.click(within(existing).getByRole('button', { name: 'إعداد منشأة جديدة' }));
    expect(await screen.findByTestId('onboarding-step-organization')).toBeInTheDocument();
  });

  it('resumes a saved draft at its step', async () => {
    mockApi({
      'GET /api/v1/auth/session': { user, csrfToken: 'c', memberships: [] },
      'GET /api/v1/specialties': catalog,
      'GET /api/v1/onboarding': {
        draft: {
          id: 'd1',
          status: 'draft',
          step: 'branch',
          version: 3,
          organizationId: null,
          updatedAt: '2026-10-20T10:00:00.000Z',
          data: {
            organizationType: 'medical_center',
            name: 'مركز التجربة',
            timeZone: 'Asia/Riyadh',
            specialtyCodes: ['dentistry', 'ent'],
            branch: { name: 'الفرع الأول', city: '', specialtyCodes: ['ent'] },
          },
        },
      },
    });
    renderRoute('/onboarding');
    expect(await screen.findByText('أنت تكمل إعدادًا بدأته من قبل.')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-step-branch')).toBeInTheDocument();
    expect(screen.getByLabelText('اسم الفرع الأول')).toHaveValue('الفرع الأول');
    // A branch can only offer the organization's specialties.
    expect(await screen.findByRole('checkbox', { name: 'الأنف والأذن والحنجرة' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'طب الأسنان' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'العلاج الطبيعي' })).toBeNull();
  });
});

describe('custom-ownership request', () => {
  it('sends one keyed request and shows only a reference', async () => {
    const fetchMock = mockApi({
      'GET /api/v1/auth/session': signedOut,
      'POST /api/v1/public/ownership-inquiries': { reference: 'R-ABCD2345', replayed: false },
    });
    renderRoute('/custom-solutions/request?interest=custom');
    expect(await screen.findByText(/لا تكتب في هذا النموذج أسماء مرضى/)).toBeInTheDocument();
    expect(screen.getByLabelText('ما الذي تهتم به؟')).toHaveValue('custom');
    fireEvent.change(screen.getByLabelText('اسمك'), { target: { value: 'هالة' } });
    fireEvent.change(screen.getByLabelText('اسم المنشأة'), { target: { value: 'مركز الأشعة' } });
    fireEvent.change(screen.getByLabelText('الدولة'), { target: { value: 'EG' } });
    fireEvent.change(screen.getByLabelText('نوع المنشأة'), { target: { value: 'medical_center' } });
    fireEvent.change(screen.getByLabelText('رقم الهاتف (اختياري)'), { target: { value: '٠١٠٠٠٠٠٠٠٠١' } });
    fireEvent.change(screen.getByLabelText('اشرح ما تحتاج إليه'), { target: { value: 'نظام لمركز أشعة بثلاثة فروع.' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب' }));

    expect(await screen.findByTestId('inquiry-reference')).toHaveTextContent('R-ABCD2345');
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/public/ownership-inquiries') as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ phone: { country: 'EG', number: '٠١٠٠٠٠٠٠٠٠١' }, interest: 'custom', country: 'EG' });
  });

  it('shows the server’s field errors in place', async () => {
    mockApi({
      'GET /api/v1/auth/session': signedOut,
      'POST /api/v1/public/ownership-inquiries': Response.json(
        { error: { code: 'VALIDATION_ERROR', message: 'x', fields: { contact: 'contact_required', description: 'too_short' } } },
        { status: 400 },
      ),
    });
    renderRoute('/custom-solutions/request');
    fireEvent.click(await screen.findByRole('button', { name: 'إرسال الطلب' }));
    expect(await screen.findByText('اكتب رقم هاتف أو بريدًا إلكترونيًا.')).toBeInTheDocument();
    expect(screen.getByText('اكتب ١٠ أحرف على الأقل.')).toBeInTheDocument();
  });

  it('reports a rate limit without losing what was typed', async () => {
    mockApi({ 'GET /api/v1/auth/session': signedOut, 'POST /api/v1/public/ownership-inquiries': apiError(429, 'RATE_LIMITED') });
    renderRoute('/custom-solutions/request');
    fireEvent.change(await screen.findByLabelText('اسمك'), { target: { value: 'هالة' } });
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByLabelText('اسمك')).toHaveValue('هالة');
  });
});
