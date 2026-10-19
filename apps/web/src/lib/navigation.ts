/** Only same-app paths are accepted as post-login destinations (no open redirects). */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/app';
}
