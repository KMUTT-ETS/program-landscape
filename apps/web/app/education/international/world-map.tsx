'use client';

import * as React from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from 'react-simple-maps';
import { Plus, Minus, Locate } from 'lucide-react';

// World choropleth — pan/zoom interactive map. Country counts are
// passed in (from the international cube's NATIONNAME column). The
// match is best-effort: Thai names get normalised to English via the
// table below; English names match the world-atlas dataset directly.

// Bundled world-atlas countries TopoJSON, served from /public/maps so
// we don't trip on the strict `connect-src 'self'` CSP. Re-pull from
// https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json on
// taxonomy refresh.
const WORLD_GEO = '/maps/world-110m.json';

// Thai-name → world-atlas English name. Covers the most common
// nationalities the KKU registry sees. Anything not in this table
// falls through to a case-insensitive match on the raw value.
const TH_TO_EN: Record<string, string> = {
  ไทย: 'Thailand',
  ลาว: 'Laos',
  กัมพูชา: 'Cambodia',
  เมียนมา: 'Myanmar',
  พม่า: 'Myanmar',
  เวียดนาม: 'Vietnam',
  มาเลเซีย: 'Malaysia',
  อินโดนีเซีย: 'Indonesia',
  ฟิลิปปินส์: 'Philippines',
  สิงคโปร์: 'Singapore',
  จีน: 'China',
  ฮ่องกง: 'Hong Kong',
  ไต้หวัน: 'Taiwan',
  เกาหลีใต้: 'South Korea',
  เกาหลี: 'South Korea',
  ญี่ปุ่น: 'Japan',
  อินเดีย: 'India',
  เนปาล: 'Nepal',
  ปากีสถาน: 'Pakistan',
  บังกลาเทศ: 'Bangladesh',
  ศรีลังกา: 'Sri Lanka',
  ภูฏาน: 'Bhutan',
  ออสเตรเลีย: 'Australia',
  นิวซีแลนด์: 'New Zealand',
  สหรัฐอเมริกา: 'United States of America',
  อเมริกา: 'United States of America',
  แคนาดา: 'Canada',
  เม็กซิโก: 'Mexico',
  สหราชอาณาจักร: 'United Kingdom',
  อังกฤษ: 'United Kingdom',
  ฝรั่งเศส: 'France',
  เยอรมนี: 'Germany',
  อิตาลี: 'Italy',
  สเปน: 'Spain',
  เนเธอร์แลนด์: 'Netherlands',
  สวีเดน: 'Sweden',
  นอร์เวย์: 'Norway',
  ฟินแลนด์: 'Finland',
  เดนมาร์ก: 'Denmark',
  เบลเยียม: 'Belgium',
  ออสเตรีย: 'Austria',
  สวิตเซอร์แลนด์: 'Switzerland',
  รัสเซีย: 'Russia',
  ตุรกี: 'Turkey',
  อียิปต์: 'Egypt',
  ซาอุดีอาระเบีย: 'Saudi Arabia',
  สหรัฐอาหรับเอมิเรตส์: 'United Arab Emirates',
  อิหร่าน: 'Iran',
  อิรัก: 'Iraq',
  อิสราเอล: 'Israel',
  เลบานอน: 'Lebanon',
  ซีเรีย: 'Syria',
  ปาเลสไตน์: 'Palestine',
  จอร์แดน: 'Jordan',
  เคนยา: 'Kenya',
  เอธิโอเปีย: 'Ethiopia',
  ไนจีเรีย: 'Nigeria',
  แอฟริกาใต้: 'South Africa',
  บราซิล: 'Brazil',
  อาร์เจนตินา: 'Argentina',
  ชิลี: 'Chile',
  เปรู: 'Peru',
  โคลอมเบีย: 'Colombia',
};

interface CountryRow {
  country: string;
  count: number;
}

interface Props {
  byCountry: CountryRow[];
  onCountryClick?: (countryName: string) => void;
}

export function WorldCountryMap({ byCountry, onCountryClick }: Props) {
  const [position, setPosition] = React.useState<{
    coordinates: [number, number];
    zoom: number;
  }>({ coordinates: [20, 20], zoom: 1 });
  const [hovered, setHovered] = React.useState<{
    name: string;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  // Build a normalised count map (English short name → count).
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of byCountry) {
      const en = TH_TO_EN[r.country.trim()] ?? r.country.trim();
      m.set(en.toLowerCase(), (m.get(en.toLowerCase()) ?? 0) + r.count);
    }
    return m;
  }, [byCountry]);
  const max = React.useMemo(
    () => Math.max(...Array.from(counts.values()), 1),
    [counts],
  );

  const tint = (count: number): string => {
    if (count === 0) return 'rgba(229, 224, 207, 0.5)';
    const intensity = 0.2 + (count / max) * 0.75;
    return `rgba(102, 51, 153, ${intensity})`;
  };

  const reset = () => setPosition({ coordinates: [20, 20], zoom: 1 });

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-border-subtle bg-surface-1">
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <button
          onClick={() => setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * 1.4, 12) }))}
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
        projectionConfig={{ scale: 130 }}
        style={{ width: '100%', height: '420px' }}
      >
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={(p) => setPosition(p)}
          minZoom={1}
          maxZoom={12}
        >
          <Geographies geography={WORLD_GEO}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const en: string = (geo.properties.name ?? '') as string;
                const count = counts.get(en.toLowerCase()) ?? 0;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={tint(count)}
                    stroke="#888"
                    strokeWidth={0.3}
                    onMouseEnter={(e) => {
                      setHovered({
                        name: en,
                        count,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => count > 0 && onCountryClick?.(en)}
                    style={{
                      default: { outline: 'none' },
                      hover: {
                        fill: 'rgba(166, 25, 46, 0.55)',
                        outline: 'none',
                        cursor: count > 0 ? 'pointer' : 'default',
                      },
                      pressed: { outline: 'none' },
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
          style={{ left: hovered.x + 12, top: hovered.y + 12 }}
        >
          <div className="font-semibold">{hovered.name}</div>
          <div className="font-tabular text-text-secondary">
            {hovered.count.toLocaleString('en-US')} student
            {hovered.count === 1 ? '' : 's'}
          </div>
        </div>
      )}
      <div className="border-t border-border-subtle px-3 py-1.5 text-[0.7rem] text-text-tertiary">
        Drag to pan, scroll to zoom. Country matching is best-effort —
        Thai → English transliteration covers ~50 common nationalities;
        unmatched countries fall through to the table below.
      </div>
    </div>
  );
}
