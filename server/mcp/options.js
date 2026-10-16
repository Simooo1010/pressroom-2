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

export function normalizeOptions(o = {}) {
  const clamp = (v, r) => Math.min(r.max, Math.max(r.min, Number(v ?? r.default)));
  return {
    format: FORMATS.includes(o.format) ? o.format : 'default',
    font: Object.keys(FONTS).includes(o.font) ? o.font : 'default',
    fontSize: clamp(o.fontSize, RANGES.fontSize),
    lineSpacing: Math.round(clamp(o.lineSpacing, RANGES.lineSpacing) * 10) / 10,
    margin: clamp(o.margin, RANGES.margin),
    excludeEmbeds: !!o.excludeEmbeds,
  };
}
