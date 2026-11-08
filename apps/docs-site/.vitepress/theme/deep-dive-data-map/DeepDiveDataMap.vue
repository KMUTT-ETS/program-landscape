<script setup lang="ts">
// Interactive map of which inputs feed which Deep-Dive health-score drivers.
// Content and its drift test: see ./data.ts. Rendered at build time, so the
// table and cards are readable without JavaScript; only highlighting needs it.
import { computed, ref } from 'vue';
import {
  INPUT_KIND_LABEL,
  MAP_DIMENSIONS,
  MAP_DRIVERS,
  MAP_INPUTS,
  MAP_SECTIONS,
  type InputKind,
  type MapDriver,
} from './data';

const KIND_ORDER: readonly InputKind[] = ['setting', 'sheet', 'connector', 'pipeline'];
const inputById = new Map(MAP_INPUTS.map((i) => [i.id, i]));
const dimById = new Map(MAP_DIMENSIONS.map((d) => [d.id, d]));

const selected = ref<string | null>(null);
const select = (id: string): void => {
  selected.value = selected.value === id ? null : id;
};

const reads = (d: MapDriver): string[] => [...d.in, ...(d.alsoReads ?? [])];
const scoring = (d: MapDriver): boolean => !d.award && !d.rollupOnly;
const scoringCount = MAP_DRIVERS.filter(scoring).length;

const groups = KIND_ORDER.map((kind) => ({
  kind,
  label: INPUT_KIND_LABEL[kind],
  inputs: MAP_INPUTS.filter((i) => i.kind === kind),
}));

function cellCount(inputId: string, dimId: string): number {
  return MAP_DRIVERS.filter((d) => scoring(d) && d.dimension === dimId && reads(d).includes(inputId)).length;
}
function sectionCount(inputId: string): number {
  return MAP_SECTIONS.filter((s) => s.in.includes(inputId)).length;
}

const cards = MAP_DIMENSIONS.map((dim) => ({
  dim,
  count: MAP_DRIVERS.filter((d) => d.dimension === dim.id && scoring(d)).length,
  drivers: MAP_DRIVERS.filter((d) => d.dimension === dim.id),
}));

const summary = computed(() => {
  const id = selected.value;
  if (!id) return null;
  const input = inputById.get(id)!;
  const drivers = MAP_DRIVERS.filter((d) => scoring(d) && reads(d).includes(id));
  const dims = [...new Set(drivers.map((d) => dimById.get(d.dimension)!.name))];
  const sections = MAP_SECTIONS.filter((s) => s.in.includes(id)).map((s) => s.name);
  let text = ` feeds ${drivers.length} score driver${drivers.length === 1 ? '' : 's'}`;
  if (dims.length) text += ` in ${dims.join(', ')}`;
  if (sections.length) text += ` and ${sections.length} other section${sections.length === 1 ? '' : 's'} (${sections.join(', ')})`;
  return { name: input.name, text: `${text}.` };
});

const hit = (d: MapDriver): boolean => selected.value !== null && reads(d).includes(selected.value);
</script>

<template>
  <div class="ddm vp-raw">
    <ol class="ddm-flow" aria-label="From source data to one health score">
      <li>
        <span class="ddm-n">Stage 1</span>
        <strong>Inputs</strong>
        <span v-for="k in KIND_ORDER" :key="k" class="ddm-kind"><span :class="['ddm-sw', k]" />{{ INPUT_KIND_LABEL[k] }}</span>
      </li>
      <li>
        <span class="ddm-n">Stage 2</span>
        <strong>Validated tables</strong>
        <span class="ddm-p">One bad row refuses the whole file. Each stored row remembers the upload or connector run that made it; rows that cannot be traced are hidden.</span>
      </li>
      <li>
        <span class="ddm-n">Stage 3</span>
        <strong>{{ scoringCount }} drivers</strong>
        <span class="ddm-p">Each turns figures into a 0–100 value, or null when its data is missing.</span>
      </li>
      <li>
        <span class="ddm-n">Stage 4</span>
        <strong>5 dimension scores</strong>
        <span v-for="c in cards" :key="c.dim.id" class="ddm-kind"><span class="ddm-dot" :style="{ background: c.dim.color }" />{{ c.dim.name }} · {{ c.count }}</span>
      </li>
      <li>
        <span class="ddm-n">Stage 5</span>
        <strong>Overall health</strong>
        <span class="ddm-p">Equal-weight average of the five scores.</span>
        <span class="ddm-band"><b>66–100</b> healthy</span>
        <span class="ddm-band"><b>40–65</b> needs attention</span>
        <span class="ddm-band"><b>0–39</b> danger zone</span>
      </li>
    </ol>

    <p class="ddm-legend">
      <span v-for="k in KIND_ORDER" :key="k" class="ddm-kind"><span :class="['ddm-sw', k]" />{{ INPUT_KIND_LABEL[k] }}</span>
      <span class="ddm-kind"><span class="ddm-core">core</span> load first</span>
    </p>
    <div class="ddm-tablebox">
      <table>
        <thead>
          <tr>
            <th>Input</th>
            <th v-for="d in MAP_DIMENSIONS" :key="d.id" class="c">
              <span class="ddm-kind"><span class="ddm-dot" :style="{ background: d.color }" />{{ d.name }}</span>
            </th>
            <th class="c">Other sections</th>
          </tr>
        </thead>
        <tbody v-for="g in groups" :key="g.kind">
          <tr class="ddm-group">
            <td :colspan="MAP_DIMENSIONS.length + 2"><span class="ddm-kind"><span :class="['ddm-sw', g.kind]" />{{ g.label }}</span></td>
          </tr>
          <tr
            v-for="i in g.inputs"
            :key="i.id"
            :class="{ sel: selected === i.id }"
            tabindex="0"
            role="button"
            :aria-pressed="selected === i.id"
            @click="select(i.id)"
            @keydown.enter.prevent="select(i.id)"
            @keydown.space.prevent="select(i.id)"
          >
            <td>
              <div class="ddm-name">{{ i.name }}<span v-if="i.core" class="ddm-core">core</span></div>
              <div class="ddm-where">{{ i.where }}</div>
            </td>
            <td v-for="d in MAP_DIMENSIONS" :key="d.id" class="c">
              <span v-if="cellCount(i.id, d.id)" class="ddm-count" :style="{ background: d.color }">{{ cellCount(i.id, d.id) }}</span>
              <span v-else class="ddm-none">·</span>
            </td>
            <td class="c">
              <span v-if="sectionCount(i.id)" class="ddm-count ddm-count-grey">{{ sectionCount(i.id) }}</span>
              <span v-else class="ddm-none">·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="ddm-selbar" aria-live="polite">
      <span v-if="summary"><b>{{ summary.name }}</b>{{ summary.text }}</span>
      <span v-else>Nothing selected. Pick a row in the table or a chip in a card below.</span>
      <button v-if="selected" type="button" class="ddm-clear" @click="selected = null">Clear selection</button>
    </div>

    <div :class="['ddm-cards', { filtering: selected !== null }]">
      <article v-for="c in cards" :key="c.dim.id" class="ddm-card" :style="{ '--ddm-c': c.dim.color }">
        <header>
          <strong class="ddm-card-title">{{ c.dim.name }}</strong>
          <span class="ddm-q">{{ c.dim.question }}</span>
          <span class="ddm-meta">{{ c.count }} drivers · equal weight</span>
        </header>
        <div
          v-for="d in c.drivers"
          :key="d.key"
          :class="['ddm-drv', { award: d.award, rollup: d.rollupOnly, hit: hit(d) }]"
        >
          <div class="ddm-top">
            <span class="ddm-dname">{{ d.name }}</span>
            <code class="ddm-key">{{ d.award ? 'award' : d.key }}</code>
          </div>
          <span v-if="d.rollupOnly" class="ddm-tag">Faculty, department and university scores only</span>
          <span class="ddm-how">{{ d.how }}</span>
          <span v-if="d.note" class="ddm-note">{{ d.note }}</span>
          <span class="ddm-chips">
            <button
              v-for="id in reads(d)"
              :key="id"
              type="button"
              :class="['ddm-chip', { on: selected === id }]"
              @click="select(id)"
            ><span :class="['ddm-sw', inputById.get(id)!.kind]" />{{ inputById.get(id)!.name }}</button>
          </span>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.ddm { display: grid; gap: 20px; margin: 24px 0; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-1); }
.ddm-kind { display: inline-flex; align-items: center; gap: 6px; }
.ddm-sw { width: 9px; height: 9px; flex: none; display: inline-block; background: var(--vp-c-text-2); }
.ddm-sw.setting { background: transparent; border: 1.5px solid var(--vp-c-text-2); border-radius: 2px; }
.ddm-sw.sheet { border-radius: 2px; }
.ddm-sw.connector { border-radius: 50%; }
.ddm-sw.pipeline { transform: rotate(45deg) scale(0.85); }
.ddm-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; display: inline-block; }

.ddm-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border: 1px solid var(--vp-c-divider); border-radius: 8px; background: var(--vp-c-bg-soft); }
.ddm-flow li { margin: 0; padding: 14px; display: flex; flex-direction: column; gap: 5px; min-width: 0; position: relative; font-size: 13px; }
.ddm-flow li + li { border-left: 1px solid var(--vp-c-divider); }
.ddm-flow li + li::before { content: ''; position: absolute; left: -6px; top: 22px; width: 10px; height: 10px; background: var(--vp-c-bg-soft); border-top: 1px solid var(--vp-c-divider); border-right: 1px solid var(--vp-c-divider); transform: rotate(45deg); }
.ddm-flow strong { font-size: 14px; }
.ddm-n { font-family: var(--vp-font-family-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vp-c-text-2); }
.ddm-p { color: var(--vp-c-text-2); }
.ddm-band b { font-family: var(--vp-font-family-mono); font-weight: 500; display: inline-block; min-width: 52px; }
@media (max-width: 760px) {
  .ddm-flow { grid-template-columns: 1fr; }
  .ddm-flow li + li { border-left: 0; border-top: 1px solid var(--vp-c-divider); }
  .ddm-flow li + li::before { left: 22px; top: -6px; transform: rotate(135deg); }
}

.ddm-legend { margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--vp-c-text-2); }
.ddm-tablebox { overflow-x: auto; border: 1px solid var(--vp-c-divider); border-radius: 8px; }
.ddm table { border-collapse: collapse; width: 100%; min-width: 720px; margin: 0; display: table; }
.ddm th, .ddm td { padding: 8px 10px; text-align: left; border: 0; border-bottom: 1px solid var(--vp-c-divider); vertical-align: middle; }
.ddm th { font-size: 12px; font-weight: 600; color: var(--vp-c-text-2); background: var(--vp-c-bg-soft); white-space: nowrap; }
.ddm .c { text-align: center; }
.ddm tbody tr { cursor: pointer; background: var(--vp-c-bg); }
.ddm tbody tr:hover { background: var(--vp-c-bg-soft); }
.ddm tbody tr.sel { background: var(--vp-c-brand-soft); }
.ddm tbody tr:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px; }
.ddm tr.ddm-group, .ddm tr.ddm-group:hover { cursor: default; background: var(--vp-c-bg-alt); }
.ddm tr.ddm-group td { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vp-c-text-2); padding-top: 12px; }
.ddm-name { font-weight: 600; }
.ddm-where { font-family: var(--vp-font-family-mono); font-size: 11.5px; color: var(--vp-c-text-2); }
.ddm-core { font-family: var(--vp-font-family-mono); font-size: 10.5px; padding: 0 5px; margin-left: 6px; border: 1px solid var(--vp-c-brand-1); color: var(--vp-c-brand-1); border-radius: 4px; }
.ddm-count { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; color: var(--vp-c-bg); font-family: var(--vp-font-family-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
.ddm-count-grey { background: var(--vp-c-text-2); }
.ddm-none { color: var(--vp-c-divider); }

.ddm-selbar { position: sticky; top: calc(var(--vp-nav-height, 64px) + 8px); z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid var(--vp-c-divider); border-radius: 8px; background: var(--vp-c-bg); box-shadow: var(--vp-shadow-2); }
.ddm-selbar > span { flex: 1 1 280px; min-width: 0; }
@media (max-width: 960px) { .ddm-selbar { position: static; } }
.ddm-clear { border: 1px solid var(--vp-c-divider); border-radius: 6px; padding: 3px 10px; font-size: 13px; background: var(--vp-c-bg-soft); color: var(--vp-c-text-1); cursor: pointer; }
.ddm-clear:hover { border-color: var(--vp-c-brand-1); }

.ddm-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
.ddm-card { border: 1px solid var(--vp-c-divider); border-radius: 8px; overflow: hidden; background: var(--vp-c-bg); display: flex; flex-direction: column; min-width: 0; }
.ddm-card header { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px 10px; border-top: 4px solid var(--ddm-c); }
.ddm-card-title { font-size: 15px; }
.ddm-q { color: var(--vp-c-text-2); font-size: 13px; }
.ddm-meta { font-family: var(--vp-font-family-mono); font-size: 11.5px; color: var(--vp-c-text-2); }
.ddm-drv { display: flex; flex-direction: column; gap: 5px; padding: 10px 14px 11px; border-top: 1px solid var(--vp-c-divider); transition: opacity 0.15s; }
.ddm-drv.award, .ddm-drv.rollup { background: var(--vp-c-bg-soft); }
.ddm-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ddm-dname { font-weight: 600; }
.ddm .ddm-key { font-size: 11px; color: var(--vp-c-text-2); background: none; padding: 0; overflow-wrap: anywhere; text-align: right; }
.ddm-tag { font-size: 11.5px; color: var(--vp-c-text-2); font-style: italic; }
.ddm-how { font-size: 13px; color: var(--vp-c-text-2); }
.ddm-note { font-size: 12.5px; background: var(--vp-c-bg-alt); border-radius: 6px; padding: 4px 8px; }
.ddm-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ddm-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--vp-c-divider); border-radius: 999px; padding: 1px 9px 1px 7px; font-size: 12px; background: var(--vp-c-bg-soft); color: var(--vp-c-text-1); cursor: pointer; }
.ddm-chip:hover { border-color: var(--vp-c-brand-1); }
.ddm-chip.on { border-color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.ddm-chip:focus-visible, .ddm-clear:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; }
.ddm-cards.filtering .ddm-drv:not(.hit) { opacity: 0.3; }
.ddm-cards.filtering .ddm-drv.hit { box-shadow: inset 3px 0 0 var(--vp-c-brand-1); }
@media (prefers-reduced-motion: reduce) { .ddm-drv { transition: none; } }
</style>
