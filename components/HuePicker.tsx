'use client';

import { useEffect, useRef, useState } from 'react';
import { HUE_GRADIENT, hexColor, hueColor } from '@/lib/hue';

/** A swatch of the worm's colour; click it for a strip of hues to drag along. */
export default function HuePicker({ hue, onChange, label }: { hue: number; onChange: (h: number) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const pick = (x: number) => {
    const r = strip.current!.getBoundingClientRect();
    onChange(Math.round(359 * Math.min(1, Math.max(0, (x - r.left) / r.width))));
  };
  const color = hexColor(hueColor(hue));
  return (
    <div ref={box} style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--ui-border)', background: color, cursor: 'pointer', padding: 0, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.15)' }}
      />
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 46, zIndex: 20, padding: 10, borderRadius: 10, background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', boxShadow: 'var(--ui-shadow)' }}>
          <div
            ref={strip}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pick(e.clientX);
            }}
            onPointerMove={(e) => e.buttons & 1 && pick(e.clientX)}
            style={{ position: 'relative', width: 240, height: 28, borderRadius: 6, background: HUE_GRADIENT, cursor: 'crosshair', touchAction: 'none' }}
          >
            <span
              style={{
                position: 'absolute',
                left: `${(hue / 359) * 100}%`,
                top: -3,
                bottom: -3,
                width: 8,
                marginLeft: -4,
                borderRadius: 4,
                border: '2px solid #fff',
                background: color,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
