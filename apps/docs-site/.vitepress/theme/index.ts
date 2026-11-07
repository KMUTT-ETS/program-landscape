import DefaultTheme from 'vitepress/theme';
import type { EnhanceAppContext, Theme } from 'vitepress';
import DeepDiveDataMap from './deep-dive-data-map/DeepDiveDataMap.vue';
import './custom.css';

type VueComponent = Parameters<EnhanceAppContext['app']['component']>[1];

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // Used by docs/adopters/deep-dive-data-map.md.
    app.component('DeepDiveDataMap', DeepDiveDataMap as VueComponent);
  },
} satisfies Theme;
