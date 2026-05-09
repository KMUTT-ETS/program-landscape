'use client';

import * as React from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Camera, Upload, ZoomIn, ZoomOut, X, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';

// Profile-photo upload + crop dialog. Opens when the owner clicks the
// avatar in the profile hero. Uses react-easy-crop for square 1:1
// crop with zoom + pan; output is a 512×512 JPEG uploaded to
// /api/profile/avatar.

interface AvatarUploaderProps {
  /** Current avatar URL — pre-fills the cropper when re-editing. */
  currentAvatarUrl: string | null;
  open: boolean;
  onClose: () => void;
}

const OUTPUT_SIZE = 512;
const JPEG_QUALITY = 0.92;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export function AvatarUploader({ currentAvatarUrl, open, onClose }: AvatarUploaderProps) {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [imageSrc, setImageSrc] = React.useState<string | null>(null);
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedArea, setCroppedArea] = React.useState<Area | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset state every time the dialog opens.
  React.useEffect(() => {
    if (open) {
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedArea(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // All hooks must run on every render — Rules of Hooks. Early-return
  // for the closed state goes BELOW the hook calls.
  const onCropComplete = React.useCallback((_a: Area, pixels: Area) => {
    setCroppedArea(pixels);
  }, []);

  if (!open) return null;

  const onFile = (file: File) => {
    if (file.size > MAX_INPUT_BYTES) {
      setError(`Image is too large (limit ${MAX_INPUT_BYTES / 1024 / 1024} MB).`);
      return;
    }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      setError('Unsupported image format. Use JPEG, PNG, or WebP.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result as string);
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!imageSrc || !croppedArea) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await renderCroppedJpeg(imageSrc, croppedArea);
      const form = new FormData();
      form.append('image', blob, 'avatar.jpg');
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
      }
      // Refresh server-rendered data so the new avatarUrl flows through.
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-uploader-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border-default bg-surface-1 shadow-2xl">
        <header className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 id="avatar-uploader-title" className="text-base font-semibold text-text-primary">
            Update profile photo
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="p-5">
          {!imageSrc && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) onFile(file);
              }}
              className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-default bg-surface-2/50 transition-colors hover:border-accent-default/60 hover:bg-accent-subtle/40"
            >
              <Camera className="h-10 w-10 text-text-tertiary" aria-hidden />
              <p className="text-sm font-medium text-text-primary">
                Click or drop an image to upload
              </p>
              <p className="text-xs text-text-tertiary">
                JPEG · PNG · WebP · up to 8&nbsp;MB
              </p>
              {currentAvatarUrl && (
                <p className="text-[11px] text-text-tertiary">
                  This will replace your current photo.
                </p>
              )}
            </div>
          )}

          {imageSrc && (
            <>
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <ZoomOut className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="h-1 w-full appearance-none rounded-full bg-surface-2 accent-accent-default"
                  aria-label="Zoom"
                />
                <ZoomIn className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
              </div>

              <p className="mt-2 text-[11px] text-text-tertiary">
                Drag to reposition · pinch or use the slider to zoom
              </p>
            </>
          )}

          {error && (
            <p className="mt-3 text-xs text-danger-default">{error}</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle bg-surface-2/30 px-5 py-3">
          {imageSrc && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-raised px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Choose another
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !imageSrc || !croppedArea}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-accent-default px-4 py-1.5 text-xs font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-default/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            {busy ? 'Saving…' : 'Save photo'}
          </button>
        </footer>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            // Reset so re-selecting the same file fires onChange again.
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/**
 * Render the cropped region of `imageSrc` to a 512×512 JPEG via a
 * canvas. Returns the result as a Blob ready for FormData upload.
 */
async function renderCroppedJpeg(imageSrc: string, area: Area): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  // Draw the cropped square into the fixed-size output canvas.
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
