// tsc cannot see `vue` from this package (pnpm keeps it inside vitepress), so .vue
// imports are typed as unknown here and cast where the theme registers them.
declare module '*.vue' {
  const component: unknown;
  export default component;
}
