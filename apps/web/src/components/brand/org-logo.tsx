import type { Branding } from '@/lib/branding';
import { ProductMark } from './product-mark-component';

/** The organisation's logo (theme-aware pair) or, until one is uploaded, the product mark. */
export function OrgLogo({
  branding,
  width,
  height,
  className = '',
}: {
  branding: Branding | null;
  width: number;
  height: number;
  className?: string;
}) {
  if (!branding?.hasOwnLogo) {
    return <ProductMark size={Math.min(width, height)} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={branding.logoLightUrl} alt={branding.shortNameEn} width={width} height={height}
        className={`block object-contain dark:hidden ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={branding.logoDarkUrl} alt={branding.shortNameEn} width={width} height={height}
        className={`hidden object-contain dark:block ${className}`} />
    </>
  );
}
