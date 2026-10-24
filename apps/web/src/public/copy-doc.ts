// Builds docs/PUBLIC_COPY.md — the complete public, sign-in and onboarding wording, by page, in
// Arabic and English side by side — from the locale files. copy-doc.test.ts fails when the
// document and the locale files differ; regenerate with
//   UPDATE_COPY_DOC=1 npx vitest run --project web src/public/copy-doc.test.ts
type Tree = { [key: string]: unknown };

const SECTIONS: { title: string; paths: string[] }[] = [
  { title: 'Brand and navigation (every public page)', paths: ['app.name', 'app.tagline', 'site.nav', 'site.cta', 'site.notice', 'site.footer'] },
  { title: 'Home page (`/`)', paths: ['site.home', 'site.shared'] },
  { title: 'Hosted workspace vs custom project (home, solution pages, custom page)', paths: ['site.compare'] },
  { title: 'Solutions catalog (`/solutions`) and shared solution labels', paths: ['site.solutions.metaTitle', 'site.solutions.metaDescription', 'site.solutions.title', 'site.solutions.lead', 'site.solutions.labels', 'site.solutions.customCard'] },
  { title: 'Dental clinics (`/solutions/dentistry`)', paths: ['site.solutions.dentistry'] },
  { title: 'Physiotherapy centers (`/solutions/physiotherapy`)', paths: ['site.solutions.physiotherapy'] },
  { title: 'ENT clinics (`/solutions/ent`)', paths: ['site.solutions.ent'] },
  { title: 'Multi-specialty medical centers (`/solutions/medical-centers`)', paths: ['site.solutions.medicalCenters'] },
  { title: 'Custom projects (`/custom-solutions`)', paths: ['site.custom'] },
  { title: 'Custom-project request form (`/custom-solutions/request`)', paths: ['site.inquiry'] },
  { title: 'Workspace creation entry and not-found page', paths: ['site.start', 'site.notFound'] },
  { title: 'Sign in and registration', paths: ['auth'] },
  { title: 'Organization setup (onboarding)', paths: ['onboarding'] },
];

function at(tree: Tree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Tree)[key] : undefined), tree);
}

function leaves(value: unknown, prefix: string): [string, unknown][] {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) return [[prefix, value]];
  return Object.entries(value as Tree).flatMap(([key, child]) => leaves(child, `${prefix}.${key}`));
}

const cell = (value: unknown) =>
  (Array.isArray(value) ? value.map((item) => `• ${String(item)}`).join('<br>') : String(value ?? '—')).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function buildCopyDoc(ar: Tree, en: Tree): string {
  const lines = [
    '# raclinic public wording — review copy',
    '',
    '_Generated from `apps/web/src/i18n/locales/{ar,en}.json`; do not edit by hand (see',
    '`apps/web/src/public/copy-doc.ts`). Status: **provisional, pending owner review in the phase 4 PR.**_',
    '',
    'Each table lists every string of one page or block. "Key" is the translation key, for reference',
    'when asking for a change.',
  ];
  for (const section of SECTIONS) {
    lines.push('', `## ${section.title}`, '', '| Key | العربية | English |', '| --- | --- | --- |');
    for (const path of section.paths) {
      for (const [key, arValue] of leaves(at(ar, path), path)) {
        lines.push(`| \`${key}\` | ${cell(arValue)} | ${cell(at(en, key))} |`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
