import { useCallback, useEffect, useRef, useState } from 'react';
import { DIFFICULTIES, Game, H, W } from './game/engine';
import type { Difficulty, GameOverInfo, GameState } from './game/engine';

const DIFF_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
const DIFF_DESC: Record<Difficulty, string> = {
  easy: 'Weniger Gegner-HP, langsamere Schüsse',
  normal: 'Die ausgewogene Erfahrung',
  hard: 'Zähe Gegner, dichtes Feuer, 1,6× Punkte',
};

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-[0_2px_0_rgba(255,255,255,0.15)]">
      {children}
    </kbd>
  );
}

function PowerLegend() {
  const items = [
    { l: 'P', c: '#ffb703', t: 'Waffen-Upgrade (bis Stufe 5)' },
    { l: 'S', c: '#4cc9f0', t: 'Schild – absorbiert Treffer' },
    { l: '+', c: '#52e07c', t: 'Reparatur +35 HP' },
    { l: 'B', c: '#ff5d73', t: 'Bombe – löscht den Bildschirm' },
  ];
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.l} className="flex items-center gap-3 text-sm text-slate-300">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-[#0b1030] text-xs font-extrabold"
            style={{ borderColor: i.c, color: i.c, boxShadow: `0 0 12px ${i.c}55` }}
          >
            {i.l}
          </span>
          {i.t}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [state, setState] = useState<GameState>('menu');
  const [over, setOver] = useState<GameOverInfo | null>(null);
  const [diff, setDiff] = useState<Difficulty>(() => {
    try {
      const d = localStorage.getItem('novastrike.diff');
      if (d === 'easy' || d === 'normal' || d === 'hard') return d;
    } catch {
      /* ignore */
    }
    return 'normal';
  });
  const [muted, setMuted] = useState(false);
  const [best, setBest] = useState(0);
  const [size, setSize] = useState({ w: W, h: H });
  const diffRef = useRef(diff);
  const stateRef = useRef(state);
  diffRef.current = diff;
  stateRef.current = state;

  // Spiel-Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(canvas, {
      onState: (s) => {
        setState(s);
        setBest(game.best);
      },
      onGameOver: (info) => setOver(info),
      onMute: setMuted,
    });
    gameRef.current = game;
    setBest(game.best);
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  // Skalierung
  useEffect(() => {
    const fit = () => {
      const availW = window.innerWidth;
      const availH = window.innerHeight;
      const s = Math.min(availW / W, availH / H);
      setSize({ w: Math.floor(W * s), h: Math.floor(H * s) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const start = useCallback(() => {
    try {
      localStorage.setItem('novastrike.diff', diffRef.current);
    } catch {
      /* ignore */
    }
    setOver(null);
    gameRef.current?.start(diffRef.current);
  }, []);

  // Enter startet / wiederholt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' || e.repeat) return;
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      if (stateRef.current === 'menu' || stateRef.current === 'over') start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const btnPrimary =
    'rounded-xl bg-gradient-to-b from-cyan-300 to-sky-500 px-8 py-3 text-base font-extrabold uppercase tracking-widest text-slate-950 shadow-[0_0_28px_rgba(76,201,240,0.45)] transition hover:brightness-110 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white';
  const btnGhost =
    'rounded-xl border border-white/20 bg-white/5 px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-200 transition hover:bg-white/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white';

  return (
    <div className="relative flex h-dvh w-full select-none items-center justify-center overflow-hidden bg-[#03030d] font-['Orbitron','Segoe_UI',system-ui,sans-serif] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(76,80,220,0.18),transparent_65%)]" />

      {/* linke Seitenleiste */}
      <aside className="relative z-10 mr-8 hidden w-64 shrink-0 space-y-6 xl:block">
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Steuerung</h2>
          <div className="space-y-2.5 text-sm text-slate-300">
            <div className="flex items-center gap-2">
              <Key>W</Key>
              <Key>A</Key>
              <Key>S</Key>
              <Key>D</Key>
              <span className="text-slate-500">/</span>
              <Key>←</Key>
              <Key>↑</Key>
              <Key>↓</Key>
              <Key>→</Key>
            </div>
            <p>Fliegen – Feuer ist automatisch</p>
            <div className="flex items-center gap-2">
              <Key>Leertaste</Key>
              <Key>B</Key>
            </div>
            <p>Bombe zünden</p>
            <div className="flex items-center gap-2">
              <Key>P</Key>
              <Key>Esc</Key>
              <Key>M</Key>
            </div>
            <p>Pause / Ton an-aus</p>
            <p className="text-slate-500">Maus oder Touch: ziehen, um das Schiff zu bewegen.</p>
          </div>
        </div>
      </aside>

      {/* Spielfeld */}
      <div
        className="relative z-10 overflow-hidden bg-black shadow-[0_0_80px_rgba(76,80,220,0.35)] ring-1 ring-white/10 sm:rounded-2xl"
        style={{ width: size.w, height: size.h }}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />

        {/* HUD-Buttons */}
        {(state === 'playing' || state === 'paused') && (
          <div className="absolute right-2 top-2 flex gap-2">
            <button
              aria-label={muted ? 'Ton einschalten' : 'Ton ausschalten'}
              onClick={() => gameRef.current?.toggleMute()}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-black/40 text-base backdrop-blur transition hover:bg-white/15"
            >
              {muted ? '🔇' : '🔊'}
            </button>
            <button
              aria-label="Pause"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                gameRef.current?.togglePause();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-black/40 text-sm font-bold backdrop-blur transition hover:bg-white/15"
            >
              {state === 'paused' ? '▶' : '❚❚'}
            </button>
          </div>
        )}
        {state === 'playing' && (
          <button
            aria-label="Bombe"
            onPointerDown={(e) => {
              e.preventDefault();
              gameRef.current?.bomb();
            }}
            className="absolute bottom-14 right-3 hidden h-16 w-16 items-center justify-center rounded-full border-2 border-rose-400/70 bg-rose-500/25 text-2xl shadow-[0_0_20px_rgba(255,93,115,0.4)] backdrop-blur active:scale-90 [@media(pointer:coarse)]:flex"
          >
            💥
          </button>
        )}

        {/* Menü */}
        {state === 'menu' && (
          <div className="absolute inset-0 flex animate-[fade_0.5s_ease] flex-col items-center justify-center gap-5 bg-gradient-to-b from-[#05051a]/70 via-[#05051a]/40 to-[#05051a]/80 px-5 text-center">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.5em] text-cyan-300/80 sm:text-xs">Weltraum-Arcade</p>
              <h1
                className="bg-gradient-to-b from-white via-cyan-200 to-indigo-400 bg-clip-text text-5xl font-black leading-none tracking-tight text-transparent sm:text-6xl"
                style={{ filter: 'drop-shadow(0 0 18px rgba(76,201,240,0.55))' }}
              >
                NOVA
                <br />
                STRIKE
              </h1>
            </div>

            <p className="max-w-xs text-xs leading-relaxed text-slate-300 sm:text-sm">
              Verteidige die Galaxie gegen endlose Angriffswellen. Sammle Upgrades, baue Kombos auf und besiege die Bosse.
            </p>

            <div className="w-full max-w-xs">
              <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-black/40 p-1 ring-1 ring-white/10">
                {DIFF_ORDER.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDiff(d)}
                    className={`rounded-lg px-2 py-2 text-xs font-bold uppercase tracking-wider transition ${
                      diff === d ? 'bg-cyan-400 text-slate-950 shadow-[0_0_16px_rgba(76,201,240,0.6)]' : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {DIFFICULTIES[d].label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{DIFF_DESC[diff]}</p>
            </div>

            <button onClick={start} className={btnPrimary} autoFocus>
              Mission starten
            </button>

            <div className="text-[11px] text-slate-400">
              {best > 0 ? (
                <span>
                  Rekord: <span className="font-bold text-amber-300">{best.toLocaleString('de-DE')}</span>
                </span>
              ) : (
                <span>Noch kein Rekord – leg los!</span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 [@media(pointer:fine)]:hidden">Ziehe den Finger, um zu fliegen · 💥 zündet eine Bombe</p>
            <p className="hidden text-[10px] text-slate-500 [@media(pointer:fine)]:block xl:hidden">
              WASD/Pfeile: fliegen · Leertaste: Bombe · P: Pause · M: Ton
            </p>
          </div>
        )}

        {/* Pause */}
        {state === 'paused' && (
          <div className="absolute inset-0 flex animate-[fade_0.25s_ease] flex-col items-center justify-center gap-5 bg-[#03030d]/75 px-5 text-center backdrop-blur-sm">
            <h2 className="text-4xl font-black tracking-widest text-white">PAUSE</h2>
            <div className="flex flex-col gap-3">
              <button onClick={() => gameRef.current?.resume()} className={btnPrimary} autoFocus>
                Weiter
              </button>
              <button onClick={() => gameRef.current?.toMenu()} className={btnGhost}>
                Hauptmenü
              </button>
            </div>
            <div className="mt-2 rounded-xl border border-white/10 bg-black/30 p-4 text-left">
              <PowerLegend />
            </div>
          </div>
        )}

        {/* Game Over */}
        {state === 'over' && over && (
          <div className="absolute inset-0 flex animate-[fade_0.6s_ease] flex-col items-center justify-center gap-4 bg-[#10030a]/80 px-5 text-center backdrop-blur-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-rose-300/80 sm:text-xs">Schiff zerstört</p>
            <h2 className="text-4xl font-black tracking-wider text-rose-400 sm:text-5xl" style={{ textShadow: '0 0 24px rgba(255,77,109,0.6)' }}>
              MISSION
              <br />
              BEENDET
            </h2>

            {over.isRecord && (
              <div className="animate-pulse rounded-full bg-amber-300 px-4 py-1 text-xs font-black uppercase tracking-widest text-slate-900 shadow-[0_0_24px_rgba(252,211,77,0.6)]">
                ★ Neuer Rekord ★
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase tracking-widest text-slate-400">Punkte</div>
              <div className="text-4xl font-black text-white">{over.score.toLocaleString('de-DE')}</div>
              {!over.isRecord && (
                <div className="mt-1 text-xs text-slate-400">Rekord: {over.best.toLocaleString('de-DE')}</div>
              )}
            </div>

            <div className="grid w-full max-w-xs grid-cols-2 gap-2 text-left">
              {[
                ['Welle', over.wave],
                ['Abschüsse', over.kills],
                ['Bosse', over.bosses],
                ['Flugzeit', fmtTime(over.time)],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400">{k}</div>
                  <div className="text-lg font-bold">{v}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">Schwierigkeit: {DIFFICULTIES[over.difficulty].label}</p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button onClick={start} className={btnPrimary} autoFocus>
                Nochmal
              </button>
              <button onClick={() => gameRef.current?.toMenu()} className={btnGhost}>
                Hauptmenü
              </button>
            </div>
          </div>
        )}
      </div>

      {/* rechte Seitenleiste */}
      <aside className="relative z-10 ml-8 hidden w-64 shrink-0 space-y-6 xl:block">
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Power-ups</h2>
          <PowerLegend />
        </div>
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Tipps</h2>
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-slate-400">
            <li>Jeder fünfte Level ist ein Bosskampf.</li>
            <li>Ein Treffer kostet eine Waffenstufe.</li>
            <li>Kombos ohne Treffer erhöhen den Punkte-Multiplikator bis ×6.</li>
            <li>Bomben löschen alle gegnerischen Schüsse.</li>
          </ul>
        </div>
        <div className="text-sm text-slate-400">
          Rekord: <span className="font-bold text-amber-300">{best.toLocaleString('de-DE')}</span>
        </div>
      </aside>
    </div>
  );
}
