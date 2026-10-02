/**
 * GameRenderer – Canvas-2D-Rendering der isometrischen Vogelperspektive + Eingabe.
 *
 * Performance-Konzept:
 *  - Das Gelände (inkl. Bäume/Berge/Erzvorkommen) wird in Chunks (8×8 Kacheln) einmalig auf
 *    Offscreen-Canvases gebacken und danach nur noch per drawImage gezeichnet.
 *  - Gebäude sind gecachte Sprites; es werden nur sichtbare Objekte gezeichnet.
 *  - Pro Frame höchstens wenige Chunks backen (kein Ruckeln beim Herauszoomen).
 *  - Gerätepixelverhältnis auf 2 begrenzt.
 */
import { BUILDINGS, DEP, MAP_SIZE, STATUS_TEXT, T, type BuildingId } from "./data";
import type { Building, GameEngine } from "./engine";
import { hash2 } from "./mapgen";
import { buildingAccess } from "./pathing";
import { getSprite, HH, HW } from "./sprites";

const CS = 8; // Chunk-Größe in Kacheln
const MARGIN = 64; // Platz über dem Chunk für hohe Objekte
const PADX = 20;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.7;
const DEP_COLOR: Record<number, string> = { [DEP.IRON]: "#c9763f", [DEP.COAL]: "#1c1c22", [DEP.GOLD]: "#f5c518" };

interface Ptr { x: number; y: number; sx: number; sy: number; type: string; button: number; moved: boolean }

type Ctx = CanvasRenderingContext2D;

export class GameRenderer {
  cam = { x: 0, y: 0, zoom: 0.9 };
  private ctx: Ctx;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private chunks = new Map<number, HTMLCanvasElement>();
  private chunkOrder: [number, number][] = [];
  private raf = 0;
  private last = 0;
  private frameNo = 0;
  private time = 0;
  private pointers = new Map<number, Ptr>();
  private pinch: { dist: number; zoom: number; mx: number; my: number } | null = null;
  private painting = false;
  private lastWarn = 0;
  private keys = new Set<string>();
  private ro: ResizeObserver | null = null;

  constructor(private canvas: HTMLCanvasElement, private engine: GameEngine) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    const n = MAP_SIZE / CS;
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) this.chunkOrder.push([cx, cy]);
    this.chunkOrder.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  }

  /* ============================================================== Lebenszyklus */

  start() {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("pointerleave", this.onLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", this.noMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(c);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("pointerleave", this.onLeave);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("contextmenu", this.noMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.ro?.disconnect();
    this.chunks.clear();
  }

  /** Andere Engine (neues Spiel/Laden) verwenden */
  setEngine(e: GameEngine) {
    this.engine = e;
    this.chunks.clear();
    this.centerOnTile(MAP_SIZE / 2, MAP_SIZE / 2 + 2);
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // auf kleinen Bildschirmen etwas weiter herauszoomen
    if (this.frameNo === 0) this.cam.zoom = this.w < 700 ? 0.75 : 1;
  }

  /* ================================================================== Kamera */

  centerOnTile(gx: number, gy: number) {
    this.cam.x = (gx - gy) * HW;
    this.cam.y = (gx + gy) * HH;
    this.clampCam();
  }
  zoomBy(f: number) { this.zoomAt(f, this.w / 2, this.h / 2); }
  private zoomAt(f: number, sx: number, sy: number) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.cam.zoom * f));
    const after = this.toWorld(sx, sy);
    this.cam.x += before[0] - after[0];
    this.cam.y += before[1] - after[1];
    this.clampCam();
  }
  private clampCam() {
    const N = MAP_SIZE;
    this.cam.x = Math.max(-N * HW, Math.min(N * HW, this.cam.x));
    this.cam.y = Math.max(0, Math.min(N * 2 * HH, this.cam.y));
  }
  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.cam.zoom + this.cam.x, (sy - this.h / 2) / this.cam.zoom + this.cam.y];
  }
  private toTile(sx: number, sy: number): [number, number] {
    const [wx, wy] = this.toWorld(sx, sy);
    return [Math.floor((wx / HW + wy / HH) / 2), Math.floor((wy / HH - wx / HW) / 2)];
  }

  /* ================================================================== Eingabe */

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private noMenu = (e: Event) => e.preventDefault();

  /** Ankerkachel (links oben) so wählen, dass die Zielkachel in der Mitte der Grundfläche liegt */
  private anchor(type: BuildingId, tx: number, ty: number): [number, number] {
    const [w, h] = this.engine.ui.buildRotation % 2 ? [BUILDINGS[type].size[1], BUILDINGS[type].size[0]] : BUILDINGS[type].size;
    return [tx - Math.floor(w / 2), ty - Math.floor(h / 2)];
  }

  private updateGhost(sx: number, sy: number) {
    const t = this.engine.ui.buildType;
    if (!t) return;
    const [tx, ty] = this.toTile(sx, sy);
    const [ax, ay] = this.anchor(t, tx, ty);
    this.engine.setGhost(ax, ay);
  }

  private paintRoad(sx: number, sy: number) {
    const [tx, ty] = this.toTile(sx, sy);
    const r = this.engine.place("road", tx, ty);
    if (!r.ok && r.reason?.startsWith("Nicht genug") && performance.now() - this.lastWarn > 1500) {
      this.lastWarn = performance.now();
      this.engine.toast(r.reason, "warn");
    }
    this.engine.setGhost(tx, ty);
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType, button: e.button, moved: false });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      a.moved = b.moved = true;
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      this.painting = false;
    } else if (e.pointerType === "mouse" && e.button === 0 && this.engine.ui.buildType === "road") {
      this.painting = true;
      this.paintRoad(p.x, p.y);
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === "mouse") this.updateGhost(p.x, p.y);
      return;
    }
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    if (this.pointers.size >= 2 && this.pinch) {
      ptr.x = p.x; ptr.y = p.y;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinch.zoom * (dist / this.pinch.dist)));
      this.zoomAt(target / this.cam.zoom, mx, my);
      this.cam.x -= (mx - this.pinch.mx) / this.cam.zoom;
      this.cam.y -= (my - this.pinch.my) / this.cam.zoom;
      this.clampCam();
      this.pinch.mx = mx; this.pinch.my = my;
      return;
    }
    if (Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 6) ptr.moved = true;
    if (this.painting) {
      this.paintRoad(p.x, p.y);
    } else if (ptr.moved || ptr.button === 1 || ptr.button === 2) {
      ptr.moved = true;
      this.cam.x -= dx / this.cam.zoom;
      this.cam.y -= dy / this.cam.zoom;
      this.clampCam();
    } else if (ptr.type === "mouse") {
      this.updateGhost(p.x, p.y);
    }
    ptr.x = p.x; ptr.y = p.y;
  };

  private onUp = (e: PointerEvent) => {
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const wasPainting = this.painting;
    if (e.pointerType === "mouse") this.painting = false;
    if (ptr && !ptr.moved && !wasPainting && ptr.button === 0 && e.type === "pointerup") this.tap(ptr);
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !this.pointers.size) this.engine.clearGhost();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    this.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };

  private tap(ptr: Ptr) {
    const eng = this.engine;
    const [tx, ty] = this.toTile(ptr.x, ptr.y);
    const bt = eng.ui.buildType;
    if (bt) {
      if (bt === "road") {
        const r = eng.place("road", tx, ty);
        if (!r.ok && r.reason) eng.toast(r.reason, "warn");
        eng.setGhost(tx, ty);
        return;
      }
      const [ax, ay] = this.anchor(bt, tx, ty);
      if (ptr.type === "mouse") {
        eng.setGhost(ax, ay);
        eng.confirmGhost();
      } else {
        const g = eng.ui.ghost;
        const [w, h] = eng.ui.buildRotation % 2 ? [BUILDINGS[bt].size[1], BUILDINGS[bt].size[0]] : BUILDINGS[bt].size;
        if (g && tx >= g.x && tx < g.x + w && ty >= g.y && ty < g.y + h) eng.confirmGhost();
        else eng.setGhost(ax, ay);
      }
      return;
    }
    // Auswahl: erst die Kachel selbst, dann (für hohe Gebäude) Kacheln davor
    let hit: Building | undefined = eng.buildingAt(tx, ty);
    for (let k = 1; !hit && k <= 2; k++) {
      const b = eng.buildingAt(tx + k, ty + k);
      if (b && BUILDINGS[b.type].height >= 28 * k) hit = b;
    }
    eng.select(hit ? hit.id : null);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const k = e.key.toLowerCase();
    if (k === "escape") { this.engine.setBuildType(null); this.engine.select(null); return; }
    if (k === "r" && this.engine.ui.buildType) { this.engine.rotateBuild(); return; }
    if (k === "+" || k === "=") this.zoomBy(1.2);
    else if (k === "-") this.zoomBy(1 / 1.2);
    else this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };

  /* ================================================================ Hauptschleife */

  private frame = (t: number) => {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.time += dt;
    this.engine.update(dt);
    if (this.keys.size) {
      const s = (650 * dt) / this.cam.zoom;
      const k = this.keys;
      if (k.has("arrowleft") || k.has("a")) this.cam.x -= s;
      if (k.has("arrowright") || k.has("d")) this.cam.x += s;
      if (k.has("arrowup") || k.has("w")) this.cam.y -= s;
      if (k.has("arrowdown") || k.has("s")) this.cam.y += s;
      this.clampCam();
    }
    this.draw();
    this.frameNo++;
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const c = this.ctx;
    const { zoom } = this.cam;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#17425f";
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.dpr * zoom, 0, 0, this.dpr * zoom, this.dpr * (this.w / 2 - this.cam.x * zoom), this.dpr * (this.h / 2 - this.cam.y * zoom));

    const vx0 = this.cam.x - this.w / 2 / zoom, vx1 = this.cam.x + this.w / 2 / zoom;
    const vy0 = this.cam.y - this.h / 2 / zoom, vy1 = this.cam.y + this.h / 2 / zoom;

    /* Gelände */
    if (this.engine.treeDirtyChunks.size) { for (const k of this.engine.treeDirtyChunks) this.chunks.delete(k); this.engine.treeDirtyChunks.clear(); }
    let budget = this.frameNo < 3 ? 100 : 3;
    for (const [cx, cy] of this.chunkOrder) {
      const wx0 = (cx * CS - cy * CS - CS) * HW - PADX;
      const wy0 = (cx + cy) * CS * HH - MARGIN;
      const cw = CS * 2 * HW + PADX * 2, ch = CS * 2 * HH + MARGIN;
      if (wx0 > vx1 || wx0 + cw < vx0 || wy0 > vy1 || wy0 + ch < vy0) continue;
      const key = cy * 100 + cx;
      let img = this.chunks.get(key);
      if (!img) {
        if (budget-- <= 0) continue;
        img = this.bake(cx, cy, cw, ch, wx0, wy0);
        this.chunks.set(key, img);
      }
      c.drawImage(img, wx0, wy0);
    }
    this.drawTreeStates(c, vx0, vx1, vy0, vy1);
    this.drawFieldStates(c, vx0, vx1, vy0, vy1);

    /* Gebäude sammeln */
    const eng = this.engine;
    const roads: Building[] = [];
    const flats: Building[] = [];
    const tall: Building[] = [];
    for (const b of eng.buildings) {
      const def = BUILDINGS[b.type];
      const [w, h] = b.rotation % 2 ? [def.size[1], def.size[0]] : def.size;
      const wx = (b.x - b.y) * HW, wy = (b.x + b.y) * HH;
      if (wx + h * HW + 20 < vx0 || wx - w * HW - 20 > vx1 || wy - def.height - 30 > vy1 || wy + (w + h) * HH + 10 < vy0) continue;
      if (b.type === "road") roads.push(b);
      else if (def.flat) flats.push(b);
      else tall.push(b);
    }
    this.drawRoads(c, roads);
    for (const b of flats) this.drawBuilding(c, b);
    tall.sort((a, b) => {
      const da = a.x + a.y + BUILDINGS[a.type].size[0] + BUILDINGS[a.type].size[1];
      const db = b.x + b.y + BUILDINGS[b.type].size[0] + BUILDINGS[b.type].size[1];
      return da - db || a.y - b.y;
    });
    for (const b of tall) this.drawBuilding(c, b);
    this.drawResidents(c);

    /* Overlays */
    const sel = eng.ui.selectedId ? eng.getBuilding(eng.ui.selectedId) : undefined;
    if (sel) { const [sw, sh] = sel.rotation % 2 ? [BUILDINGS[sel.type].size[1], BUILDINGS[sel.type].size[0]] : BUILDINGS[sel.type].size; this.drawOutline(c, sel.x, sel.y, sw, sh, "rgba(255,255,255,0.95)"); }
    if (sel) for (const [ax, ay] of buildingAccess(sel)) this.fillFootprint(c, ax, ay, 1, 1, "rgba(255,214,90,0.35)", "rgba(255,214,90,0.9)", 1.5);
    for (const b of tall) this.drawOverlay(c, b);
    this.drawGhost(c);
  }

  private drawTreeStates(c: Ctx, vx0: number, vx1: number, vy0: number, vy1: number) {
    const eng = this.engine;
    for (const [i, rawStage] of eng.treeGrowth) {
      const x = i % MAP_SIZE, y = Math.floor(i / MAP_SIZE), wx = (x - y) * HW, wy = (x + y) * HH + HH;
      if (wx < vx0 - 40 || wx > vx1 + 40 || wy < vy0 - 45 || wy > vy1 + 30) continue;
      const stage = Math.floor(Math.max(0, Math.min(3, rawStage)));
      if (stage >= 3) continue;
      const s = stage === 0 ? 0.35 : stage === 1 ? 0.6 : 0.82;
      c.save(); c.translate(wx, wy);
      c.fillStyle = stage === 0 ? "#5a3b25" : "#476f38";
      c.fillRect(-2, -5 * s, 4, 9 * s);
      if (stage > 0) { c.fillStyle = stage === 1 ? "#86a64d" : "#3f7c42"; c.beginPath(); c.moveTo(0, -28 * s); c.lineTo(-11 * s, 0); c.lineTo(11 * s, 0); c.closePath(); c.fill(); }
      c.restore();
    }
  }

  private drawFieldStates(c: Ctx, vx0: number, vx1: number, vy0: number, vy1: number) {
    for (const b of this.engine.buildings) {
      if (!b.field) continue;
      const wx = (b.x - b.y) * HW, wy = (b.x + b.y) * HH + HH;
      if (wx < vx0 - 50 || wx > vx1 + 50 || wy < vy0 - 30 || wy > vy1 + 40) continue;
      const fs = b.field, colors: Record<string, string> = { EMPTY: "#76552f", PLOWED: "#8a6032", SOWN: "#a77b38", GROWING: "#6b983d", RIPE: "#d0aa3d", HARVESTING: "#c27d2e", HARVESTED: "#8d6b3a" };
      c.fillStyle = colors[fs.stage]; c.globalAlpha = 0.78; c.fillRect(wx - 22, wy - 10, 44, 18); c.globalAlpha = 1;
      if (fs.stage === "GROWING" || fs.stage === "RIPE" || fs.stage === "HARVESTING") { c.strokeStyle = fs.stage === "RIPE" ? "#ffe17b" : "#8db74e"; c.lineWidth = 2; for (let i = -16; i <= 16; i += 8) { c.beginPath(); c.moveTo(wx + i, wy + 5); c.lineTo(wx + i + 2, wy - (fs.stage === "RIPE" ? 12 : 8)); c.stroke(); } }
    }
  }

  /* ============================================================== Terrain backen */

  private bake(cx: number, cy: number, cw: number, ch: number, wx0: number, wy0: number): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const c = cv.getContext("2d")!;
    c.translate(-wx0, -wy0);
    const m = this.engine.map;
    const seed = m.seed;
    const x0 = cx * CS, y0 = cy * CS;
    for (let s = 0; s < CS * 2 - 1; s++) {
      for (let i = 0; i < CS; i++) {
        const j = s - i;
        if (j < 0 || j >= CS) continue;
        const x = x0 + i, y = y0 + j;
        this.bakeTile(c, m.terrain[y * m.size + x], m.deposit[y * m.size + x], m.elev[y * m.size + x], x, y, seed);
      }
    }
    return cv;
  }

  private diamond(c: Ctx, wx: number, wy: number, col: string) {
    c.beginPath();
    c.moveTo(wx, wy - 0.7); c.lineTo(wx + HW + 0.7, wy + HH); c.lineTo(wx, wy + 2 * HH + 0.7); c.lineTo(wx - HW - 0.7, wy + HH);
    c.closePath();
    c.fillStyle = col;
    c.fill();
  }

  private bakeTile(c: Ctx, t: number, dep: number, elev: number, x: number, y: number, seed: number) {
    const wx = (x - y) * HW, wy = (x + y) * HH;
    const v = hash2(x, y, seed + 11);
    const cxp = wx, cyp = wy + HH;
    switch (t) {
      case T.LAKE:
      case T.RIVER: {
        const l = 30 + (elev / 255) * 30 + v * 4;
        this.diamond(c, wx, wy, `hsl(206,58%,${l}%)`);
        if (v > 0.65) {
          c.strokeStyle = "rgba(255,255,255,0.28)"; c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(cxp - 8, cyp + 1); c.quadraticCurveTo(cxp - 3, cyp - 2, cxp + 2, cyp + 1); c.stroke();
        }
        return;
      }
      case T.SAND:
        this.diamond(c, wx, wy, `hsl(${42 + v * 4},52%,${66 + v * 6}%)`);
        return;
      case T.MOUNTAIN: {
        this.diamond(c, wx, wy, `hsl(28,9%,${40 + v * 5}%)`);
        const tall = dep ? 0.5 : 1;
        const hp = (26 + hash2(x, y, seed + 3) * 26 + (elev - 160) * 0.12) * tall;
        // kleiner Nebengipfel
        this.peak(c, cxp - 15, cyp + 5, 26, hp * 0.55, v);
        this.peak(c, cxp + 3, cyp + 4, 30, hp, v);
        if (dep) {
          const col = DEP_COLOR[dep];
          c.fillStyle = "rgba(255,255,255,0.22)";
          c.beginPath(); c.ellipse(cxp, cyp + 9, 16, 7, 0, 0, 7); c.fill();
          for (const [ox, oy, r] of [[-8, 9, 3.6], [0, 7, 4.2], [8, 10, 3.6], [-2, 13, 3.2], [5, 14, 2.8]]) {
            c.beginPath(); c.arc(cxp + ox, cyp + oy, r, 0, 7);
            c.fillStyle = col; c.fill();
            c.strokeStyle = "rgba(0,0,0,0.55)"; c.lineWidth = 1; c.stroke();
            c.fillStyle = "rgba(255,255,255,0.65)";
            c.beginPath(); c.arc(cxp + ox - r * 0.3, cyp + oy - r * 0.3, r * 0.3, 0, 7); c.fill();
          }
        }
        return;
      }
      case T.FOREST: {
        this.diamond(c, wx, wy, `hsl(${104 + v * 8},38%,${27 + v * 5}%)`);
        if (this.engine.treeGrowth.has(y * MAP_SIZE + x)) return; // abgeholzt / Setzling: Baum wird dynamisch gezeichnet
        const n = 2 + (v > 0.45 ? 1 : 0);
        const pts: [number, number, number][] = [];
        for (let k = 0; k < n; k++) {
          const a = hash2(x * 7 + k, y * 13, seed + 21), b = hash2(x * 11, y * 5 + k, seed + 22);
          pts.push([cxp + (a - 0.5) * 34, cyp + (b - 0.5) * 12 + 4, hash2(x + k, y - k, seed + 23)]);
        }
        pts.sort((p, q) => p[1] - q[1]);
        for (const [px, py, r] of pts) (r > 0.3 ? this.pine : this.oak).call(this, c, px, py + 4, 0.85 + r * 0.45, r);
        return;
      }
      default: {
        this.diamond(c, wx, wy, `hsl(${92 + v * 12},${38 + v * 6}%,${34 + v * 7}%)`);
        if (v > 0.82) {
          const fx = cxp + (hash2(x, y, seed + 40) - 0.5) * 30, fy = cyp + (hash2(x, y, seed + 41) - 0.5) * 12;
          c.fillStyle = v > 0.92 ? "#f2d94e" : "#f0f0f0";
          c.beginPath(); c.arc(fx, fy, 1.6, 0, 7); c.fill();
          c.fillStyle = "rgba(20,60,10,0.4)";
          c.fillRect(fx - 4, fy + 2, 2, 1); c.fillRect(fx + 3, fy + 3, 2, 1);
        }
      }
    }
  }

  private peak(c: Ctx, x: number, y: number, hw: number, hp: number, v: number) {
    const tip: [number, number] = [x + (v - 0.5) * 6, y - hp];
    c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(x - hw, y); c.lineTo(x, y + 9); c.closePath();
    c.fillStyle = "#8f8f97"; c.fill();
    c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(x, y + 9); c.lineTo(x + hw, y); c.closePath();
    c.fillStyle = "#676770"; c.fill();
    if (hp > 34) { // Schneekappe
      const k = 0.32;
      const lx = tip[0] + (x - hw - tip[0]) * k, ly = tip[1] + (y - tip[1]) * k;
      const mx = tip[0] + (x - tip[0]) * k, my = tip[1] + (y + 9 - tip[1]) * k;
      const rx = tip[0] + (x + hw - tip[0]) * k, ry = tip[1] + (y - tip[1]) * k;
      c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(lx, ly); c.lineTo(mx, my); c.closePath();
      c.fillStyle = "#f4f6f8"; c.fill();
      c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(mx, my); c.lineTo(rx, ry); c.closePath();
      c.fillStyle = "#cdd3da"; c.fill();
    }
  }

  private pine(c: Ctx, x: number, y: number, s: number, r: number) {
    c.fillStyle = "#5a3d22"; c.fillRect(x - 1.5 * s, y - 5 * s, 3 * s, 6 * s);
    const dark = `hsl(140,${42 + r * 10}%,${20 + r * 6}%)`, light = `hsl(135,${45 + r * 10}%,${30 + r * 6}%)`;
    for (let i = 0; i < 3; i++) {
      const yb = y - (4 + i * 8) * s, w = (11 - i * 2.6) * s, tip = yb - 14 * s;
      c.beginPath(); c.moveTo(x, tip); c.lineTo(x - w, yb); c.lineTo(x, yb); c.closePath(); c.fillStyle = dark; c.fill();
      c.beginPath(); c.moveTo(x, tip); c.lineTo(x, yb); c.lineTo(x + w, yb); c.closePath(); c.fillStyle = light; c.fill();
    }
  }

  private oak(c: Ctx, x: number, y: number, s: number, r: number) {
    c.fillStyle = "#6a4a2a"; c.fillRect(x - 2 * s, y - 9 * s, 4 * s, 10 * s);
    const blobs: [number, number, number, string][] = [
      [0, -19, 10, `hsl(112,42%,${26 + r * 8}%)`], [-5, -15, 7, `hsl(108,40%,${32 + r * 8}%)`],
      [5, -16, 7, `hsl(115,44%,${30 + r * 8}%)`], [-1, -23, 6, `hsl(100,46%,${38 + r * 6}%)`],
    ];
    for (const [ox, oy, rad, col] of blobs) { c.beginPath(); c.arc(x + ox * s, y + oy * s, rad * s, 0, 7); c.fillStyle = col; c.fill(); }
  }

  /* ============================================================ Dynamische Objekte */

  private drawRoads(c: Ctx, roads: Building[]) {
    if (!roads.length) return;
    const eng = this.engine;
    const isRoad = (x: number, y: number) => { const b = eng.buildingAt(x, y); return !!b && b.type === "road"; };
    const dirs: [number, number, number, number][] = [[1, 0, HW / 2, HH / 2], [-1, 0, -HW / 2, -HH / 2], [0, 1, -HW / 2, HH / 2], [0, -1, HW / 2, -HH / 2]];
    c.lineCap = "butt";
    for (const pass of [0, 1]) {
      for (const b of roads) {
        const cx = (b.x - b.y) * HW, cy = (b.x + b.y) * HH + HH;
        c.globalAlpha = b.built ? 1 : 0.35 + b.progress * 0.5;
        c.strokeStyle = pass ? "#b8a174" : "#6b5a3c";
        c.fillStyle = c.strokeStyle;
        c.lineWidth = pass ? 9 : 13;
        c.beginPath();
        for (const [dx, dy, ox, oy] of dirs) if (isRoad(b.x + dx, b.y + dy)) { c.moveTo(cx, cy); c.lineTo(cx + ox, cy + oy); }
        c.stroke();
        c.beginPath(); c.arc(cx, cy, pass ? 4.6 : 6.6, 0, 7); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  private drawBuilding(c: Ctx, b: Building) {
    const def = BUILDINGS[b.type];
    const [w, h] = b.rotation % 2 ? [def.size[1], def.size[0]] : def.size;
    const s = getSprite(b.type);
    const wx = (b.x - b.y) * HW, wy = (b.x + b.y) * HH;
    const dx = wx - s.ox, dy = wy - s.oy;
    if (b.built) {
      // Die prozeduralen Sprites sind bereits isometrisch gezeichnet. Eine Canvas-Rotation
      // um den Anker drehte sie bei 180° auf den Kopf und bei 90° seitlich. Die Rotation
      // bleibt für Footprint, Zugang und Spielstand erhalten; die Darstellung bleibt aufrecht.
      c.drawImage(s.canvas, dx, dy);
      return;
    }
    // Bauphase: Fundament, wachsendes Gebäude, Gerüst, Fortschrittsbalken
    const p = b.progress;
    this.fillFootprint(c, b.x, b.y, w, h, "rgba(120,100,70,0.75)");
    const bottom = dy + (w + h) * HH + s.oy;
    const full = (w + h) * HH + def.height + 10;
    c.save();
    c.beginPath();
    c.rect(dx, bottom - full * p, s.canvas.width, full * p + 6);
    c.clip();
    c.globalAlpha = 0.92;
    c.drawImage(s.canvas, dx, dy);
    c.restore();
    c.globalAlpha = 1;
    if (!def.flat) {
      const top = Math.max(10, def.height * p + 10);
      const pts: [number, number][] = [[b.x, b.y + h], [b.x + w, b.y + h], [b.x + w, b.y]];
      c.strokeStyle = "#c19a5b"; c.lineWidth = 2;
      c.beginPath();
      for (const [gx, gy] of pts) { const sx = (gx - gy) * HW, sy = (gx + gy) * HH; c.moveTo(sx, sy); c.lineTo(sx, sy - top); }
      const [ax, ay] = [(b.x - (b.y + h)) * HW, (b.x + b.y + h) * HH];
      const [bx, by] = [(b.x + w - (b.y + h)) * HW, (b.x + w + b.y + h) * HH];
      const [ex, ey] = [(b.x + w - b.y) * HW, (b.x + w + b.y) * HH];
      for (const f of [0.5, 1]) {
        const zz = top * f;
        c.moveTo(ax, ay - zz); c.lineTo(bx, by - zz); c.lineTo(ex, ey - zz);
      }
      c.stroke();
      // kleiner Hammer-Effekt
      const bob = Math.sin(this.time * 9 + b.id) * 2;
      const fx = (b.x + w / 2 - b.y - h / 2) * HW, fy = (b.x + w / 2 + b.y + h / 2) * HH;
      c.fillStyle = "#e7dcc2";
      c.beginPath(); c.arc(fx + 8, fy - 6 + bob, 2.2, 0, 7); c.fill();
    }
    const fx = (b.x + w / 2 - b.y - h / 2) * HW, fy = (b.x + w / 2 + b.y + h / 2) * HH;
    const topY = fy - Math.max(14, def.height * 0.6) - 14;
    c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(fx - 22, topY, 44, 6);
    c.fillStyle = "#e8b64a"; c.fillRect(fx - 21, topY + 1, 42 * p, 4);
  }

  private fillFootprint(c: Ctx, x: number, y: number, w: number, h: number, fill: string, stroke?: string, lw = 1.5) {
    const P = (gx: number, gy: number): [number, number] => [(gx - gy) * HW, (gx + gy) * HH];
    const pts = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  }

  private drawOutline(c: Ctx, x: number, y: number, w: number, h: number, col: string) {
    this.fillFootprint(c, x, y, w, h, "rgba(255,255,255,0.12)", col, 2.5);
  }

  private drawResidents(c: Ctx) {
    const eng = this.engine;
    const CARGO: Record<string, string> = { holz: "#8a5a2b", stein: "#9a9a9a", bretter: "#d9b26a", getreide: "#e0c050", mehl: "#f2efe6", brot: "#c98a3a", eisen: "#6b7a8a", kohle: "#222", gold: "#f2c94c", werkzeuge: "#7a8a9a" };
    for (const r of eng.residents) {
      if (r.state === "AT_HOME") continue; // im Haus
      const wx = (r.x - r.y) * HW, wy = (r.x + r.y) * HH;
      const still = r.state === "WAITING" || r.state === "WORKING" || r.state === "CONSTRUCTION_WORK";
      const bob = still ? Math.sin(this.time * 2 + r.id) * 1.2 : Math.sin(this.time * 10 + r.id) * 2;
      const carrier = r.job === "traeger", builder = r.job === "baumeister";
      const work = r.state === "WORKING" || r.state === "CONSTRUCTION_WORK";
      c.fillStyle = builder ? "#e0b34a" : carrier ? "#d6b06a" : work ? "#e37d55" : "#f0d2a0";
      c.beginPath(); c.arc(wx, wy - 13 + bob, 3.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = carrier ? "#7a4e2b" : builder ? "#8a6a3a" : r.job === "unassigned" ? "#6b5a86" : "#315b82";
      c.fillRect(wx - 3, wy - 9 + bob, 6, 8);
      if (r.carrying) { c.fillStyle = CARGO[r.carrying.resource] ?? "#b57a3d"; c.fillRect(wx + 4, wy - 12 + bob, 6, 6); c.strokeStyle = "rgba(0,0,0,0.5)"; c.lineWidth = 1; c.strokeRect(wx + 4, wy - 12 + bob, 6, 6); }
    }
  }

  /** Rauch und Statusblasen */
  private drawOverlay(c: Ctx, b: Building) {
    const def = BUILDINGS[b.type];
    if (!b.built) return;
    const [w, h] = def.size;
    const wx = (b.x - b.y) * HW, wy = (b.x + b.y) * HH;
    if (def.smoke && b.connected && b.status !== "no_workers") {
      const [lx, ly, lz] = def.smoke;
      const bx = wx + (lx - ly) * HW, by = wy + (lx + ly) * HH - lz;
      for (let k = 0; k < 3; k++) {
        const ph = (this.time * 0.35 + k / 3 + b.id * 0.17) % 1;
        c.globalAlpha = (1 - ph) * 0.45;
        c.fillStyle = "#e9e9e9";
        c.beginPath(); c.arc(bx + ph * 10 + Math.sin(this.time * 2 + k) * 2, by - ph * 30, 2.5 + ph * 5, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    }
    const st = b.status;
    if (st !== "ok" && st !== "constructing") {
      const fx = (b.x + w / 2 - b.y - h / 2) * HW, fy = (b.x + w / 2 + b.y + h / 2) * HH;
      const r = 9 / Math.min(1, this.cam.zoom / 0.6);
      const bob = Math.sin(this.time * 4 + b.id) * 2;
      const y = fy - def.height - 14 + bob;
      c.beginPath(); c.arc(fx, y, r, 0, 7);
      c.fillStyle = STATUS_TEXT[st].color; c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = "#fff"; c.font = `bold ${Math.round(r * 1.4)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("!", fx, y + 1);
    }
  }

  private drawGhost(c: Ctx) {
    const eng = this.engine;
    const t = eng.ui.buildType, g = eng.ui.ghost;
    if (!t || !g) return;
    const def = BUILDINGS[t];
    const [w, h] = def.size;
    const ok = g.check.ok;
    const col = ok ? "rgba(90,220,110,0.42)" : "rgba(235,70,60,0.45)";
    this.fillFootprint(c, g.x, g.y, w, h, col, ok ? "#7dff8f" : "#ff6a5e", 2);
    if (t !== "road") {
      const s = getSprite(t);
      c.globalAlpha = ok ? 0.75 : 0.45;
      c.drawImage(s.canvas, (g.x - g.y) * HW - s.ox, (g.x + g.y) * HH - s.oy);
      c.globalAlpha = 1;
    }
    // Reichweite bei Standortgebäuden
    if (def.site) {
      const r = def.site.radius;
      this.fillFootprint(c, g.x - r, g.y - r, w + 2 * r, h + 2 * r, "rgba(255,255,255,0.05)", "rgba(255,255,255,0.35)", 1);
    }
  }
}
