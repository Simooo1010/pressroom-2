// ─── Option schema (mirrors the Pressroom UI controls) ───────────
export const FORMATS = ['default', 'newspaper', 'scientific', 'book', 'monospace', 'magazine'];
export const FONTS = {
  default: 'Format Default',
  sans: 'Modern Sans (Inter)',
  serif: 'Classic Serif (Lora)',
  times: 'Times New Roman',
  mono: 'Typewriter',
};
export const RANGES = {
  fontSize: { min: 8, max: 36, step: 1, default: 12, unit: 'pt' },
  lineSpacing: { min: 1.0, max: 3.0, step: 0.1, default: 1.6 },
  margin: { min: 0, max: 80, step: 1, default: 25, unit: 'mm' },
};

export function normalizeOptions(o) {
  o = o || {};
  // Snap to the UI sliders' step (a range input silently rounds e.g. 11.5 → 12), so the
  // reported options are exactly what was rendered. Non-numeric values fall back to defaults.
  const clamp = (v, r) => {
    const n = v === undefined || v === null || v === '' ? r.default : Number(v);
    const c = Math.min(r.max, Math.max(r.min, Number.isFinite(n) ? n : r.default));
    return Math.round(Math.round((c - r.min) / r.step) * r.step * 10 + r.min * 10) / 10;
  };
  return {
    format: FORMATS.includes(o.format) ? o.format : 'default',
    font: Object.keys(FONTS).includes(o.font) ? o.font : 'default',
    fontSize: clamp(o.fontSize, RANGES.fontSize),
    lineSpacing: clamp(o.lineSpacing, RANGES.lineSpacing),
    margin: clamp(o.margin, RANGES.margin),
    excludeEmbeds: !!o.excludeEmbeds,
  };
}
