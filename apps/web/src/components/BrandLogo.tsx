// The supplied raclinic artwork (docs/BRAND.md). Files in public/brand are the original vector
// paths from "raclinic logo .pdf", only cropped; they are shown at their own proportions
// (height set by CSS, width automatic) and never stretched, cropped or redrawn.
const VARIANTS = {
  // Horizontal wordmark with the pulse (PDF page 2): headers and the sidebar.
  wordmark: { src: '/brand/raclinic-wordmark.svg', width: 1048, height: 252 },
  // Stacked symbol + "ra / Clinic" (PDF page 1): sign-in, registration, onboarding.
  lockup: { src: '/brand/raclinic-lockup.svg', width: 1035, height: 345 },
  // Symbol only (PDF page 1, left part): compact places.
  symbol: { src: '/brand/raclinic-symbol.svg', width: 375, height: 308 },
} as const;

export type BrandVariant = keyof typeof VARIANTS;

export function BrandLogo({ variant = 'wordmark', className = '' }: { variant?: BrandVariant; className?: string }) {
  const asset = VARIANTS[variant];
  return (
    <img
      className={`brand-logo brand-logo--${variant} ${className}`.trim()}
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt="raclinic"
      decoding="async"
    />
  );
}
