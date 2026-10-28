import { useLayoutEffect, type RefObject } from 'react';

/**
 * Public-site motion (docs/UI_POLISH_IMPLEMENTATION.md, ANIM-01…03). One IntersectionObserver
 * marks `[data-reveal]` blocks `.is-visible` the first time they enter the screen; the hero frame
 * floats (`.is-floating`) only while the hero is on screen and the tab is visible.
 *
 * Content is hidden before its reveal only once `.site--motion` is on the layout, which this hook
 * adds when it can observe; without scripts, observers or with reduced motion everything is shown
 * as is. All movement is CSS (transform/opacity) inside `prefers-reduced-motion: no-preference`.
 */
export function useSiteMotion(root: RefObject<HTMLElement | null>) {
  // Layout effect: the class is in place before the first paint, so nothing flashes visible first.
  useLayoutEffect(() => {
    const site = root.current;
    if (!site || typeof IntersectionObserver === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          reveal.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );

    let heroOnScreen = false;
    const floating = () => {
      const on = heroOnScreen && document.visibilityState === 'visible';
      site.querySelectorAll('.site-hero').forEach((hero) => hero.classList.toggle('is-floating', on));
    };
    const hero = new IntersectionObserver((entries) => {
      heroOnScreen = entries.some((entry) => entry.isIntersecting);
      floating();
    });

    const seen = new WeakSet<Element>();
    const watch = () => {
      site.querySelectorAll('[data-reveal]:not(.is-visible), .site-hero').forEach((element) => {
        if (seen.has(element)) return;
        seen.add(element);
        (element.classList.contains('site-hero') ? hero : reveal).observe(element);
      });
    };
    // Pages are lazy routes: watch new content as it is rendered.
    const mutations = new MutationObserver(watch);
    mutations.observe(site, { childList: true, subtree: true });
    watch();
    site.classList.add('site--motion');
    document.addEventListener('visibilitychange', floating);

    return () => {
      site.classList.remove('site--motion');
      document.removeEventListener('visibilitychange', floating);
      mutations.disconnect();
      reveal.disconnect();
      hero.disconnect();
    };
  }, [root]);
}
