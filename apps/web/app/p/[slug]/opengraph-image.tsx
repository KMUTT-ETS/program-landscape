import { ImageResponse } from 'next/og';
import { prisma } from '@kku/db';
import { getProfileData } from '@/lib/profile-data';

// OG card emitted on link previews (Slack, LINE, X, WhatsApp).
// 1200×630 — the standard OG dimensions. Generated on each request
// (Next caches the response for performance).

export const runtime = 'nodejs';
export const alt = 'KKU academic profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage({ params }: { params: { slug: string } }) {
  const user = await prisma.user.findUnique({
    where: { publicProfileSlug: params.slug },
    select: { id: true, publicProfileEnabled: true },
  });

  if (!user || !user.publicProfileEnabled) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0a0a',
            color: 'white',
            fontSize: 48,
          }}
        >
          KKU Curriculum Landscape
        </div>
      ),
      size,
    );
  }

  const profile = await getProfileData(user.id);
  const fullName = profile?.basic.fullNameEn ?? 'KKU profile';
  const rank = profile?.basic.rankLabelEn ?? '';
  const faculty = profile?.basic.facultyNameEn ?? 'Khon Kaen University';
  const dept = profile?.basic.departmentNameEn ?? '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '80px',
          background:
            'linear-gradient(135deg, #fff7f0 0%, #ffffff 60%, #fff0e6 100%)',
          color: '#1a1a1a',
        }}
      >
        <div
          style={{
            fontSize: 22,
            color: '#a04000',
            textTransform: 'uppercase',
            letterSpacing: 4,
            fontWeight: 600,
          }}
        >
          Khon Kaen University
        </div>
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {rank && (
            <div
              style={{
                fontSize: 28,
                color: '#c0392b',
                marginBottom: 16,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: 2,
              }}
            >
              {rank}
            </div>
          )}
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
              color: '#1a1a1a',
            }}
          >
            {fullName}
          </div>
          <div
            style={{
              fontSize: 32,
              color: '#525252',
              marginTop: 24,
              fontWeight: 500,
            }}
          >
            {faculty}
          </div>
          {dept && (
            <div
              style={{
                fontSize: 26,
                color: '#737373',
                marginTop: 8,
              }}
            >
              {dept}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
