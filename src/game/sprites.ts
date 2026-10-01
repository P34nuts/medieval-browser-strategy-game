/**
 * Prozedurale isometrische Gebäude-Sprites.
 * Keine externen Bilddateien: jedes Gebäude wird einmal auf ein Offscreen-Canvas gezeichnet
 * und danach nur noch per drawImage verwendet (schnell + speicherschonend).
 *
 * Koordinatensystem im Sprite: lokale Kachelkoordinaten (x,y) in Kacheleinheiten und z in Pixeln.
 * Screen = (ox + (x-y)*32, oy + (x+y)*16 - z). Der Ursprung (ox,oy) ist die obere (N) Ecke der Grundfläche.
 */
import { BUILDINGS, type BuildingId } from "./data";

export const HW = 32; // halbe Kachelbreite
export const HH = 16; // halbe Kachelhöhe
const TALL = 120; // maximale Bauhöhe über der Grundfläche

export interface Sprite { canvas: HTMLCanvasElement; ox: number; oy: number }
type Pt = [number, number, number];

/** Farbe mit Weiß (k>0) oder Schwarz (k<0) mischen */
export function tone(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const t = k < 0 ? 0 : 255;
  const a = Math.abs(k);
  const ch = (v: number) => Math.round(v + (t - v) * a);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

class D {
  constructor(public c: CanvasRenderingContext2D, public ox: number, public oy: number) {}
  P(x: number, y: number, z = 0): [number, number] {
    return [this.ox + (x - y) * HW, this.oy + (x + y) * HH - z];
  }
  poly(pts: Pt[], fill: string, stroke = "rgba(0,0,0,0.28)") {
    const c = this.c;
    c.beginPath();
    pts.forEach((p, i) => {
      const [sx, sy] = this.P(p[0], p[1], p[2]);
      if (i) c.lineTo(sx, sy); else c.moveTo(sx, sy);
    });
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }
  line(a: Pt, b: Pt, col: string, w = 2) {
    const c = this.c;
    const [ax, ay] = this.P(...a), [bx, by] = this.P(...b);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by);
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = "round"; c.stroke();
  }
  /** Quader mit drei sichtbaren Flächen */
  box(x0: number, y0: number, w: number, d: number, z0: number, h: number, col: string) {
    const z1 = z0 + h;
    this.poly([[x0, y0 + d, z0], [x0 + w, y0 + d, z0], [x0 + w, y0 + d, z1], [x0, y0 + d, z1]], tone(col, -0.06)); // links
    this.poly([[x0 + w, y0 + d, z0], [x0 + w, y0, z0], [x0 + w, y0, z1], [x0 + w, y0 + d, z1]], tone(col, -0.3)); // rechts
    this.poly([[x0, y0, z1], [x0 + w, y0, z1], [x0 + w, y0 + d, z1], [x0, y0 + d, z1]], tone(col, 0.2)); // oben
  }
  /** Rechteck auf der linken Wandfläche (Ebene y) */
  wallL(xa: number, xb: number, za: number, zb: number, y: number, col: string) {
    this.poly([[xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb]], col, "rgba(0,0,0,0.35)");
  }
  /** Rechteck auf der rechten Wandfläche (Ebene x) */
  wallR(ya: number, yb: number, za: number, zb: number, x: number, col: string) {
    this.poly([[x, ya, za], [x, yb, za], [x, yb, zb], [x, ya, zb]], col, "rgba(0,0,0,0.35)");
  }
  /** Satteldach, First entlang x (Dachfläche zeigt nach +y) */
  gableX(x0: number, y0: number, w: number, d: number, z: number, rh: number, roof: string, wall: string, ov = 0.07) {
    const ym = y0 + d / 2;
    this.poly([[x0 + w, y0, z], [x0 + w, y0 + d, z], [x0 + w, ym, z + rh]], tone(wall, -0.3));
    this.poly([[x0 - ov, y0 + d + ov, z - 2], [x0 + w + ov, y0 + d + ov, z - 2], [x0 + w + ov, ym, z + rh], [x0 - ov, ym, z + rh]], tone(roof, 0.05));
    this.line([x0 - ov, ym, z + rh], [x0 + w + ov, ym, z + rh], tone(roof, -0.4), 2);
  }
  /** Satteldach, First entlang y (Dachfläche zeigt nach +x) */
  gableY(x0: number, y0: number, w: number, d: number, z: number, rh: number, roof: string, wall: string, ov = 0.07) {
    const xm = x0 + w / 2;
    this.poly([[x0, y0 + d, z], [x0 + w, y0 + d, z], [xm, y0 + d, z + rh]], tone(wall, -0.06));
    this.poly([[x0 + w + ov, y0 - ov, z - 2], [x0 + w + ov, y0 + d + ov, z - 2], [xm, y0 + d + ov, z + rh], [xm, y0 - ov, z + rh]], tone(roof, -0.22));
    this.line([xm, y0 - ov, z + rh], [xm, y0 + d + ov, z + rh], tone(roof, -0.45), 2);
  }
  /** Walmdach / Pyramide */
  hip(x0: number, y0: number, w: number, d: number, z: number, rh: number, roof: string, ov = 0.06) {
    const ap: Pt = [x0 + w / 2, y0 + d / 2, z + rh];
    this.poly([[x0 - ov, y0 + d + ov, z], [x0 + w + ov, y0 + d + ov, z], ap], tone(roof, 0.05));
    this.poly([[x0 + w + ov, y0 + d + ov, z], [x0 + w + ov, y0 - ov, z], ap], tone(roof, -0.25));
  }
  /** Bodenplatte */
  ground(x0: number, y0: number, w: number, d: number, col: string) {
    this.poly([[x0, y0, 0], [x0 + w, y0, 0], [x0 + w, y0 + d, 0], [x0, y0 + d, 0]], col, "rgba(0,0,0,0.2)");
  }
}

const DOOR = "#4a2f1a";
const GLASS = "#8ab6d6";

const DRAW: Record<BuildingId, (d: D) => void> = {
  house_s(d) {
    d.box(0.18, 0.18, 0.64, 0.64, 0, 16, "#e3d2a6");
    d.gableX(0.18, 0.18, 0.64, 0.64, 16, 13, "#b5523b", "#e3d2a6");
    d.wallL(0.4, 0.6, 0, 10, 0.82, DOOR);
    d.wallR(0.35, 0.6, 6, 12, 0.82, GLASS);
  },
  house_m(d) {
    d.box(0.2, 0.2, 1.6, 1.6, 0, 28, "#dccb9b");
    for (const u of [0.5, 1.0, 1.5]) d.wallL(u, u + 0.06, 0, 28, 1.8, "#7a5534");
    d.wallL(0.7, 1.0, 0, 14, 1.8, DOOR);
    d.wallL(0.25, 0.45, 15, 23, 1.8, GLASS);
    d.wallL(1.25, 1.45, 15, 23, 1.8, GLASS);
    d.wallR(0.5, 0.8, 8, 18, 1.8, GLASS);
    d.wallR(1.1, 1.4, 8, 18, 1.8, GLASS);
    d.gableY(0.2, 0.2, 1.6, 1.6, 28, 18, "#a04632", "#dccb9b");
    d.box(1.25, 0.4, 0.24, 0.24, 28, 12, "#8a8a8a");
  },
  house_l(d) {
    d.box(0.2, 0.2, 2.6, 2.6, 0, 36, "#d7c49a");
    d.wallL(0.2, 2.8, 17, 19, 2.8, "#7a5534");
    for (let i = 0; i < 4; i++) {
      d.wallL(0.4 + i * 0.6, 0.65 + i * 0.6, 22, 31, 2.8, GLASS);
      if (i !== 1) d.wallL(0.4 + i * 0.6, 0.65 + i * 0.6, 6, 15, 2.8, GLASS);
    }
    d.wallL(1.05, 1.45, 0, 16, 2.8, DOOR);
    for (let i = 0; i < 3; i++) d.wallR(0.5 + i * 0.8, 0.8 + i * 0.8, 10, 22, 2.8, GLASS);
    d.gableX(0.2, 0.2, 2.6, 2.6, 36, 24, "#5d6a7a", "#d7c49a");
    d.box(2.15, 0.6, 0.28, 0.28, 36, 16, "#7a7a7a");
    d.box(0.6, 0.7, 0.28, 0.28, 36, 14, "#7a7a7a");
  },
  lumberjack(d) {
    d.box(0.25, 0.3, 1.3, 1.1, 0, 16, "#8a5a30");
    for (const z of [4, 8, 12]) d.wallL(0.25, 1.55, z, z + 0.8, 1.4, "rgba(0,0,0,0.35)");
    d.wallL(0.6, 0.9, 0, 11, 1.4, DOOR);
    d.gableX(0.25, 0.3, 1.3, 1.1, 16, 12, "#6b4a2a", "#8a5a30");
    d.box(0.3, 1.52, 0.9, 0.3, 0, 5, "#a06c38");
    d.box(0.35, 1.56, 0.75, 0.22, 5, 4, "#b87e44");
    d.box(1.55, 1.3, 0.3, 0.3, 0, 7, "#9a6a3a");
  },
  forester(d) {
    d.box(0.25, 0.3, 1.3, 1.1, 0, 16, "#47734a");
    d.gableX(0.25, 0.3, 1.3, 1.1, 16, 12, "#315735", "#47734a");
    d.wallL(0.6, 0.9, 0, 11, 1.4, "#4a2f1a");
    d.box(1.55, 1.3, 0.3, 0.3, 0, 7, "#6a4a2c");
    d.line([1.7, 1.45, 7], [1.7, 1.45, 22], "#79a64f", 3);
  },
  quarry(d) {
    d.ground(0.08, 0.08, 1.84, 1.84, "#8d8a80");
    d.box(0.3, 0.3, 0.5, 0.5, 0, 8, "#b9b7ae");
    d.box(1.0, 0.25, 0.45, 0.45, 0, 5, "#c7c5bc");
    d.box(0.4, 1.2, 0.4, 0.4, 0, 4, "#b3b1a8");
    d.box(1.3, 1.1, 0.5, 0.5, 0, 10, "#a7a59c");
    d.line([0.25, 1.75, 0], [0.25, 1.75, 50], "#6b4a2a", 4);
    d.line([0.25, 1.75, 50], [1.1, 1.05, 42], "#6b4a2a", 3);
    d.line([1.1, 1.05, 42], [1.1, 1.05, 20], "#3a2a1a", 1);
    d.box(1.05, 1.0, 0.12, 0.12, 12, 9, "#c7c5bc");
  },
  mine(d) {
    d.box(0.2, 0.2, 1.6, 1.6, 0, 22, "#6d6d75");
    d.hip(0.2, 0.2, 1.6, 1.6, 22, 16, "#7d7d86", 0.02);
    d.wallL(0.55, 1.45, 0, 15, 1.8, "#121216");
    d.wallL(0.45, 0.55, 0, 18, 1.8, "#7a5534");
    d.wallL(1.45, 1.55, 0, 18, 1.8, "#7a5534");
    d.wallL(0.45, 1.55, 15, 19, 1.8, "#7a5534");
    d.box(1.5, 1.2, 0.3, 0.3, 0, 6, "#5a4a3a");
    d.box(0.15, 1.45, 0.25, 0.25, 0, 5, "#d7a83a");
  },
  sawmill(d) {
    d.box(0.12, 0.3, 1.76, 1.3, 0, 20, "#b38a52");
    for (let i = 0; i < 7; i++) d.wallL(0.2 + i * 0.25, 0.22 + i * 0.25, 0, 20, 1.6, "rgba(0,0,0,0.22)");
    d.wallL(0.35, 1.0, 0, 14, 1.6, "#3a2a1a");
    d.gableX(0.12, 0.3, 1.76, 1.3, 20, 11, "#7d5a3a", "#b38a52");
    const [sx, sy] = d.P(1.88, 0.95, 12);
    d.c.beginPath(); d.c.arc(sx, sy, 7, 0, 7); d.c.fillStyle = "#c9ced4"; d.c.fill();
    d.c.strokeStyle = "#555"; d.c.lineWidth = 1.5; d.c.stroke();
    d.box(0.3, 1.65, 0.9, 0.25, 0, 5, "#a06c38");
    d.box(0.4, 1.68, 0.7, 0.2, 5, 4, "#b87e44");
  },
  smithy(d) {
    d.box(0.2, 0.2, 1.6, 1.6, 0, 22, "#85858c");
    d.wallL(1.0, 1.4, 0, 12, 1.8, "#ff8a2a");
    d.wallL(0.3, 0.5, 6, 14, 1.8, "#3a3a44");
    d.gableY(0.2, 0.2, 1.6, 1.6, 22, 14, "#3a3a44", "#85858c");
    d.box(0.45, 1.15, 0.3, 0.3, 22, 30, "#5a5a60");
  },
  bakery(d) {
    d.box(0.2, 0.25, 1.6, 1.5, 0, 24, "#ecd9b2");
    d.wallL(0.7, 1.1, 0, 14, 1.75, "#6b3f22");
    d.wallL(1.3, 1.6, 8, 17, 1.75, "#f3c77a");
    d.wallR(0.6, 1.0, 8, 17, 1.8, "#f3c77a");
    d.gableY(0.2, 0.25, 1.6, 1.5, 24, 16, "#d0702e", "#ecd9b2");
    d.box(1.3, 0.5, 0.26, 0.26, 24, 18, "#9a6a4a");
  },
  farm(d) {
    d.box(0.2, 0.3, 2.0, 1.6, 0, 26, "#a8382f");
    d.wallL(0.9, 1.5, 0, 16, 1.9, "#e8e0d0");
    d.line([0.9, 1.9, 0], [1.5, 1.9, 16], "#a8382f", 2);
    d.line([1.5, 1.9, 0], [0.9, 1.9, 16], "#a8382f", 2);
    d.gableX(0.2, 0.3, 2.0, 1.6, 26, 18, "#5e4630", "#a8382f");
    d.box(2.3, 0.4, 0.5, 0.5, 0, 40, "#b9b9b0");
    d.hip(2.3, 0.4, 0.5, 0.5, 40, 12, "#7a7a7a");
    d.box(0.3, 2.3, 0.5, 0.4, 0, 7, "#d8b84a");
    d.box(1.0, 2.35, 0.5, 0.4, 0, 7, "#e0c05a");
  },
  mill(d) {
    d.box(0.4, 0.4, 1.2, 1.2, 0, 6, "#b5ad98");
    d.box(0.55, 0.55, 0.9, 0.9, 6, 26, "#e8e0cc");
    d.wallL(0.85, 1.15, 6, 18, 1.45, DOOR);
    d.hip(0.55, 0.55, 0.9, 0.9, 32, 22, "#7a4a2a");
    const [hx, hy] = d.P(1.45, 1.0, 34);
    d.c.strokeStyle = "#5a3a1e"; d.c.lineWidth = 3; d.c.lineCap = "round";
    for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      d.c.beginPath(); d.c.moveTo(hx, hy); d.c.lineTo(hx + dx * 20, hy + dy * 20); d.c.stroke();
      d.c.fillStyle = "rgba(240,235,220,0.9)";
      d.c.beginPath(); d.c.arc(hx + dx * 15, hy + dy * 15, 3.6, 0, 7); d.c.fill();
    }
    d.c.beginPath(); d.c.arc(hx, hy, 3, 0, 7); d.c.fillStyle = "#3a2a1a"; d.c.fill();
  },
  field(d) {
    d.ground(0.04, 0.04, 1.92, 1.92, "#8b6b3a");
    for (let i = 0; i < 6; i++) {
      const y = 0.22 + i * 0.3;
      d.line([0.12, y, 0], [1.88, y, 0], i % 2 ? "#d8b84a" : "#c9a640", 4);
    }
  },
  road(d) {
    d.ground(0.04, 0.04, 0.92, 0.92, "#a08a64");
  },
  warehouse(d) {
    d.box(0.2, 0.4, 2.6, 2.2, 0, 28, "#b89466");
    for (let i = 0; i < 10; i++) d.wallL(0.3 + i * 0.26, 0.32 + i * 0.26, 0, 28, 2.6, "rgba(0,0,0,0.16)");
    d.wallL(0.5, 1.3, 0, 19, 2.6, "#4a3520");
    d.wallL(1.7, 2.5, 0, 19, 2.6, "#4a3520");
    d.gableX(0.2, 0.4, 2.6, 2.2, 28, 20, "#6b7a8a", "#b89466");
    d.box(0.3, 2.7, 0.4, 0.28, 0, 8, "#a77b48");
    d.box(0.8, 2.72, 0.35, 0.26, 0, 6, "#b98a52");
    d.box(2.4, 2.7, 0.3, 0.3, 0, 10, "#7a5534");
  },
  market(d) {
    d.box(0.12, 0.12, 2.76, 2.76, 0, 3, "#c9b184");
    d.box(0.4, 0.6, 1.3, 0.7, 3, 7, "#8a5a30");
    d.line([0.4, 1.5, 3], [0.4, 1.5, 27], "#6b4a2a", 3);
    d.line([1.7, 1.5, 3], [1.7, 1.5, 27], "#6b4a2a", 3);
    d.gableX(0.3, 0.4, 1.5, 1.2, 27, 9, "#c0392b", "#e8d8b8");
    d.box(1.5, 1.85, 1.2, 0.7, 3, 7, "#8a5a30");
    d.line([1.5, 2.7, 3], [1.5, 2.7, 27], "#6b4a2a", 3);
    d.line([2.8, 2.7, 3], [2.8, 2.7, 27], "#6b4a2a", 3);
    d.gableX(1.4, 1.65, 1.5, 1.2, 27, 9, "#2f6fb0", "#e8d8b8");
    d.box(0.35, 2.3, 0.35, 0.3, 3, 8, "#a77b48");
  },
  barracks(d) {
    d.box(0.2, 0.3, 2.6, 2.4, 0, 30, "#9a9aa2");
    d.wallL(1.2, 1.6, 0, 16, 2.7, "#3a2a1a");
    d.wallL(0.6, 0.9, 6, 26, 2.7, "#b02a2a");
    d.wallL(2.1, 2.4, 6, 26, 2.7, "#b02a2a");
    d.gableX(0.2, 0.3, 2.6, 2.4, 30, 20, "#7a2f2f", "#9a9aa2");
    d.box(2.55, 2.6, 0.3, 0.3, 0, 9, "#7a5534");
  },
  tower(d) {
    d.box(0.22, 0.22, 0.56, 0.56, 0, 46, "#9a9aa2");
    d.wallL(0.44, 0.56, 14, 24, 0.78, "#222");
    d.wallL(0.44, 0.56, 32, 40, 0.78, "#222");
    d.box(0.12, 0.12, 0.76, 0.76, 46, 7, "#8a8a92");
    d.hip(0.12, 0.12, 0.76, 0.76, 53, 20, "#8a3030");
  },
  castle(d) {
    d.box(0.2, 0.2, 3.6, 3.6, 0, 16, "#9d9da5");
    d.wallL(1.6, 2.4, 0, 12, 3.8, "#2a1f14");
    const tower = (x: number, y: number) => {
      d.box(x, y, 0.9, 0.9, 0, 46, "#a8a8b0");
      d.box(x - 0.05, y - 0.05, 1.0, 1.0, 46, 6, "#95959d");
      d.hip(x - 0.05, y - 0.05, 1.0, 1.0, 52, 22, "#8a3030");
    };
    tower(0.2, 0.2);
    d.box(1.2, 1.2, 1.6, 1.6, 0, 56, "#b0b0b8");
    d.wallL(1.3, 1.5, 20, 34, 2.8, "#222");
    d.wallL(2.5, 2.7, 20, 34, 2.8, "#222");
    d.box(1.1, 1.1, 1.8, 1.8, 56, 6, "#a0a0a8");
    d.hip(1.1, 1.1, 1.8, 1.8, 62, 28, "#7a2f2f");
    d.line([2.0, 2.0, 90], [2.0, 2.0, 110], "#4a3520", 2);
    d.poly([[2.0, 2.0, 110], [2.0, 2.0, 102], [2.3, 2.0, 106]], "#c0392b");
    tower(2.9, 0.2);
    tower(0.2, 2.9);
    tower(2.9, 2.9);
  },
};

const cache = new Map<BuildingId, Sprite>();

/** Sprite holen (lazy gezeichnet). Nur im Browser aufrufen. */
export function getSprite(id: BuildingId): Sprite {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = BUILDINGS[id];
  const [w, h] = def.size;
  const canvas = document.createElement("canvas");
  canvas.width = (w + h) * HW + 16;
  canvas.height = (w + h) * HH + TALL + 16;
  const c = canvas.getContext("2d")!;
  const d = new D(c, h * HW + 8, TALL + 8);
  if (!def.flat) {
    // weicher Bodenschatten
    d.poly([[0.1, 0.1, 0], [w + 0.25, 0.1, 0], [w + 0.25, h + 0.25, 0], [0.1, h + 0.25, 0]], "rgba(0,0,0,0.2)", "");
  }
  DRAW[id](d);
  const s = { canvas, ox: d.ox, oy: d.oy };
  cache.set(id, s);
  return s;
}

const thumbs = new Map<BuildingId, string>();
/** Zugeschnittenes Vorschaubild (PNG-DataURL) für Menüs */
export function spriteThumb(id: BuildingId): string {
  const hit = thumbs.get(id);
  if (hit) return hit;
  const s = getSprite(id);
  const { width: W, height: H } = s.canvas;
  const data = s.canvas.getContext("2d")!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const bw = Math.max(1, x1 - x0 + 1), bh = Math.max(1, y1 - y0 + 1);
  const S = 96;
  const k = Math.min((S - 8) / bw, (S - 8) / bh, 1.6);
  const out = document.createElement("canvas");
  out.width = S; out.height = S;
  const oc = out.getContext("2d")!;
  oc.drawImage(s.canvas, x0, y0, bw, bh, (S - bw * k) / 2, (S - bh * k) / 2, bw * k, bh * k);
  const url = out.toDataURL("image/png");
  thumbs.set(id, url);
  return url;
}
