import { describe, expect, it } from 'vitest';
import { brandCss } from '../src/brand';

describe('brandCss', () => {
  it('emits higher-specificity overrides for both modes', () => {
    const css = brandCss({ light: { 'accent-default': '70.0% 0.150 45' }, dark: { 'accent-default': '53.0% 0.180 45' } });
    expect(css).toBe(
      "html[data-theme='light']{--color-accent-default:70.0% 0.150 45;}" +
        "html[data-theme='dark']{--color-accent-default:53.0% 0.180 45;}",
    );
  });

  it('drops unknown token names and values that are not strict OKLCH triplets', () => {
    const css = brandCss({
      light: {
        'accent-default': '70.0% 0.150 45;}body{display:none',
        'surface-0': '99.0% 0.008 70',
        'accent-hover': '76.0% 0.140 45',
      },
      dark: 'nope',
    });
    expect(css).toBe("html[data-theme='light']{--color-accent-hover:76.0% 0.140 45;}");
  });

  it('returns an empty string for null, garbage or empty input', () => {
    expect(brandCss(null)).toBe('');
    expect(brandCss('x')).toBe('');
    expect(brandCss({ light: {}, dark: {} })).toBe('');
  });
});
