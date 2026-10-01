/**
 * Prozedurale Kartengenerierung (deterministisch aus einem Seed).
 * Es wird nur der Seed gespeichert – die Karte wird beim Laden identisch neu erzeugt.
 *
 * Schritte: Höhenrelief + Feuchtigkeit (Value-Noise) → Seen/Berge/Wälder → Flüsse →
 * Startgebiet freiräumen → garantierte Wald-/Berg-/Erzvorkommen nahe dem Start → Strand.
 */
import { DEP, MAP_SIZE, T } from "./data";

export interface MapData {
  size: number;
  seed: number;
  terrain: Uint8Array;
  deposit: Uint8Array;
  /** Höhe 0..255 (für Schattierung) */
  elev: Uint8Array;
}

/** Schneller seeded PRNG */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zufallswert 0..1 pro Gitterpunkt (auch für kosmetische Variation genutzt) */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, oct: number): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function generateMap(seed: number): MapData {
  const N = MAP_SIZE;
  const c = N / 2;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const terrain = new Uint8Array(N * N);
  const deposit = new Uint8Array(N * N);
  const elev = new Uint8Array(N * N);
  const E = new Float32Array(N * N);
  const idx = (x: number, y: number) => y * N + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
  const isWater = (t: number) => t === T.LAKE || t === T.RIVER;

  /* 1) Relief, Seen, Berge, Wälder */
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let e = fbm(x * 0.07, y * 0.07, seed, 4);
      const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
      if (edge < 6) e -= ((6 - edge) / 6) * 0.5;
      E[idx(x, y)] = e;
      elev[idx(x, y)] = Math.max(0, Math.min(255, Math.round(e * 255)));
      const m = fbm(x * 0.09 + 100, y * 0.09 + 100, seed + 7, 3);
      let t: number = T.GRASS;
      if (e < 0.36) t = T.LAKE;
      else if (e > 0.64) t = T.MOUNTAIN;
      else if (m > 0.54) t = T.FOREST;
      terrain[idx(x, y)] = t;
    }
  }

  /* 2) Flüsse: von Bergen abwärts bis zum Wasser */
  const mountains: number[] = [];
  for (let i = 0; i < N * N; i++) if (terrain[i] === T.MOUNTAIN) mountains.push(i);
  const riverCount = Math.min(3, mountains.length ? 3 : 0);
  for (let r = 0; r < riverCount; r++) {
    let p = mountains[Math.floor(rng() * mountains.length)];
    let x = p % N, y = Math.floor(p / N);
    const seen = new Set<number>();
    for (let step = 0; step < 160; step++) {
      if (Math.hypot(x - c, y - c) < 11) break;
      const cur = idx(x, y);
      seen.add(cur);
      const wasWater = terrain[cur] === T.LAKE;
      if (wasWater && step > 2) break;
      terrain[cur] = T.RIVER;
      deposit[cur] = 0;
      let best = -1, bestV = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny) || seen.has(idx(nx, ny))) continue;
        const v = E[idx(nx, ny)] + rng() * 0.06;
        if (v < bestV) { bestV = v; best = idx(nx, ny); }
      }
      if (best < 0) break;
      p = best; x = p % N; y = Math.floor(p / N);
    }
  }

  /* 3) Startgebiet freiräumen */
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (Math.hypot(x - c + 0.5, y - c + 0.5) < 8) { terrain[idx(x, y)] = T.GRASS; deposit[idx(x, y)] = 0; }

  /* 4) Garantierte Vorkommen nahe dem Start (Karte bleibt immer spielbar) */
  const a0 = rng() * Math.PI * 2;
  const blob = (cx: number, cy: number, rad: number, kind: number): number[] => {
    const cells: number[] = [];
    for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++)
      for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
        if (!inb(x, y) || Math.hypot(x - c + 0.5, y - c + 0.5) < 8) continue;
        const d = Math.hypot(x - cx, y - cy) + (hash2(x, y, seed + 5) - 0.5) * 1.8;
        if (d < rad) { terrain[idx(x, y)] = kind; deposit[idx(x, y)] = 0; cells.push(idx(x, y)); }
      }
    return cells;
  };
  const at = (ang: number, dist: number): [number, number] => [c + Math.cos(ang) * dist, c + Math.sin(ang) * dist];
  blob(...at(a0, 12), 4.2, T.FOREST);
  blob(...at(a0 + 4.3, 14), 3.6, T.FOREST);
  const m1 = blob(...at(a0 + 2.1, 17), 4.4, T.MOUNTAIN);
  const m2 = blob(...at(a0 + 3.6, 22), 4.2, T.MOUNTAIN);
  const place = (cells: number[], kind: number, n: number) => {
    const pool = cells.slice();
    for (let i = 0; i < n && pool.length; i++) {
      const k = Math.floor(rng() * pool.length);
      deposit[pool[k]] = kind;
      pool.splice(k, 1);
    }
  };
  place(m1, DEP.IRON, 4); place(m1, DEP.COAL, 3); place(m1, DEP.GOLD, 1);
  place(m2, DEP.IRON, 3); place(m2, DEP.COAL, 3); place(m2, DEP.GOLD, 2);

  /* 5) Natürliche Vorkommen im restlichen Gebirge */
  for (let i = 0; i < N * N; i++) {
    if (terrain[i] !== T.MOUNTAIN || deposit[i]) continue;
    const x = i % N, y = Math.floor(i / N);
    if (hash2(x, y, seed + 31) > 0.9) {
      const k = hash2(x, y, seed + 77);
      deposit[i] = k < 0.5 ? DEP.IRON : k < 0.85 ? DEP.COAL : DEP.GOLD;
    }
  }

  /* 6) Strand: Gras neben Wasser */
  const sand: number[] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (terrain[idx(x, y)] !== T.GRASS) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inb(x + dx, y + dy) && isWater(terrain[idx(x + dx, y + dy)])) { sand.push(idx(x, y)); dy = 2; break; }
    }
  for (const i of sand) terrain[i] = T.SAND;

  return { size: N, seed, terrain, deposit, elev };
}
