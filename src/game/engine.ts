import { Sfx } from './audio';

export const W = 480;
export const H = 720;

export type GameState = 'menu' | 'playing' | 'paused' | 'over';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyCfg {
  label: string;
  hp: number;
  fire: number;
  speed: number;
  score: number;
  dmg: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyCfg> = {
  easy: { label: 'Kadett', hp: 0.8, fire: 0.75, speed: 0.88, score: 0.8, dmg: 0.7 },
  normal: { label: 'Pilot', hp: 1, fire: 1, speed: 1, score: 1, dmg: 1 },
  hard: { label: 'Veteran', hp: 1.35, fire: 1.35, speed: 1.15, score: 1.6, dmg: 1.35 },
};

export interface GameOverInfo {
  score: number;
  wave: number;
  kills: number;
  time: number;
  best: number;
  isRecord: boolean;
  difficulty: Difficulty;
  bosses: number;
}

export interface Callbacks {
  onState: (s: GameState) => void;
  onGameOver: (info: GameOverInfo) => void;
  onMute: (m: boolean) => void;
}

type EnemyKind = 'scout' | 'zig' | 'tank' | 'kamikaze' | 'shooter' | 'boss';
type PickupKind = 'power' | 'shield' | 'health' | 'bomb';

interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  weapon: number;
  shield: number;
  invuln: number;
  bombs: number;
  fireCd: number;
  alive: boolean;
  hit: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  friendly: boolean;
  color: string;
  dead: boolean;
}

interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  baseX: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  t: number;
  cd: number;
  cd2: number;
  cd3: number;
  score: number;
  flash: number;
  dir: number;
  angle: number;
  phase: number;
  bossType: number;
  entered: boolean;
  dead: boolean;
}

interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  t: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  glow: boolean;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  max_life: number;
  color: string;
  width: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
  size: number;
}

interface Spawn {
  t: number;
  kind: EnemyKind;
  x: number;
  dir?: number;
}

interface Banner {
  text: string;
  sub: string;
  t: number;
  max: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  z: number;
  tw: number;
}

const BOSS_NAMES = ['WÄCHTER', 'HYDRA', 'DREADNOUGHT'];
const BEST_KEY = 'novastrike.best.v1';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Game {
  state: GameState = 'menu';
  diffKey: Difficulty = 'normal';
  best = 0;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: Callbacks;
  private sfx = new Sfx();
  private raf = 0;
  private lastT = 0;
  private alive = true;
  private keys = new Set<string>();
  private pointer = { active: false, sx: 0, sy: 0 };
  private nebula: HTMLCanvasElement;
  private nebulaY = 0;
  private stars: Star[] = [];
  private clock = 0;

  private diff: DifficultyCfg = DIFFICULTIES.normal;
  private p!: Player;
  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private queue: Spawn[] = [];
  private banner: Banner | null = null;

  private score = 0;
  private wave = 0;
  private kills = 0;
  private bosses = 0;
  private time = 0;
  private combo = 0;
  private comboT = 0;
  private waveT = 0;
  private waveDelay = -1;
  private shake = 0;
  private flash = 0;
  private deathT = 0;
  private bossRef: Enemy | null = null;

  constructor(canvas: HTMLCanvasElement, cb: Callbacks) {
    this.canvas = canvas;
    this.cb = cb;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas nicht verfügbar');
    this.ctx = ctx;
    try {
      this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      this.best = 0;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.nebula = this.buildNebula();
    for (let i = 0; i < 100; i++) this.stars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.15, 1), tw: rand(0, 6) });
    this.resetWorld();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);

    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }

  /* ------------------------------------------------------------------ */
  /* Öffentliche Steuerung                                               */
  /* ------------------------------------------------------------------ */

  start(d: Difficulty) {
    this.sfx.unlock();
    this.diffKey = d;
    this.diff = DIFFICULTIES[d];
    this.resetWorld();
    this.state = 'playing';
    this.sfx.start();
    this.startWave(1);
    this.cb.onState(this.state);
  }

  toMenu() {
    this.resetWorld();
    this.state = 'menu';
    this.cb.onState(this.state);
  }

  pause() {
    if (this.state !== 'playing' || !this.p.alive) return;
    this.state = 'paused';
    this.keys.clear();
    this.cb.onState(this.state);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.lastT = performance.now();
    this.cb.onState(this.state);
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  toggleMute() {
    this.sfx.unlock();
    this.sfx.setMuted(!this.sfx.muted);
    this.cb.onMute(this.sfx.muted);
  }

  bomb() {
    if (this.state !== 'playing' || !this.p.alive || this.p.bombs <= 0) return;
    const p = this.p;
    p.bombs--;
    this.flash = 1;
    this.shake = Math.max(this.shake, 14);
    p.invuln = Math.max(p.invuln, 1);
    this.sfx.bomb();
    this.rings.push({ x: p.x, y: p.y, r: 10, max: 620, life: 0.7, max_life: 0.7, color: '#ffd166', width: 8 });
    this.rings.push({ x: p.x, y: p.y, r: 10, max: 480, life: 0.55, max_life: 0.55, color: '#ff6b6b', width: 5 });
    for (const b of this.bullets) {
      if (!b.friendly && !b.dead) {
        b.dead = true;
        this.spark(b.x, b.y, '#ffe29a', 3, 60);
        this.score += 5;
      }
    }
    for (const e of this.enemies) {
      if (!e.dead) this.hitEnemy(e, e.kind === 'boss' ? 30 : 40, true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Eingabe                                                             */
  /* ------------------------------------------------------------------ */

  private onKeyDown = (e: KeyboardEvent) => {
    const c = e.code;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(c) && this.state === 'playing') {
      e.preventDefault();
    }
    if (c === 'KeyM' && !e.repeat) {
      this.toggleMute();
      return;
    }
    if ((c === 'KeyP' || c === 'Escape') && !e.repeat) {
      this.togglePause();
      return;
    }
    if ((c === 'Space' || c === 'KeyB' || c === 'KeyX' || c === 'ShiftLeft' || c === 'ShiftRight') && !e.repeat) {
      this.bomb();
    }
    this.keys.add(c);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    if (document.hidden || !document.hasFocus()) this.pause();
  };

  private toCanvas(ev: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.sfx.unlock();
    const c = this.toCanvas(ev);
    this.pointer = { active: true, sx: c.x, sy: c.y };
    this.baseX = this.p.x;
    this.baseY = this.p.y;
    this.tx = this.p.x;
    this.ty = this.p.y;
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (!this.pointer.active) return;
    const c = this.toCanvas(ev);
    this.tx = this.baseX + (c.x - this.pointer.sx);
    this.ty = this.baseY + (c.y - this.pointer.sy);
  };

  private onPointerUp = () => {
    this.pointer.active = false;
  };

  private tx = W / 2;
  private ty = H - 120;
  private baseX = W / 2;
  private baseY = H - 120;

  /* ------------------------------------------------------------------ */
  /* Welt                                                                */
  /* ------------------------------------------------------------------ */

  private resetWorld() {
    this.p = {
      x: W / 2,
      y: H - 120,
      hp: 100,
      maxHp: 100,
      weapon: 1,
      shield: 0,
      invuln: 1.5,
      bombs: 2,
      fireCd: 0,
      alive: true,
      hit: 9,
    };
    this.tx = this.p.x;
    this.ty = this.p.y;
    this.baseX = this.p.x;
    this.baseY = this.p.y;
    this.pointer.active = false;
    this.bullets = [];
    this.enemies = [];
    this.pickups = [];
    this.parts = [];
    this.rings = [];
    this.texts = [];
    this.queue = [];
    this.banner = null;
    this.score = 0;
    this.wave = 0;
    this.kills = 0;
    this.bosses = 0;
    this.time = 0;
    this.combo = 0;
    this.comboT = 0;
    this.waveT = 0;
    this.waveDelay = -1;
    this.shake = 0;
    this.flash = 0;
    this.deathT = 0;
    this.bossRef = null;
  }

  private buildNebula() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#06061a');
    bg.addColorStop(0.5, '#0c0a2a');
    bg.addColorStop(1, '#06061a');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const cols = ['120,60,220', '40,120,255', '220,60,160', '30,200,200'];
    for (let i = 0; i < 7; i++) {
      const x = rand(0, W);
      const y = rand(160, H - 160);
      const r = rand(90, 160);
      const col = cols[i % cols.length];
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${col},0.22)`);
      rg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* Wellen                                                              */
  /* ------------------------------------------------------------------ */

  private startWave(n: number) {
    this.wave = n;
    this.waveT = 0;
    this.waveDelay = -1;
    this.queue = [];
    const q = this.queue;

    if (n % 5 === 0) {
      q.push({ t: 3.2, kind: 'boss', x: W / 2 });
      for (let i = 0; i < 10; i++) {
        const t = 10 + i * 5.5;
        if (i % 3 === 2) {
          q.push({ t, kind: 'zig', x: rand(80, W - 80), dir: Math.random() < 0.5 ? -1 : 1 });
        } else {
          const x = rand(100, W - 100);
          for (let k = 0; k < 3; k++) q.push({ t: t + k * 0.4, kind: 'scout', x });
        }
      }
      const bn = BOSS_NAMES[(n / 5 - 1) % 3];
      this.banner = { text: 'WARNUNG', sub: `${bn} nähert sich!`, t: 3, max: 3, color: '#ff4d6d' };
      this.sfx.warn();
    } else {
      const pool: [EnemyKind, number][] = [['scout', 5]];
      if (n >= 2) pool.push(['zig', 3]);
      if (n >= 3) pool.push(['kamikaze', 2.5], ['tank', 1 + Math.min(n * 0.1, 1.5)]);
      if (n >= 4) pool.push(['shooter', 2 + Math.min(n * 0.1, 1.5)]);
      const total = pool.reduce((s, [, w]) => s + w, 0);
      const pick = (): EnemyKind => {
        let r = Math.random() * total;
        for (const [k, w] of pool) {
          r -= w;
          if (r <= 0) return k;
        }
        return 'scout';
      };
      const groups = Math.min(4 + Math.floor(n * 1.1), 16);
      const gap = Math.max(1.6, 3.2 - n * 0.08);
      let t = 1.6;
      for (let g = 0; g < groups; g++) {
        const kind = pick();
        switch (kind) {
          case 'scout': {
            const x = rand(110, W - 110);
            for (let i = 0; i < 4; i++) q.push({ t: t + i * 0.45, kind, x });
            break;
          }
          case 'zig': {
            const dir = Math.random() < 0.5 ? -1 : 1;
            const x = dir > 0 ? rand(50, 160) : rand(W - 160, W - 50);
            const cnt = 2 + (n > 6 ? 1 : 0);
            for (let i = 0; i < cnt; i++) q.push({ t: t + i * 0.7, kind, x, dir });
            break;
          }
          case 'kamikaze': {
            const cnt = Math.min(2 + Math.floor(n / 4), 5);
            for (let i = 0; i < cnt; i++) q.push({ t: t + i * 0.35, kind, x: rand(40, W - 40) });
            break;
          }
          case 'shooter': {
            const cnt = n > 8 ? 2 : 1;
            for (let i = 0; i < cnt; i++) q.push({ t: t + i * 1.4, kind, x: rand(80, W - 80) });
            break;
          }
          case 'tank': {
            const cnt = n > 10 ? 2 : 1;
            for (let i = 0; i < cnt; i++) q.push({ t: t + i * 2, kind, x: rand(70, W - 70) });
            break;
          }
          default:
            break;
        }
        t += gap;
      }
      this.banner = { text: `WELLE ${n}`, sub: n === 4 ? 'Nächste Welle: Boss!' : 'Bereit machen', t: 2.2, max: 2.2, color: '#4cc9f0' };
      if (n > 1) this.sfx.wave();
    }
    q.sort((a, b) => a.t - b.t);
  }

  private spawnEnemy(kind: EnemyKind, x: number, dir?: number) {
    const n = this.wave;
    const hpMul = this.diff.hp * (1 + n * 0.04);
    const spd = this.diff.speed;
    const e: Enemy = {
      kind,
      x,
      y: -30,
      baseX: x,
      vx: 0,
      vy: 0,
      r: 14,
      hp: 1,
      maxHp: 1,
      t: 0,
      cd: rand(0.8, 2.2),
      cd2: 0,
      cd3: 0,
      score: 100,
      flash: 0,
      dir: dir ?? (Math.random() < 0.5 ? -1 : 1),
      angle: Math.PI / 2,
      phase: 0,
      bossType: 0,
      entered: true,
      dead: false,
    };
    switch (kind) {
      case 'scout':
        e.r = 14;
        e.hp = 2 * hpMul;
        e.vy = Math.min(95 + n * 4, 170) * spd;
        e.score = 100;
        break;
      case 'zig':
        e.r = 15;
        e.hp = 3 * hpMul;
        e.vy = 80 * spd;
        e.vx = 130 * spd;
        e.score = 150;
        break;
      case 'tank':
        e.r = 24;
        e.hp = 14 * hpMul;
        e.vy = 38 * spd;
        e.score = 400;
        e.cd = 1.2;
        break;
      case 'kamikaze':
        e.r = 13;
        e.hp = 2 * hpMul;
        e.vy = (220 + Math.min(n * 5, 90)) * spd;
        e.score = 120;
        e.y = -20;
        break;
      case 'shooter':
        e.r = 20;
        e.hp = 8 * hpMul;
        e.vy = 120;
        e.vx = 70 * spd;
        e.score = 300;
        e.cd = 1.6;
        e.cd2 = rand(90, 170); // Zielhöhe
        break;
      case 'boss': {
        const bn = Math.floor(n / 5) - 1;
        e.bossType = bn % 3;
        e.r = [44, 52, 60][e.bossType];
        e.hp = (260 + bn * 140) * this.diff.hp;
        e.y = -90;
        e.vy = 70;
        e.score = 5000 + bn * 2500;
        e.entered = false;
        e.cd = 1;
        e.cd2 = 0.5;
        e.cd3 = 7;
        this.bossRef = e;
        break;
      }
    }
    e.maxHp = e.hp;
    this.enemies.push(e);
    return e;
  }

  /* ------------------------------------------------------------------ */
  /* Schüsse                                                             */
  /* ------------------------------------------------------------------ */

  private eShoot(x: number, y: number, ang: number, speed: number, size: 's' | 'b', color?: string) {
    const sp = speed * this.diff.speed * (1 + Math.min(this.wave, 25) * 0.01);
    this.bullets.push({
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      r: size === 's' ? 4.5 : 7.5,
      dmg: (size === 's' ? 10 : 16) * this.diff.dmg,
      friendly: false,
      color: color ?? (size === 's' ? '#ff5d8f' : '#ffa62b'),
      dead: false,
    });
    this.sfx.enemyShoot();
  }

  private aim(x: number, y: number) {
    return Math.atan2(this.p.y - y, this.p.x - x);
  }

  private pShoot(x: number, y: number, ang: number, dmg = 1) {
    const sp = 720;
    this.bullets.push({
      x,
      y,
      vx: Math.sin(ang) * sp,
      vy: -Math.cos(ang) * sp,
      r: 4,
      dmg,
      friendly: true,
      color: this.p.weapon >= 5 ? '#ffd166' : this.p.weapon >= 3 ? '#9dffb0' : '#7df9ff',
      dead: false,
    });
  }

  private playerFire() {
    const p = this.p;
    const x = p.x;
    const y = p.y - 18;
    switch (p.weapon) {
      case 1:
        this.pShoot(x, y, 0);
        break;
      case 2:
        this.pShoot(x - 8, y, 0);
        this.pShoot(x + 8, y, 0);
        break;
      case 3:
        this.pShoot(x, y - 4, 0);
        this.pShoot(x - 10, y, -0.08);
        this.pShoot(x + 10, y, 0.08);
        break;
      case 4:
        this.pShoot(x - 6, y - 4, 0);
        this.pShoot(x + 6, y - 4, 0);
        this.pShoot(x - 14, y, -0.14);
        this.pShoot(x + 14, y, 0.14);
        break;
      default:
        this.pShoot(x, y - 6, 0, 1.3);
        this.pShoot(x - 9, y - 2, -0.06, 1.2);
        this.pShoot(x + 9, y - 2, 0.06, 1.2);
        this.pShoot(x - 16, y, -0.2, 1);
        this.pShoot(x + 16, y, 0.2, 1);
        break;
    }
    this.sfx.shoot();
  }

  /* ------------------------------------------------------------------ */
  /* Effekte                                                             */
  /* ------------------------------------------------------------------ */

  private spark(x: number, y: number, color: string, n: number, speed: number) {
    for (let i = 0; i < n && this.parts.length < 700; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.3, 1) * speed;
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.2, 0.5),
        max: 0.5,
        size: rand(1.2, 2.6),
        color,
        glow: true,
      });
    }
  }

  private explode(x: number, y: number, size: number, big = false) {
    const cols = ['#fff3b0', '#ffd166', '#ff9f1c', '#ff5d3a', '#ff2e63'];
    const n = Math.floor(size * (big ? 3 : 2));
    for (let i = 0; i < n && this.parts.length < 700; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.15, 1) * (big ? 360 : 220);
      const life = rand(0.35, big ? 1.3 : 0.85);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size: rand(1.5, big ? 5.5 : 3.8),
        color: cols[Math.floor(rand(0, cols.length))],
        glow: true,
      });
    }
    this.rings.push({
      x,
      y,
      r: 4,
      max: size * (big ? 4 : 2.8),
      life: big ? 0.6 : 0.35,
      max_life: big ? 0.6 : 0.35,
      color: '#ffd9a0',
      width: big ? 5 : 3,
    });
    this.sfx.explode(big);
  }

  private floatText(x: number, y: number, text: string, color = '#ffe29a', size = 14) {
    this.texts.push({ x, y, text, life: 1, color, size });
  }

  /* ------------------------------------------------------------------ */
  /* Schaden / Tod                                                       */
  /* ------------------------------------------------------------------ */

  private mult() {
    return 1 + Math.min(Math.floor(this.combo / 6), 5);
  }

  private addScore(base: number, x: number, y: number) {
    const pts = Math.round(base * this.mult() * this.diff.score);
    this.score += pts;
    this.floatText(x, y, `+${pts}`, this.mult() > 1 ? '#ffd166' : '#d0e8ff', base >= 300 ? 18 : 13);
  }

  private hitEnemy(e: Enemy, dmg: number, fromBomb = false) {
    if (e.dead) return;
    if (e.kind === 'boss' && !e.entered) return;
    e.hp -= dmg;
    e.flash = 0.07;
    if (!fromBomb) this.sfx.hit();
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    e.dead = true;
    this.kills++;
    this.combo++;
    this.comboT = 2.6;
    if (e.kind === 'boss') {
      this.bosses++;
      this.addScore(e.score, e.x, e.y);
      for (let i = 0; i < 6; i++) {
        window.setTimeout(() => {
          if (this.alive) this.explode(e.x + rand(-e.r, e.r), e.y + rand(-e.r, e.r), 40, true);
        }, i * 120);
      }
      this.explode(e.x, e.y, 90, true);
      this.shake = 26;
      this.flash = 0.8;
      this.banner = { text: 'BOSS BESIEGT!', sub: `+${Math.round(e.score * this.mult() * this.diff.score)} Punkte`, t: 2.6, max: 2.6, color: '#ffd166' };
      // Alles andere zerstören
      for (const o of this.enemies) {
        if (o !== e && !o.dead) {
          o.dead = true;
          this.explode(o.x, o.y, o.r * 1.6);
        }
      }
      for (const b of this.bullets) {
        if (!b.friendly) {
          b.dead = true;
          this.spark(b.x, b.y, '#ffe29a', 2, 50);
        }
      }
      this.queue = [];
      this.bossRef = null;
      this.dropPickup(e.x - 40, e.y, 'power');
      this.dropPickup(e.x, e.y, 'health');
      this.dropPickup(e.x + 40, e.y, Math.random() < 0.5 ? 'bomb' : 'shield');
      return;
    }
    this.addScore(e.score, e.x, e.y);
    this.explode(e.x, e.y, e.r * 1.6, e.kind === 'tank');
    if (e.kind === 'tank') this.shake = Math.max(this.shake, 6);
    const chance = { scout: 0.06, zig: 0.08, kamikaze: 0.07, shooter: 0.3, tank: 0.6, boss: 0 }[e.kind];
    if (Math.random() < chance) this.dropPickup(e.x, e.y);
  }

  private dropPickup(x: number, y: number, kind?: PickupKind) {
    if (!kind) {
      const p = this.p;
      const w: [PickupKind, number][] = [
        ['power', p.weapon >= 5 ? 6 : 34],
        ['shield', 20],
        ['health', p.hp < 60 ? 40 : p.hp < 100 ? 22 : 5],
        ['bomb', p.bombs >= 5 ? 4 : 18],
      ];
      const tot = w.reduce((s, [, v]) => s + v, 0);
      let r = Math.random() * tot;
      kind = 'power';
      for (const [k, v] of w) {
        r -= v;
        if (r <= 0) {
          kind = k;
          break;
        }
      }
    }
    this.pickups.push({ kind, x, y, t: 0 });
  }

  private hurt(dmg: number) {
    const p = this.p;
    if (!p.alive || p.invuln > 0) return false;
    if (p.shield > 0) {
      p.invuln = 0.35;
      this.sfx.shieldHit();
      this.rings.push({ x: p.x, y: p.y, r: 18, max: 46, life: 0.3, max_life: 0.3, color: '#4cc9f0', width: 3 });
      return true;
    }
    p.hp -= dmg;
    p.invuln = 1.3;
    this.shake = Math.max(this.shake, 10);
    this.combo = 0;
    this.comboT = 0;
    if (p.weapon > 1) p.weapon--;
    this.sfx.hurt();
    this.spark(p.x, p.y, '#ff6b6b', 14, 200);
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      this.deathT = 2.2;
      this.explode(p.x, p.y, 70, true);
      this.shake = 24;
      this.sfx.gameOver();
    }
    return true;
  }

  private finish() {
    const isRecord = this.score > this.best;
    if (isRecord) {
      this.best = this.score;
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        /* ignore */
      }
      window.setTimeout(() => this.alive && this.sfx.record(), 500);
    }
    this.state = 'over';
    this.cb.onState(this.state);
    this.cb.onGameOver({
      score: this.score,
      wave: this.wave,
      kills: this.kills,
      time: this.time,
      best: this.best,
      isRecord,
      difficulty: this.diffKey,
      bosses: this.bosses,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Update                                                              */
  /* ------------------------------------------------------------------ */

  private loop = (now: number) => {
    if (!this.alive) return;
    const dt = Math.min((now - this.lastT) / 1000, 1 / 30);
    this.lastT = now;
    this.clock += dt;
    if (this.state !== 'paused') this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    // Hintergrund
    const scroll = this.state === 'playing' ? 1 : 0.5;
    this.nebulaY = (this.nebulaY + 22 * dt * scroll) % H;
    for (const s of this.stars) {
      s.y += (25 + s.z * 150) * dt * scroll;
      if (s.y > H) {
        s.y -= H;
        s.x = rand(0, W);
      }
    }
    if (this.state === 'menu') {
      this.updateEffects(dt);
      return;
    }
    if (this.state !== 'playing' && this.state !== 'over') return;

    const p = this.p;
    const sdt = p.alive ? dt : dt * 0.4;
    if (p.alive) this.time += dt;

    this.shake = Math.max(0, this.shake - 40 * sdt);
    this.flash = Math.max(0, this.flash - 1.6 * sdt);
    if (this.comboT > 0) {
      this.comboT -= sdt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (this.banner) {
      this.banner.t -= sdt;
      if (this.banner.t <= 0) this.banner = null;
    }

    if (this.state === 'playing') {
      if (p.alive) this.updatePlayer(dt);
      this.updateWaves(sdt);
      this.updateEnemies(sdt);
      this.updateBullets(sdt);
      this.collide();
      this.updatePickups(sdt);
    } else {
      this.updateBullets(sdt);
    }
    this.updateEffects(sdt);

    this.enemies = this.enemies.filter((e) => !e.dead);
    this.bullets = this.bullets.filter((b) => !b.dead);

    if (!p.alive && this.state === 'playing') {
      this.deathT -= dt;
      if (this.deathT <= 0) this.finish();
    }
  }

  private updatePlayer(dt: number) {
    const p = this.p;
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) dx -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) dx += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) dy -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) dy += 1;
    if (dx || dy) {
      const l = Math.hypot(dx, dy);
      const sp = 330;
      p.x += (dx / l) * sp * dt;
      p.y += (dy / l) * sp * dt;
      this.tx = p.x;
      this.ty = p.y;
      this.baseX = p.x;
      this.baseY = p.y;
      if (this.pointer.active) this.pointer.active = false;
    } else if (this.pointer.active) {
      const f = 1 - Math.pow(0.0005, dt);
      p.x += (this.tx - p.x) * f;
      p.y += (this.ty - p.y) * f;
    }
    p.x = clamp(p.x, 18, W - 18);
    p.y = clamp(p.y, H * 0.22, H - 50);
    if (!this.pointer.active) {
      this.baseX = p.x;
      this.baseY = p.y;
      this.tx = p.x;
      this.ty = p.y;
    }

    p.invuln = Math.max(0, p.invuln - dt);
    p.shield = Math.max(0, p.shield - dt);

    p.fireCd -= dt;
    if (p.fireCd <= 0) {
      this.playerFire();
      p.fireCd = p.weapon >= 5 ? 0.12 : 0.15;
    }

    // Triebwerk
    if (Math.random() < 0.8 && this.parts.length < 700) {
      this.parts.push({
        x: p.x + rand(-3, 3),
        y: p.y + 16,
        vx: rand(-14, 14),
        vy: rand(120, 200),
        life: 0.3,
        max: 0.3,
        size: rand(1.5, 3),
        color: Math.random() < 0.5 ? '#ffb347' : '#4cc9f0',
        glow: true,
      });
    }
  }

  private updateWaves(dt: number) {
    if (this.wave === 0) return;
    this.waveT += dt;
    while (this.queue.length && this.queue[0].t <= this.waveT) {
      const s = this.queue.shift()!;
      this.spawnEnemy(s.kind, s.x, s.dir);
      if (s.kind === 'boss') this.sfx.phase();
    }
    if (this.waveDelay > 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) this.startWave(this.wave + 1);
    } else if (!this.queue.length && !this.enemies.some((e) => !e.dead)) {
      this.waveDelay = 3;
      const bonus = this.wave * 250;
      this.score += bonus;
      if (this.wave % 5 !== 0) {
        this.banner = { text: `WELLE ${this.wave} GESCHAFFT`, sub: `Bonus +${bonus}`, t: 2.6, max: 2.6, color: '#9dffb0' };
        this.sfx.wave();
      }
      // kleine Heilung
      this.p.hp = Math.min(this.p.maxHp, this.p.hp + 8);
    }
  }

  private updateEnemies(dt: number) {
    const p = this.p;
    const f = this.diff.fire;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      switch (e.kind) {
        case 'scout': {
          e.y += e.vy * dt;
          e.x = clamp(e.baseX + Math.sin(e.t * 2.2) * 70, 16, W - 16);
          if (this.wave >= 3 && p.alive) {
            e.cd -= dt;
            if (e.cd <= 0 && e.y > 30 && e.y < H * 0.6) {
              e.cd = rand(2.5, 4.5) / f;
              this.eShoot(e.x, e.y + 10, this.aim(e.x, e.y), 210, 's');
            }
          }
          break;
        }
        case 'zig': {
          e.x += e.dir * e.vx * dt;
          if (e.x < 24) e.dir = 1;
          if (e.x > W - 24) e.dir = -1;
          e.y += e.vy * dt;
          if (this.wave >= 2 && p.alive) {
            e.cd -= dt;
            if (e.cd <= 0 && e.y > 30 && e.y < H * 0.65) {
              e.cd = rand(1.6, 2.6) / f;
              this.eShoot(e.x, e.y + 12, Math.PI / 2, 230, 's');
            }
          }
          break;
        }
        case 'tank': {
          e.y += e.vy * dt;
          e.x += Math.sin(e.t * 0.8) * 20 * dt;
          if (p.alive) {
            e.cd -= dt;
            if (e.cd <= 0 && e.y > 20 && e.y < H * 0.7) {
              e.cd = 2.1 / f;
              const a = this.aim(e.x, e.y);
              for (let k = -1; k <= 1; k++) this.eShoot(e.x, e.y + 14, a + k * 0.22, 200, 'b');
            }
          }
          break;
        }
        case 'kamikaze': {
          if (p.alive && e.y > 40) {
            const want = this.aim(e.x, e.y);
            let d = want - e.angle;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            e.angle += clamp(d, -2.3 * dt, 2.3 * dt);
          }
          e.x += Math.cos(e.angle) * e.vy * dt;
          e.y += Math.sin(e.angle) * e.vy * dt;
          if (e.t > 9) e.y = H + 100;
          if (this.parts.length < 700 && Math.random() < 0.6) {
            this.parts.push({
              x: e.x - Math.cos(e.angle) * 12,
              y: e.y - Math.sin(e.angle) * 12,
              vx: rand(-20, 20),
              vy: rand(-20, 20),
              life: 0.25,
              max: 0.25,
              size: 2.2,
              color: '#ff8c42',
              glow: true,
            });
          }
          break;
        }
        case 'shooter': {
          if (e.t < 12) {
            if (e.y < e.cd2) e.y += e.vy * dt;
            else {
              e.x += e.dir * e.vx * dt;
              if (e.x < 40) e.dir = 1;
              if (e.x > W - 40) e.dir = -1;
            }
          } else {
            e.y += 160 * dt;
          }
          if (p.alive && e.y >= e.cd2 - 5 && e.t < 12) {
            e.cd -= dt;
            if (e.cd <= 0) {
              e.cd = 2.2 / f;
              const a = this.aim(e.x, e.y);
              for (let k = -2; k <= 2; k++) this.eShoot(e.x, e.y + 14, a + k * 0.28, 185, 's', '#c77dff');
            }
          }
          break;
        }
        case 'boss':
          this.updateBoss(e, dt);
          break;
      }
      if (e.kind !== 'boss' && (e.y > H + 60 || e.x < -80 || e.x > W + 80)) e.dead = true;
    }
  }

  private updateBoss(e: Enemy, dt: number) {
    const b = e.bossType;
    const f = this.diff.fire;
    const p = this.p;
    if (!e.entered) {
      e.y += 70 * dt;
      if (e.y >= 110) {
        e.y = 110;
        e.entered = true;
        e.cd = 1;
      }
      return;
    }
    const hpf = e.hp / e.maxHp;
    const phase = hpf > 0.66 ? 0 : hpf > 0.33 ? 1 : 2;
    if (phase !== e.phase) {
      e.phase = phase;
      this.sfx.phase();
      this.shake = 14;
      this.rings.push({ x: e.x, y: e.y, r: 20, max: 300, life: 0.7, max_life: 0.7, color: '#ff4d6d', width: 6 });
      this.banner = { text: phase === 1 ? 'PHASE 2' : 'RASEREI!', sub: BOSS_NAMES[b], t: 1.6, max: 1.6, color: '#ff4d6d' };
      for (const bl of this.bullets) if (!bl.friendly) bl.dead = true;
    }
    const amp = W / 2 - e.r - 14;
    e.x = W / 2 + Math.sin(e.t * (0.55 + 0.22 * phase + 0.08 * b)) * amp;
    e.y = 110 + Math.sin(e.t * 1.3) * 12;
    if (!p.alive) return;

    const col = ['#c77dff', '#72efdd', '#ffa62b'][b];
    // Salven
    e.cd -= dt;
    if (e.cd <= 0) {
      if (phase < 2) {
        e.cd = (phase === 0 ? 1.5 : 1.9) / f;
        const n = 3 + b * 2 + phase * 2;
        const origins = b === 1 ? [-40, 0, 40] : [0];
        for (const ox of origins) {
          const a = this.aim(e.x + ox, e.y);
          for (let k = 0; k < n; k++) {
            this.eShoot(e.x + ox, e.y + e.r * 0.6, a + (k - (n - 1) / 2) * 0.17, 235, 's', col);
          }
        }
      } else {
        e.cd = 2.2 / f;
        const n = 14 + b * 4;
        const off = rand(0, Math.PI * 2);
        for (let k = 0; k < n; k++) this.eShoot(e.x, e.y + 10, off + (k / n) * Math.PI * 2, 170, 'b', col);
      }
    }
    // Spirale
    if (phase >= 1) {
      e.cd2 -= dt;
      if (e.cd2 <= 0) {
        e.cd2 = (phase === 1 ? 0.15 : 0.1) / f;
        e.angle += 0.33;
        this.eShoot(e.x, e.y + 10, e.angle, 160, 's', col);
        if (phase === 2 || b === 1) this.eShoot(e.x, e.y + 10, e.angle + Math.PI, 160, 's', col);
        if (b === 2 && phase === 2) {
          this.eShoot(e.x, e.y + 10, e.angle + Math.PI / 2, 160, 's', col);
          this.eShoot(e.x, e.y + 10, e.angle - Math.PI / 2, 160, 's', col);
        }
      }
    }
    // Verstärkung
    if (phase === 2) {
      e.cd3 -= dt;
      if (e.cd3 <= 0) {
        e.cd3 = 7;
        const k1 = this.spawnEnemy('kamikaze', e.x - 40);
        const k2 = this.spawnEnemy('kamikaze', e.x + 40);
        k1.y = e.y + 20;
        k2.y = e.y + 20;
      }
    }
  }

  private updateBullets(dt: number) {
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -30 || b.x > W + 30 || b.y < -40 || b.y > H + 30) b.dead = true;
    }
  }

  private collide() {
    const p = this.p;
    // Spieler-Schüsse gegen Gegner
    for (const b of this.bullets) {
      if (b.dead || !b.friendly) continue;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const rr = b.r + e.r;
        if (dx * dx + dy * dy < rr * rr) {
          b.dead = true;
          if (e.kind === 'boss' && !e.entered) {
            this.spark(b.x, b.y, '#ffffff', 2, 80);
          } else {
            this.spark(b.x, b.y, '#bff6ff', 3, 110);
            this.hitEnemy(e, b.dmg);
          }
          break;
        }
      }
    }
    if (!p.alive) return;
    // Gegner-Schüsse gegen Spieler
    for (const b of this.bullets) {
      if (b.dead || b.friendly) continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const rr = b.r + p.hit;
      if (dx * dx + dy * dy < rr * rr) {
        b.dead = true;
        this.hurt(b.dmg);
        if (!p.alive) return;
      }
    }
    // Gegner gegen Spieler
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const rr = e.r * 0.85 + p.hit;
      if (dx * dx + dy * dy < rr * rr) {
        if (this.hurt(25 * this.diff.dmg)) {
          if (e.kind !== 'boss') this.hitEnemy(e, 8);
          if (!p.alive) return;
        }
      }
    }
  }

  private updatePickups(dt: number) {
    const p = this.p;
    for (const k of this.pickups) {
      k.t += dt;
      k.y += 85 * dt;
      if (p.alive) {
        const dx = p.x - k.x;
        const dy = p.y - k.y;
        const d = Math.hypot(dx, dy);
        if (d < 110) {
          k.x += (dx / d) * 220 * dt;
          k.y += (dy / d) * 220 * dt;
        }
        if (d < 28) {
          this.collectPickup(k);
          k.y = H + 100;
        }
      }
    }
    this.pickups = this.pickups.filter((k) => k.y < H + 40);
  }

  private collectPickup(k: Pickup) {
    const p = this.p;
    this.sfx.pickup();
    this.spark(k.x, k.y, '#ffffff', 10, 140);
    this.rings.push({ x: k.x, y: k.y, r: 6, max: 40, life: 0.3, max_life: 0.3, color: '#ffffff', width: 2 });
    switch (k.kind) {
      case 'power':
        if (p.weapon < 5) {
          p.weapon++;
          this.floatText(p.x, p.y - 30, `WAFFE LV ${p.weapon}`, '#ffd166', 15);
        } else {
          this.score += 1000;
          this.floatText(p.x, p.y - 30, '+1000', '#ffd166', 15);
        }
        break;
      case 'shield':
        p.shield = Math.min(p.shield + 8, 14);
        this.floatText(p.x, p.y - 30, 'SCHILD', '#4cc9f0', 15);
        break;
      case 'health':
        p.hp = Math.min(p.maxHp, p.hp + 35);
        this.floatText(p.x, p.y - 30, '+35 HP', '#7CFC9a', 15);
        break;
      case 'bomb':
        if (p.bombs < 5) {
          p.bombs++;
          this.floatText(p.x, p.y - 30, '+1 BOMBE', '#ff6b6b', 15);
        } else {
          this.score += 500;
          this.floatText(p.x, p.y - 30, '+500', '#ff6b6b', 15);
        }
        break;
    }
  }

  private updateEffects(dt: number) {
    for (const q of this.parts) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 1 - 1.5 * dt;
      q.vy *= 1 - 1.5 * dt;
      q.life -= dt;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max_life;
      r.r = 6 + (r.max - 6) * (1 - Math.pow(1 - t, 2));
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) {
      t.y -= 34 * dt;
      t.life -= dt * 1.1;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  private render() {
    const g = this.ctx;
    g.save();
    g.clearRect(0, 0, W, H);

    // Hintergrund
    g.drawImage(this.nebula, 0, this.nebulaY - H);
    g.drawImage(this.nebula, 0, this.nebulaY);
    for (const s of this.stars) {
      const a = 0.35 + 0.65 * s.z * (0.75 + 0.25 * Math.sin(this.clock * 2 + s.tw));
      g.fillStyle = `rgba(200,220,255,${a})`;
      const sz = s.z * 2;
      g.fillRect(s.x, s.y, sz, sz * (1 + s.z * 2));
    }

    if (this.shake > 0) g.translate(rand(-1, 1) * this.shake * 0.5, rand(-1, 1) * this.shake * 0.5);

    if (this.state !== 'menu') {
      for (const k of this.pickups) this.drawPickup(k);
      for (const e of this.enemies) this.drawEnemy(e);
      if (this.p.alive) this.drawPlayer();
      this.drawBullets();
    }

    // Partikel (additiv)
    g.globalCompositeOperation = 'lighter';
    for (const q of this.parts) {
      const a = clamp(q.life / q.max, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = q.color;
      g.beginPath();
      g.arc(q.x, q.y, q.size * (0.4 + a * 0.6), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    for (const r of this.rings) {
      g.globalAlpha = clamp(r.life / r.max_life, 0, 1);
      g.strokeStyle = r.color;
      g.lineWidth = r.width * (r.life / r.max_life);
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    for (const t of this.texts) {
      g.globalAlpha = clamp(t.life, 0, 1);
      this.text(t.text, t.x, t.y, t.size, t.color, 'center', 700);
    }
    g.globalAlpha = 1;
    g.restore();

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,240,200,${this.flash * 0.7})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.p && this.p.alive && this.p.hp < 30 && this.state === 'playing') {
      const a = 0.12 + 0.1 * Math.sin(this.clock * 8);
      const rg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
      rg.addColorStop(0, 'rgba(255,0,40,0)');
      rg.addColorStop(1, `rgba(255,0,40,${a * 2})`);
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    }

    if (this.state === 'playing' || this.state === 'paused' || this.state === 'over') this.drawHud();
  }

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 600) {
    const g = this.ctx;
    g.font = `${weight} ${size}px Orbitron, "Segoe UI", system-ui, sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  private poly(pts: number[][], fill: string, stroke?: string, lw = 1.5) {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = lw;
      g.lineJoin = 'round';
      g.stroke();
    }
  }

  private circle(x: number, y: number, r: number, fill: string) {
    const g = this.ctx;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  }

  private drawPlayer() {
    const g = this.ctx;
    const p = this.p;
    if (p.invuln > 0 && p.shield <= 0 && Math.floor(this.clock * 16) % 2 === 0) return;
    g.save();
    g.translate(p.x, p.y);
    // Flamme
    const fl = 10 + Math.random() * 8;
    g.globalCompositeOperation = 'lighter';
    this.poly([[-5, 12], [5, 12], [0, 12 + fl]], 'rgba(255,170,60,0.9)');
    this.poly([[-2.5, 12], [2.5, 12], [0, 12 + fl * 0.6]], 'rgba(255,255,220,0.95)');
    g.globalCompositeOperation = 'source-over';
    // Flügel
    this.poly([[-7, -4], [-22, 14], [-22, 19], [-9, 13], [-5, 14]], '#3a86ff', '#9ad1ff');
    this.poly([[7, -4], [22, 14], [22, 19], [9, 13], [5, 14]], '#3a86ff', '#9ad1ff');
    // Rumpf
    this.poly([[0, -24], [6, -8], [8, 14], [0, 18], [-8, 14], [-6, -8]], '#eef4ff', '#7cc4ff');
    // Cockpit
    const cg = g.createLinearGradient(0, -14, 0, 2);
    cg.addColorStop(0, '#b8f3ff');
    cg.addColorStop(1, '#2a7fff');
    g.beginPath();
    g.ellipse(0, -6, 3.5, 7, 0, 0, Math.PI * 2);
    g.fillStyle = cg;
    g.fill();
    // Waffenstufe – Kanonen
    if (p.weapon >= 3) {
      this.circle(-14, 10, 2.5, '#ffd166');
      this.circle(14, 10, 2.5, '#ffd166');
    }
    if (p.weapon >= 5) {
      this.circle(-19, 14, 2.5, '#ff6b6b');
      this.circle(19, 14, 2.5, '#ff6b6b');
    }
    // Schild
    if (p.shield > 0) {
      const warn = p.shield < 2 && Math.floor(this.clock * 10) % 2 === 0;
      if (!warn) {
        const sg = g.createRadialGradient(0, 0, 14, 0, 0, 34);
        sg.addColorStop(0, 'rgba(76,201,240,0.05)');
        sg.addColorStop(1, 'rgba(76,201,240,0.45)');
        g.beginPath();
        g.arc(0, 0, 34, 0, Math.PI * 2);
        g.fillStyle = sg;
        g.fill();
        g.strokeStyle = 'rgba(160,230,255,0.9)';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    g.restore();
  }

  private drawBullets() {
    const g = this.ctx;
    // Spieler
    g.lineCap = 'round';
    for (const b of this.bullets) {
      if (b.dead || !b.friendly) continue;
      g.strokeStyle = b.color;
      g.lineWidth = 4;
      g.globalAlpha = 0.35;
      g.beginPath();
      g.moveTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    // Gegner
    for (const b of this.bullets) {
      if (b.dead || b.friendly) continue;
      g.globalAlpha = 0.3;
      this.circle(b.x, b.y, b.r * 2, b.color);
      g.globalAlpha = 1;
      this.circle(b.x, b.y, b.r, b.color);
      this.circle(b.x, b.y, b.r * 0.5, '#fff');
    }
  }

  private drawPickup(k: Pickup) {
    const g = this.ctx;
    const info = {
      power: { c: '#ffb703', l: 'P' },
      shield: { c: '#4cc9f0', l: 'S' },
      health: { c: '#52e07c', l: '+' },
      bomb: { c: '#ff5d73', l: 'B' },
    }[k.kind];
    const bob = Math.sin(k.t * 5) * 2;
    g.save();
    g.translate(k.x, k.y + bob);
    g.globalAlpha = 0.3 + 0.15 * Math.sin(k.t * 6);
    this.circle(0, 0, 22, info.c);
    g.globalAlpha = 1;
    this.circle(0, 0, 13, '#0b1030');
    g.beginPath();
    g.arc(0, 0, 13, 0, Math.PI * 2);
    g.strokeStyle = info.c;
    g.lineWidth = 2.5;
    g.stroke();
    this.text(info.l, 0, 1, 15, info.c, 'center', 800);
    g.restore();
  }

  private drawEnemy(e: Enemy) {
    const g = this.ctx;
    const fl = e.flash > 0;
    const F = (c: string) => (fl ? '#ffffff' : c);
    g.save();
    g.translate(e.x, e.y);
    const r = e.r;
    switch (e.kind) {
      case 'scout':
        this.poly([[0, r], [r, -r * 0.7], [r * 0.35, -r * 0.35], [0, -r * 0.7], [-r * 0.35, -r * 0.35], [-r, -r * 0.7]], F('#ff4d6d'), '#ffb3c1');
        this.circle(0, -2, 3.5, F('#ffe5ec'));
        break;
      case 'zig':
        this.poly([[0, r], [r, 0], [r * 0.5, -r], [0, -r * 0.4], [-r * 0.5, -r], [-r, 0]], F('#ffb703'), '#fff1b8');
        this.circle(0, -1, 4, F('#7a3e00'));
        break;
      case 'tank': {
        const pts: number[][] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        this.poly(pts, F('#6c7a93'), '#c3cee3', 2);
        this.poly([[-10, 6], [10, 6], [6, r + 4], [-6, r + 4]], F('#414b5e'), '#9aa7bf');
        this.circle(0, 0, 9, F('#2b1d2e'));
        this.circle(0, 0, 5 + Math.sin(this.clock * 6) * 1.2, F('#ff4d6d'));
        if (e.hp < e.maxHp) this.hpBar(e, -r - 10);
        break;
      }
      case 'kamikaze':
        g.rotate(e.angle - Math.PI / 2);
        this.poly([[0, r * 1.2], [r * 0.8, -r * 0.8], [0, -r * 0.3], [-r * 0.8, -r * 0.8]], F('#ff6b00'), '#ffd0a0');
        this.circle(0, 2, 3, F('#fff3b0'));
        break;
      case 'shooter': {
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fillStyle = F('#7b2cbf');
        g.fill();
        g.strokeStyle = '#e0aaff';
        g.lineWidth = 2;
        g.stroke();
        for (let i = -2; i <= 2; i++) {
          const a = Math.PI / 2 + i * 0.5;
          this.circle(Math.cos(a) * (r + 2), Math.sin(a) * (r + 2), 3, F('#e0aaff'));
        }
        this.circle(0, 0, 7, F('#240046'));
        this.circle(0, 0, 3.5, F('#ff9e00'));
        if (e.hp < e.maxHp) this.hpBar(e, -r - 10);
        break;
      }
      case 'boss':
        this.drawBoss(e, fl);
        break;
    }
    g.restore();
  }

  private hpBar(e: Enemy, y: number) {
    const w = e.r * 1.6;
    this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.ctx.fillRect(-w / 2, y, w, 4);
    this.ctx.fillStyle = '#ff4d6d';
    this.ctx.fillRect(-w / 2, y, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }

  private drawBoss(e: Enemy, fl: boolean) {
    const g = this.ctx;
    const F = (c: string) => (fl ? '#ffffff' : c);
    const r = e.r;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * (4 + e.phase * 3));
    const rage = e.phase === 2;
    if (!e.entered) g.globalAlpha = 0.8;
    if (e.bossType === 0) {
      // Wächter
      this.poly([[-r, -10], [-r * 0.5, -r * 0.8], [r * 0.5, -r * 0.8], [r, -10], [r * 0.7, r * 0.7], [0, r], [-r * 0.7, r * 0.7]], F('#5a189a'), '#c77dff', 3);
      this.poly([[-r * 1.2, -r * 0.2], [-r, -10], [-r * 0.7, r * 0.7], [-r * 1.1, r * 0.5]], F('#3c096c'), '#9d4edd', 2);
      this.poly([[r * 1.2, -r * 0.2], [r, -10], [r * 0.7, r * 0.7], [r * 1.1, r * 0.5]], F('#3c096c'), '#9d4edd', 2);
      this.circle(-r * 0.6, r * 0.55, 6, F('#10002b'));
      this.circle(r * 0.6, r * 0.55, 6, F('#10002b'));
      this.circle(0, 0, r * 0.38, F('#10002b'));
      this.circle(0, 0, r * 0.26 + pulse * 3, F(rage ? '#ff2e63' : '#e0aaff'));
    } else if (e.bossType === 1) {
      // Hydra
      this.poly([[-r, 0], [-r * 0.6, -r * 0.6], [r * 0.6, -r * 0.6], [r, 0], [r * 0.6, r * 0.5], [-r * 0.6, r * 0.5]], F('#0b6e6e'), '#72efdd', 3);
      for (const ox of [-40, 0, 40]) {
        this.poly([[ox - 12, r * 0.3], [ox + 12, r * 0.3], [ox + 8, r * 0.9], [ox - 8, r * 0.9]], F('#0a4d4d'), '#72efdd', 2);
        this.circle(ox, r * 0.85, 5, F('#002b2b'));
        this.circle(ox, r * 0.85, 2.5 + pulse * 2, F(rage ? '#ff2e63' : '#b8fff2'));
      }
      this.circle(0, -4, r * 0.3, F('#002b2b'));
      this.circle(0, -4, r * 0.18 + pulse * 3, F(rage ? '#ff2e63' : '#72efdd'));
    } else {
      // Dreadnought
      this.poly([[-r * 1.3, r * 0.2], [-r * 0.9, -r * 0.7], [-r * 0.3, -r * 0.9], [r * 0.3, -r * 0.9], [r * 0.9, -r * 0.7], [r * 1.3, r * 0.2], [r * 0.8, r * 0.8], [0, r * 0.6], [-r * 0.8, r * 0.8]], F('#6b4a1e'), '#ffa62b', 3);
      this.poly([[-r * 0.5, -r * 0.5], [r * 0.5, -r * 0.5], [r * 0.35, r * 0.35], [-r * 0.35, r * 0.35]], F('#3d2a10'), '#d98a1f', 2);
      for (const ox of [-r * 0.95, r * 0.95]) {
        this.circle(ox, r * 0.35, 9, F('#2a1a08'));
        this.circle(ox, r * 0.35, 4.5 + pulse * 2, F(rage ? '#ff2e63' : '#ffd166'));
      }
      this.circle(0, -2, r * 0.3, F('#1b1005'));
      this.circle(0, -2, r * 0.2 + pulse * 3, F(rage ? '#ff2e63' : '#ff9f1c'));
    }
    g.globalAlpha = 1;
  }

  private drawHud() {
    const g = this.ctx;
    const p = this.p;

    // Punkte
    this.text('PUNKTE', 14, 18, 10, '#7f8fb5', 'left', 600);
    this.text(this.score.toLocaleString('de-DE'), 14, 36, 20, '#ffffff', 'left', 800);
    this.text(`REKORD ${Math.max(this.best, this.score).toLocaleString('de-DE')}`, 14, 56, 10, '#ffd166', 'left', 600);
    // Welle
    this.text(`WELLE ${Math.max(this.wave, 1)}`, W / 2, 20, 13, '#4cc9f0', 'center', 800);
    if (this.wave % 5 === 4 || this.bossRef) {
      this.text(this.bossRef ? BOSS_NAMES[this.bossRef.bossType] : 'BOSS VORAUS', W / 2, 38, 10, '#ff4d6d', 'center', 700);
    }
    // Kombo
    if (this.combo >= 3) {
      const m = this.mult();
      const s = 1 + Math.min(0.25, this.comboT * 0.05);
      this.text(`${this.combo} KOMBO`, 14, 78, 12 * s, m > 1 ? '#ffd166' : '#9fb4e0', 'left', 800);
      if (m > 1) this.text(`x${m}`, 14 + 88, 78, 14, '#ffd166', 'left', 800);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(14, 88, 70, 3);
      g.fillStyle = '#ffd166';
      g.fillRect(14, 88, 70 * clamp(this.comboT / 2.6, 0, 1), 3);
    }

    // Bossleiste
    const boss = this.bossRef;
    if (boss && !boss.dead) {
      const bw = W - 120;
      const bx = 60;
      const by = 52;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(bx - 2, by - 2, bw + 4, 12);
      g.fillStyle = '#3a0d1a';
      g.fillRect(bx, by, bw, 8);
      const hg = g.createLinearGradient(bx, 0, bx + bw, 0);
      hg.addColorStop(0, '#ff4d6d');
      hg.addColorStop(1, '#ff9e00');
      g.fillStyle = hg;
      g.fillRect(bx, by, bw * clamp(boss.hp / boss.maxHp, 0, 1), 8);
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillRect(bx + bw * 0.33, by, 1, 8);
      g.fillRect(bx + bw * 0.66, by, 1, 8);
    }

    // Lebensleiste
    const hx = 14;
    const hy = H - 28;
    this.text('HÜLLE', hx, hy - 12, 9, '#7f8fb5', 'left', 700);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(hx - 2, hy - 2, 152, 14);
    g.fillStyle = '#1a2a24';
    g.fillRect(hx, hy, 148, 10);
    const hf = clamp(p.hp / p.maxHp, 0, 1);
    g.fillStyle = hf > 0.5 ? '#52e07c' : hf > 0.25 ? '#ffb703' : '#ff4d6d';
    g.fillRect(hx, hy, 148 * hf, 10);
    if (p.shield > 0) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(hx - 2, hy - 18, 152, 8);
      g.fillStyle = '#4cc9f0';
      g.fillRect(hx, hy - 16, 148 * clamp(p.shield / 14, 0, 1), 4);
    }
    // Waffenstufe
    this.text('WAFFE', 180, hy - 12, 9, '#7f8fb5', 'left', 700);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i < p.weapon ? '#ffd166' : 'rgba(255,255,255,0.15)';
      g.fillRect(180 + i * 15, hy, 12, 10);
    }
    // Bomben
    this.text('BOMBEN', W - 14, hy - 12, 9, '#7f8fb5', 'right', 700);
    for (let i = 0; i < 5; i++) {
      const bx = W - 22 - i * 20;
      g.globalAlpha = i < p.bombs ? 1 : 0.2;
      this.circle(bx, hy + 5, 7, '#ff5d73');
      this.circle(bx, hy + 5, 3, '#ffd6dc');
      g.globalAlpha = 1;
    }

    // Banner
    if (this.banner) {
      const b = this.banner;
      const t = b.max - b.t;
      const a = clamp(Math.min(t / 0.3, b.t / 0.4), 0, 1);
      g.globalAlpha = a;
      const pulse = b.text === 'WARNUNG' ? 0.6 + 0.4 * Math.abs(Math.sin(this.clock * 8)) : 1;
      g.globalAlpha = a * pulse;
      this.text(b.text, W / 2, H * 0.36, 34, b.color, 'center', 900);
      this.text(b.sub, W / 2, H * 0.36 + 34, 14, '#e6eeff', 'center', 600);
      g.globalAlpha = 1;
    }
  }
}
