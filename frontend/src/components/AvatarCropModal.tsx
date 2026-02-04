'use client';

import { useState, useCallback } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { X, Loader2 } from 'lucide-react';

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (err) => reject(err));
    image.src = url;
  });
}

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  mimeType: string = 'image/jpeg',
  quality: number = 0.92
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context');

  const maxSize = Math.min(512, pixelCrop.width, pixelCrop.height);
  canvas.width = maxSize;
  canvas.height = maxSize;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    maxSize,
    maxSize
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      mimeType,
      quality
    );
  });
}

interface AvatarCropModalProps {
  imageSrc: string;
  onSave: (blob: Blob) => Promise<void>;
  onCancel: () => void;
}

export function AvatarCropModal({ imageSrc, onSave, onCancel }: AvatarCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) {
      setCropError('Please adjust the crop area.');
      return;
    }
    setSaving(true);
    setCropError(null);
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      await onSave(blob);
      onCancel();
    } catch (err) {
      console.error('Crop/save error:', err);
      setCropError(err instanceof Error ? err.message : 'Failed to save image');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-crop-title"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-elevated w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="avatar-crop-title" className="text-lg font-serif text-text-primary">
            Adjust your photo
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-lg text-text-secondary hover:bg-background hover:text-text-primary transition-colors"
            aria-label="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative w-full aspect-square bg-background min-h-[280px]">
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
            style={{ containerStyle: { backgroundColor: 'var(--color-background)' } }}
          />
        </div>

        <div className="px-4 py-3 border-t border-border flex flex-col gap-3">
          <label className="text-sm font-serif text-text-secondary flex items-center gap-2">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none bg-border accent-accent"
            />
          </label>
          {cropError && (
            <p className="text-sm text-red-500" role="alert">
              {cropError}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-background font-serif text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 font-serif text-sm disabled:opacity-60 flex items-center gap-2 transition-colors"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save photo'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
