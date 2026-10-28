// Short confirmations of a finished action ("Checked in", "Visit completed"), shown in one polite
// live region of the layout. They outlive the button that triggered them: a queue entry moves to
// another list as soon as its status changes, taking any inline message with it (UX-023).

export type Toast = { id: number; message: string };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const VISIBLE_MS = 5000;

export function showToast(message: string) {
  const toast = { id: nextId++, message };
  toasts = [...toasts.slice(-2), toast];
  emit();
  window.setTimeout(() => dismissToast(toast.id), VISIBLE_MS);
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const currentToasts = () => toasts;
