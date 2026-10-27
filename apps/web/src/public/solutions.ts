// Public solution pages. Pure data with no runtime imports, so vite.config.ts can use it for the
// sitemap. The specialty solutions mirror the platform catalog (apps/api/src/modules/specialties/
// specialty.seed.ts) — a test keeps them in sync. Radiology and other complex specialties are not
// SaaS solutions: they belong to the custom-ownership path.

export type SolutionKey = 'dentistry' | 'physiotherapy' | 'ent' | 'medicalCenters';
export type SolutionSlug = 'dentistry' | 'physiotherapy' | 'ent' | 'medical-centers';

export type Solution = {
  slug: SolutionSlug;
  /** Translation key under site.solutions.<key>. */
  key: SolutionKey;
  /** Catalog specialty this page is about (null for multi-specialty centers). */
  specialtyCode: string | null;
  /** What "create your clinic workspace" pre-selects in onboarding. */
  start: { specialty?: string; type?: 'medical_center' };
  /** The interest pre-selected on the custom-ownership request form. */
  inquiryInterest: string;
  /** Icon name (components/Icon.tsx) and accent class (public.css `tone-*`). */
  icon: 'tooth' | 'activity' | 'ear' | 'layers';
  tone: 'dentistry' | 'physiotherapy' | 'ent' | 'centers';
  /** Real workspace screenshot (synthetic data) under /product/<lang>/<shot>.jpg. */
  shot: string;
};

export const SOLUTIONS: readonly Solution[] = [
  { slug: 'dentistry', key: 'dentistry', specialtyCode: 'dentistry', start: { specialty: 'dentistry' }, inquiryInterest: 'dentistry', icon: 'tooth', tone: 'dentistry', shot: 'dental' },
  { slug: 'physiotherapy', key: 'physiotherapy', specialtyCode: 'physiotherapy', start: { specialty: 'physiotherapy' }, inquiryInterest: 'physiotherapy', icon: 'activity', tone: 'physiotherapy', shot: 'physio' },
  { slug: 'ent', key: 'ent', specialtyCode: 'ent', start: { specialty: 'ent' }, inquiryInterest: 'ent', icon: 'ear', tone: 'ent', shot: 'ent' },
  { slug: 'medical-centers', key: 'medicalCenters', specialtyCode: null, start: { type: 'medical_center' }, inquiryInterest: 'multi_specialty', icon: 'layers', tone: 'centers', shot: 'week' },
];

export const SPECIALTY_SOLUTION_CODES = SOLUTIONS.flatMap((s) => (s.specialtyCode ? [s.specialtyCode] : []));

/** Interests offered on the custom-ownership form (catalog specialties plus two custom options). */
export const INQUIRY_INTERESTS = [...SPECIALTY_SOLUTION_CODES, 'multi_specialty', 'custom'] as const;

export const findSolution = (slug: string | undefined) => SOLUTIONS.find((s) => s.slug === slug);

/** The workspace-creation entry point, carrying a pre-selection (validated again by the server). */
export function startPath(start: Solution['start'] = {}): string {
  const params = new URLSearchParams();
  if (start.specialty) params.set('specialty', start.specialty);
  if (start.type) params.set('type', start.type);
  const query = params.toString();
  return query ? `/start?${query}` : '/start';
}

export const inquiryPath = (interest?: string) => (interest ? `/custom-solutions/request?interest=${interest}` : '/custom-solutions/request');

/** Indexable public pages (sign-in, onboarding and the workspace are never listed). */
export const PUBLIC_PATHS: readonly string[] = [
  '/',
  '/solutions',
  ...SOLUTIONS.map((s) => `/solutions/${s.slug}`),
  '/custom-solutions',
  '/custom-solutions/request',
  '/tour',
  '/about',
  '/contact',
  '/faq',
  '/security',
  '/privacy',
];

/** A real workspace screenshot (synthetic demo data) in the page language. */
export const productShot = (name: string, language: string) => `/product/${language === 'en' ? 'en' : 'ar'}/${name}.jpg`;
