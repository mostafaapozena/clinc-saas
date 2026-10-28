/* global window, document */
// Applies the saved light/dark theme before the first paint, so the page does not flash the
// wrong theme. A separate file because the Content-Security-Policy blocks inline scripts.
// Same rule as src/lib/theme.ts: a saved "light"/"dark" wins, otherwise the system preference.
(function () {
  var saved;
  try {
    saved = window.localStorage.getItem('clinc.theme');
  } catch {
    saved = null;
  }
  var dark = saved === 'dark';
  if (saved !== 'dark' && saved !== 'light') {
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      dark = false;
    }
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
