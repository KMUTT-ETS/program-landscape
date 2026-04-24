export * from './tokens';
export { default as tailwindPreset } from './tailwind-preset';
// Explicit re-export — `export *` through nested barrels doesn't always
// surface `type`-only identifiers to downstream consumers with strict
// moduleResolution. Spell it out so `import type { ModuleKey } from
// '@kku/design'` works from @kku/ui.
export { MODULE_KEYS, type ModuleKey } from './tokens/colors';
