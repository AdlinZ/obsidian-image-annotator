export interface Point { x: number; y: number }
export type DrawTool = "rect" | "line" | "arrow" | "pen" | "text" | "number" | "redact" | "highlight";
export type Tool = "select" | DrawTool;
export interface Item {
  type: DrawTool;
  color: string;
  width: number;
  size: number;
  points: Point[];
  text?: string;
  number?: number;
}
export interface Preferences { color: string; width: number; size: number }
export const defaults: Preferences = { color: "#e11d48", width: 4, size: 32 };
export const clone = (items: Item[]): Item[] => items.map(item => ({ ...item, points: item.points.map(p => ({ ...p })) }));
export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

export function preferences(value: unknown): Preferences {
  const p = value as Partial<Preferences> | null;
  return {
    color: typeof p?.color === "string" && /^#[\da-f]{6}$/i.test(p.color) ? p.color : defaults.color,
    width: typeof p?.width === "number" && Number.isFinite(p.width) ? clamp(p.width, 1, 30) : defaults.width,
    size: typeof p?.size === "number" && Number.isFinite(p.size) ? clamp(p.size, 10, 160) : defaults.size
  };
}

export function validItems(value: unknown): value is Item[] {
  return Array.isArray(value) && value.length <= 10000 && value.every((item: Partial<Item> | null) => {
    if (!item || !["rect", "line", "arrow", "pen", "text", "number", "redact", "highlight"].includes(item.type ?? "")) return false;
    if (typeof item.color !== "string" || !/^#[\da-f]{6}$/i.test(item.color)) return false;
    if (!Number.isFinite(item.width) || item.width! < 1 || item.width! > 30 || !Number.isFinite(item.size) || item.size! < 10 || item.size! > 160) return false;
    if (!Array.isArray(item.points) || !item.points.length || item.points.length > 100000 || !item.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
    if (["rect", "line", "arrow", "redact", "highlight"].includes(item.type!) && item.points.length !== 2) return false;
    if (item.type === "text" && (typeof item.text !== "string" || item.text.length > 10000)) return false;
    return item.type !== "number" || (Number.isInteger(item.number) && item.number! > 0 && item.number! <= 9999);
  });
}

export interface Bounds { x: number; y: number; w: number; h: number }
export function bounds(item: Item, ctx: CanvasRenderingContext2D): Bounds {
  const p = item.points[0];
  if (item.type === "text") {
    ctx.font = `${item.size}px sans-serif`;
    const lines = (item.text ?? "").split("\n");
    return { x: p.x, y: p.y, w: Math.max(1, ...lines.map(line => ctx.measureText(line).width)), h: lines.length * item.size * 1.25 };
  }
  if (item.type === "number") {
    const r = numberRadius(item);
    return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
  }
  const xs = item.points.map(point => point.x), ys = item.points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function numberRadius(item: Item): number { return item.size * Math.max(0.7, String(item.number ?? 1).length * 0.34 + 0.2); }
function distance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function hitTest(item: Item, p: Point, ctx: CanvasRenderingContext2D, tolerance: number): boolean {
  if (["line", "arrow", "pen"].includes(item.type)) {
    for (let i = 1; i < item.points.length; i++) if (distance(p, item.points[i - 1], item.points[i]) <= tolerance + item.width / 2) return true;
    return false;
  }
  const b = bounds(item, ctx);
  if (item.type === "rect") {
    return p.x >= b.x - tolerance && p.x <= b.x + b.w + tolerance && p.y >= b.y - tolerance && p.y <= b.y + b.h + tolerance &&
      Math.min(Math.abs(p.x - b.x), Math.abs(p.x - b.x - b.w), Math.abs(p.y - b.y), Math.abs(p.y - b.y - b.h)) <= tolerance + item.width / 2;
  }
  return p.x >= b.x - tolerance && p.x <= b.x + b.w + tolerance && p.y >= b.y - tolerance && p.y <= b.y + b.h + tolerance;
}

export function moveItem(item: Item, dx: number, dy: number): Item {
  return { ...item, points: item.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
}

export function drawItem(ctx: CanvasRenderingContext2D, item: Item): void {
  const p = item.points[0], end = item.points[item.points.length - 1];
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (["rect", "redact", "highlight"].includes(item.type)) {
    const b = bounds(item, ctx);
    if (item.type === "rect") ctx.strokeRect(b.x, b.y, b.w, b.h);
    else {
      ctx.globalAlpha = item.type === "highlight" ? 0.3 : 1;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
  } else if (item.type === "text") {
    ctx.font = `${item.size}px sans-serif`;
    ctx.textBaseline = "top";
    (item.text ?? "").split("\n").forEach((line, i) => ctx.fillText(line, p.x, p.y + i * item.size * 1.25));
  } else if (item.type === "number") {
    ctx.beginPath();
    ctx.arc(p.x, p.y, numberRadius(item), 0, Math.PI * 2);
    ctx.fill();
    const rgb = item.color.slice(1).match(/../g)!.map(v => parseInt(v, 16));
    ctx.fillStyle = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 160 ? "#111111" : "#ffffff";
    ctx.font = `bold ${item.size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(item.number), p.x, p.y);
  } else {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    item.points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
    ctx.stroke();
    if (item.type === "arrow") {
      const angle = Math.atan2(end.y - p.y, end.x - p.x), head = Math.max(12, item.width * 4);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
