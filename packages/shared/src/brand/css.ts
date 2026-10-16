import { BRAND_TOKEN_NAMES, type BrandTokenName } from './derive';

// Turns stored tokens into the <style> the root layout injects. The input is
// read back from the database, so it is treated as untrusted: only whitelisted
// token names and strict `L% C H` values survive — nothing else can reach the
// page's CSS. `html[data-theme=…]` outranks tokens.css's `[data-theme=…]`
// regardless of stylesheet order.

const VALUE = /^\d{1,3}\.\d% \d\.\d{3} \d{1,3}$/;
const MODES = ['light', 'dark'] as const;

export function brandCss(tokens: unknown): string {
  if (!tokens || typeof tokens !== 'object') return '';
  let css = '';
  for (const mode of MODES) {
    const block = (tokens as Record<string, unknown>)[mode];
    if (!block || typeof block !== 'object') continue;
    let decls = '';
    for (const name of BRAND_TOKEN_NAMES) {
      const v = (block as Record<string, unknown>)[name as BrandTokenName];
      if (typeof v === 'string' && VALUE.test(v)) decls += `--color-${name}:${v};`;
    }
    if (decls) css += `html[data-theme='${mode}']{${decls}}`;
  }
  return css;
}
