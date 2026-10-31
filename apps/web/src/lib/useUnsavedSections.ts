import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';

// Unsaved changes on a page of independent sections, each with its own form and Save (settings,
// UX-016). A form's values are captured when the viewer first focuses it and again on submit; a
// section is dirty while its form differs from that capture. Leaving the page with a dirty section
// asks first (route change and tab close).

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function snapshot(form: HTMLFormElement) {
  return Array.from(form.elements)
    .filter((e): e is Control => e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement)
    .map((e) => `${e.id || e.name}=${e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio') ? e.checked : e.value}`)
    .join('&');
}

const sectionOf = (form: HTMLFormElement) => form.closest('section[aria-labelledby]')?.getAttribute('aria-labelledby') ?? null;

/** Listens on the document: one page is mounted at a time, and the shell stays outside its sections. */
export function useUnsavedSections() {
  const saved = useRef(new WeakMap<HTMLFormElement, string>());
  const [dirty, setDirty] = useState<string[]>([]);

  useEffect(() => {
    const root = document;
    const mark = (section: string, isDirty: boolean) =>
      setDirty((list) => (isDirty ? (list.includes(section) ? list : [...list, section]) : list.filter((s) => s !== section)));
    const formOf = (event: Event) => (event.target instanceof Element ? event.target.closest('form') : null);
    const onFocus = (event: Event) => {
      const form = formOf(event);
      if (form && !saved.current.has(form)) saved.current.set(form, snapshot(form));
    };
    const onEdit = (event: Event) => {
      const form = formOf(event);
      const section = form && sectionOf(form);
      if (!form || !section) return;
      const before = saved.current.get(form);
      if (before !== undefined) mark(section, snapshot(form) !== before);
    };
    const onSubmit = (event: Event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const section = form && sectionOf(form);
      if (!form || !section) return;
      saved.current.set(form, snapshot(form));
      mark(section, false);
    };
    root.addEventListener('focusin', onFocus);
    root.addEventListener('input', onEdit);
    root.addEventListener('change', onEdit);
    root.addEventListener('submit', onSubmit);
    return () => {
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('input', onEdit);
      root.removeEventListener('change', onEdit);
      root.removeEventListener('submit', onSubmit);
    };
  }, []);

  // The section itself shows that it has unsaved changes.
  useEffect(() => {
    document.querySelectorAll('main section[aria-labelledby]').forEach((s) => {
      if (dirty.includes(s.getAttribute('aria-labelledby') ?? '')) s.setAttribute('data-dirty', 'true');
      else s.removeAttribute('data-dirty');
    });
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty.length > 0 && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.length]);

  return { dirty, blocker };
}
