// Barrel for the print-first SVG chart primitives. See README.md in this
// directory for the rules every one of these follows.

export { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
export { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
export { INK, PRINT_PALETTE, SEMANTIC, seriesColour } from './palette';
export { linear, niceTicks, pt } from './scale';
export { estimateTextWidthMm, fitLabel } from './fit-label';
export type { LabelFit } from './fit-label';
export type { ChartCommonProps, ChartFrameProps, Provenance } from './types';

export { BarsH } from './bars-h';
export type { BarRow, BarsHProps } from './bars-h';

export { BarsStacked } from './bars-stacked';
export type { BarsStackedProps, StackedCategory, StackedSegment } from './bars-stacked';

export { LineTrend } from './line-trend';
export type { LineTrendProps, TrendPoint } from './line-trend';

export { Radar } from './radar';
export type { RadarAxis, RadarProps } from './radar';

export { Funnel } from './funnel';
export type { FunnelProps, FunnelStage } from './funnel';

export { Waterfall } from './waterfall';
export type { WaterfallBar, WaterfallProps } from './waterfall';

export { DotRange } from './dot-range';
export type { DotRangeProps, DotRangeRow } from './dot-range';

export { Matrix } from './matrix';
export type { MatrixProps, MatrixRow } from './matrix';

export { Timeline } from './timeline';
export type { TimelineEvent, TimelineProps } from './timeline';
