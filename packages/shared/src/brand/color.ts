// OKLCH ⇄ sRGB maths (Björn Ottosson's OKLab, 2020) and WCAG 2.x contrast.
// Pure functions, no imports — this module ships to the browser through the
// `@kku/shared/brand` subpath.

export interface Oklch {
  /** Lightness 0..1 */
  l: number;
  c: number;
  /** Hue in degrees 0..360 */
  h: number;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type Rgb = [number, number, number];

const toLinear = (x: number): number => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toGamma = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function hexToLinear(hex: string): Rgb {
  if (!HEX_COLOR.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

function linearToOklch([r, g, b]: Rgb): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function hexToOklch(hex: string): Oklch {
  return linearToOklch(hexToLinear(hex));
}

/** Lowers chroma (only) until the colour fits sRGB. */
export function clampToGamut(o: Oklch): Oklch {
  if (inGamut(oklchToLinear(o))) return o;
  let lo = 0;
  let hi = o.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ ...o, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...o, c: lo };
}

export function oklchToHex(o: Oklch): string {
  const rgb = oklchToLinear(clampToGamut(o));
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

function luminance(o: Oklch): number {
  const [r, g, b] = oklchToLinear(clampToGamut(o)).map((v) => Math.min(1, Math.max(0, v))) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Same shape as the triplets in tokens.css: `70.0% 0.150 45`. */
export function formatOklch(o: Oklch): string {
  return `${(o.l * 100).toFixed(1)}% ${o.c.toFixed(3)} ${Math.round(o.h) % 360}`;
}
