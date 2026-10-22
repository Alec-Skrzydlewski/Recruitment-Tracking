export const PHOTO_MAX_EDGE = 800;
export const PHOTO_MAX_BYTES = 300 * 1024;
export const QUALITY_LADDER = [0.85, 0.75, 0.65, 0.55, 0.4];

export function fitDimensions(width, height, maxEdge = PHOTO_MAX_EDGE) {
  const w = Number(width);
  const h = Number(height);
  const edge = Number(maxEdge);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  if (!Number.isFinite(edge) || edge <= 0) return { width: w, height: h };
  const longest = Math.max(w, h);
  if (longest <= edge) return { width: w, height: h };
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// Each size tries quality from 0.85 down to 0.4. Then the long-edge cap shrinks.
export function compressionPlan(maxEdge = PHOTO_MAX_EDGE) {
  const plan = [];
  let edge = maxEdge;
  while (edge >= 200) {
    for (let i = 0; i < QUALITY_LADDER.length; i++) {
      plan.push({ maxEdge: edge, quality: QUALITY_LADDER[i] });
    }
    if (edge === 200) break;
    const next = Math.max(200, Math.round(edge * 0.75));
    if (next === edge) break;
    edge = next;
  }
  return plan;
}
