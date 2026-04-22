import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard helper — merges class strings, de-duplicates Tailwind utilities
// so a caller's overrides win over the component's defaults.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
