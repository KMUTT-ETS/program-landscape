'use client';

import * as React from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from 'react-simple-maps';
import { Plus, Minus, Locate } from 'lucide-react';

// Thailand province choropleth — pan/zoom interactive map. Province
// counts are passed in; the map tints each province by intensity and
// fires a click handler for drill-in. Geography source is the public
// thailand.json (76 provinces + Bangkok).

// Bundled thailand-provinces GeoJSON, served from /public/maps so we
// don't trip on the strict `connect-src 'self'` CSP. Re-pull from
// https://raw.githubusercontent.com/apisit/thailand.json on
// taxonomy refresh.
const THAILAND_GEO = '/maps/thailand.json';

// The thailand.json source uses English province names in its `name`
// property. The registry stores Thai names. This map covers the 77
// administrative divisions; matching is case-insensitive on trimmed
// English names.
const EN_TO_TH: Record<string, string> = {
  'Amnat Charoen': 'อำนาจเจริญ',
  'Ang Thong': 'อ่างทอง',
  'Bangkok Metropolis': 'กรุงเทพมหานคร',
  Bangkok: 'กรุงเทพมหานคร',
  'Bueng Kan': 'บึงกาฬ',
  Buriram: 'บุรีรัมย์',
  'Buri Ram': 'บุรีรัมย์',
  Chachoengsao: 'ฉะเชิงเทรา',
  'Chai Nat': 'ชัยนาท',
  Chaiyaphum: 'ชัยภูมิ',
  Chanthaburi: 'จันทบุรี',
  'Chiang Mai': 'เชียงใหม่',
  'Chiang Rai': 'เชียงราย',
  Chonburi: 'ชลบุรี',
  'Chon Buri': 'ชลบุรี',
  Chumphon: 'ชุมพร',
  Kalasin: 'กาฬสินธุ์',
  'Kamphaeng Phet': 'กำแพงเพชร',
  Kanchanaburi: 'กาญจนบุรี',
  'Khon Kaen': 'ขอนแก่น',
  Krabi: 'กระบี่',
  Lampang: 'ลำปาง',
  Lamphun: 'ลำพูน',
  Loei: 'เลย',
  Lopburi: 'ลพบุรี',
  'Lop Buri': 'ลพบุรี',
  'Mae Hong Son': 'แม่ฮ่องสอน',
  'Maha Sarakham': 'มหาสารคาม',
  Mukdahan: 'มุกดาหาร',
  'Nakhon Nayok': 'นครนายก',
  'Nakhon Pathom': 'นครปฐม',
  'Nakhon Phanom': 'นครพนม',
  'Nakhon Ratchasima': 'นครราชสีมา',
  'Nakhon Sawan': 'นครสวรรค์',
  'Nakhon Si Thammarat': 'นครศรีธรรมราช',
  Nan: 'น่าน',
  Narathiwat: 'นราธิวาส',
  'Nong Bua Lamphu': 'หนองบัวลำภู',
  'Nong Khai': 'หนองคาย',
  Nonthaburi: 'นนทบุรี',
  Pathani: 'ปัตตานี',
  Pattani: 'ปัตตานี',
  'Pathum Thani': 'ปทุมธานี',
  'Phangnga': 'พังงา',
  'Phang Nga': 'พังงา',
  Phatthalung: 'พัทลุง',
  Phayao: 'พะเยา',
  Phetchabun: 'เพชรบูรณ์',
  Phetchaburi: 'เพชรบุรี',
  Phichit: 'พิจิตร',
  Phitsanulok: 'พิษณุโลก',
  Phrae: 'แพร่',
  'Phra Nakhon Si Ayutthaya': 'พระนครศรีอยุธยา',
  Ayutthaya: 'พระนครศรีอยุธยา',
  Phuket: 'ภูเก็ต',
  Prachinburi: 'ปราจีนบุรี',
  'Prachin Buri': 'ปราจีนบุรี',
  'Prachuap Khiri Khan': 'ประจวบคีรีขันธ์',
  Ranong: 'ระนอง',
  Ratchaburi: 'ราชบุรี',
  Rayong: 'ระยอง',
  'Roi Et': 'ร้อยเอ็ด',
  'Sa Kaeo': 'สระแก้ว',
  'Sakon Nakhon': 'สกลนคร',
  'Samut Prakan': 'สมุทรปราการ',
  'Samut Sakhon': 'สมุทรสาคร',
  'Samut Songkhram': 'สมุทรสงคราม',
  Saraburi: 'สระบุรี',
  Satun: 'สตูล',
  'Sing Buri': 'สิงห์บุรี',
  Sisaket: 'ศรีสะเกษ',
  'Si Sa Ket': 'ศรีสะเกษ',
  Songkhla: 'สงขลา',
  Sukhothai: 'สุโขทัย',
  'Suphan Buri': 'สุพรรณบุรี',
  'Surat Thani': 'สุราษฎร์ธานี',
  Surin: 'สุรินทร์',
  Tak: 'ตาก',
  Trang: 'ตรัง',
  Trat: 'ตราด',
  'Ubon Ratchathani': 'อุบลราชธานี',
  'Udon Thani': 'อุดรธานี',
  'Uthai Thani': 'อุทัยธานี',
  Uttaradit: 'อุตรดิตถ์',
  Yala: 'ยะลา',
  Yasothon: 'ยโสธร',
};

interface ProvinceRow {
  /** Thai province name as stored in the registry. */
  name: string;
  count: number;
}

interface Props {
  rows: ProvinceRow[];
  onProvinceClick?: (provinceTh: string) => void;
}

export function ThailandProvinceMap({ rows, onProvinceClick }: Props) {
  const [position, setPosition] = React.useState<{
    coordinates: [number, number];
    zoom: number;
  }>({ coordinates: [101, 13], zoom: 1 });
  const [hovered, setHovered] = React.useState<{
    name: string;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  // Map Thai province name → count, normalized.
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.name.trim(), r.count);
    return m;
  }, [rows]);
  const max = React.useMemo(
    () => Math.max(...Array.from(counts.values()), 1),
    [counts],
  );

  const tint = (count: number): string => {
    if (count === 0) return 'oklch(var(--color-surface-3))';
    const intensity = 0.18 + (count / max) * 0.7;
    return `oklch(var(--color-chart-8) / ${intensity})`;
  };

  const onMove = (p: typeof position) => setPosition(p);

  const reset = () => setPosition({ coordinates: [101, 13], zoom: 1 });

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-border-subtle bg-surface-1">
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <button
          onClick={() => setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * 1.4, 8) }))}
          className="rounded border border-border-subtle bg-surface-0 p-1 text-text-secondary hover:bg-surface-2"
          aria-label="Zoom in"
        >
          <Plus className="size-icon-sm" />
        </button>
        <button
          onClick={() => setPosition((p) => ({ ...p, zoom: Math.max(p.zoom / 1.4, 1) }))}
          className="rounded border border-border-subtle bg-surface-0 p-1 text-text-secondary hover:bg-surface-2"
          aria-label="Zoom out"
        >
          <Minus className="size-icon-sm" />
        </button>
        <button
          onClick={reset}
          className="rounded border border-border-subtle bg-surface-0 p-1 text-text-secondary hover:bg-surface-2"
          aria-label="Reset view"
        >
          <Locate className="size-icon-sm" />
        </button>
      </div>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 1900, center: [101, 13] }}
        style={{ width: '100%', height: '500px' }}
      >
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={onMove}
          minZoom={1}
          maxZoom={8}
        >
          <Geographies geography={THAILAND_GEO}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const enName: string =
                  geo.properties.name ?? geo.properties.NAME_1 ?? '';
                const thName = EN_TO_TH[enName.trim()] ?? enName.trim();
                const count = counts.get(thName) ?? 0;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    strokeWidth={0.4}
                    onMouseEnter={(e) => {
                      setHovered({
                        name: thName,
                        count,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => onProvinceClick?.(thName)}
                    // Paint via `style` rather than the `fill`/`stroke`
                    // presentation attributes: CSS var() is only honoured
                    // in a CSS property, and the tokens are what make the
                    // choropleth follow the light/dark theme.
                    style={{
                      default: {
                        fill: tint(count),
                        stroke: 'oklch(var(--color-border-default))',
                        outline: 'none',
                      },
                      hover: {
                        fill: 'oklch(var(--color-brand-cardinal) / 0.55)',
                        stroke: 'oklch(var(--color-border-default))',
                        outline: 'none',
                        cursor: count > 0 ? 'pointer' : 'default',
                      },
                      pressed: {
                        fill: tint(count),
                        stroke: 'oklch(var(--color-border-default))',
                        outline: 'none',
                      },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-border-subtle bg-surface-0 px-2 py-1 text-xs shadow-lg"
          style={{
            left: hovered.x + 12,
            top: hovered.y + 12,
          }}
        >
          <div className="font-semibold">{hovered.name}</div>
          <div className="font-tabular text-text-secondary">
            {hovered.count.toLocaleString('en-US')} student
            {hovered.count === 1 ? '' : 's'}
          </div>
        </div>
      )}
      <div className="border-t border-border-subtle px-3 py-1.5 text-[0.7rem] text-text-tertiary">
        Drag to pan, scroll to zoom. Click a province to filter the
        breakdowns below. Province names matched by Thai script — provinces
        the registry doesn&apos;t name (foreign schools) are not coloured.
      </div>
    </div>
  );
}
