# Brand asset generation

Reproduces `apps/web/public/brand/*` and `apps/web/public/favicon.svg` from the supplied
"raclinic logo .pdf" (not stored in Git; ask the owner for the file). Run in the Codespace:

```bash
sudo apt-get install -y poppler-utils librsvg2-bin      # pdftocairo, rsvg-convert
mkdir -p /tmp/brand && cd /tmp/brand && cp "<path>/raclinic logo .pdf" raclinic.pdf
for p in 1 2; do pdftocairo -svg -f $p -l $p raclinic.pdf page$p.svg; done
node /workspaces/clinc-saas/scripts/brand/gen-brand.mjs out
cd out
rsvg-convert -w 1200 -h 630 og-source.svg -o og-image.png
rsvg-convert -w 180 -h 180 icon-on-white.svg -o apple-touch-icon.png
rsvg-convert -w 192 -h 192 favicon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 favicon.svg -o icon-512.png
rsvg-convert -w 32 -h 32 favicon.svg -o favicon-32.png
```

Then copy `raclinic-*.svg`, the PNGs and `favicon.svg` into `apps/web/public/brand/` (the
favicon to `apps/web/public/`). See [docs/BRAND.md](../../docs/BRAND.md).
