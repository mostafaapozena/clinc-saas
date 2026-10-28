import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountUp } from '../components/CountUp';
import { ThemeSelect, ThemeSwitcher } from '../components/ThemeSwitcher';
import '../i18n';
import { THEME_STORAGE_KEY, initTheme, readThemePreference, resolveTheme } from './theme';

// One light/dark preference for the whole product (docs/UI_POLISH_IMPLEMENTATION.md, THEME-*).
function systemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.unstubAllGlobals());

describe('theme preference', () => {
  it('follows the system when nothing is saved, and is light without that signal', () => {
    expect(readThemePreference()).toBe('system');
    expect(resolveTheme('system')).toBe('light');
    systemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('a saved choice wins over the system preference', () => {
    systemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('the header switch toggles the theme, names the action and remembers it', () => {
    render(<ThemeSwitcher />);
    const toDark = screen.getByRole('button', { name: 'التبديل إلى الوضع الداكن' });
    fireEvent.click(toDark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'التبديل إلى الوضع الفاتح' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('"same as the device" forgets the saved choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeSelect id="theme" />);
    const select = screen.getByLabelText('المظهر');
    expect(select).toHaveValue('dark');
    fireEvent.change(select, { target: { value: 'system' } });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('CountUp', () => {
  it('renders the exact final value when animation is not possible (no matchMedia, reduced motion)', () => {
    const { container, unmount } = render(<CountUp value={1234} />);
    expect(container).toHaveTextContent('1,234');
    unmount();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<CountUp value={7} />);
    expect(screen.getByText('7')).toBeVisible();
  });

  it('counts once to the real value, offering only the final value to screen readers meanwhile', () => {
    systemDark(false);
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { container, rerender } = render(<CountUp value={40} duration={100} />);
    const [moving, final] = container.querySelectorAll('.count-up > span');
    expect(moving).toHaveAttribute('aria-hidden', 'true');
    expect(moving).toHaveTextContent('0');
    expect(final).toHaveClass('visually-hidden');
    expect(final).toHaveTextContent('40');
    act(() => {
      now = 50;
      frames.shift()?.(now);
    });
    expect(Number(moving!.textContent)).toBeGreaterThan(0);
    expect(Number(moving!.textContent)).toBeLessThan(40);
    // A new value (another branch) is shown as it is, not animated from the old one.
    rerender(<CountUp value={3} duration={100} />);
    act(() => {
      now = 60;
      frames.shift()?.(now);
    });
    expect(final).not.toHaveClass('visually-hidden');
    expect(final).toHaveTextContent('3');
    expect(moving).not.toBeVisible();
  });
});
