export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 1;

export type PlayerKind = "human" | "computer";

export interface GamePlayer {
  id: number;
  name: string;
  kind: PlayerKind;
  color: string;
  population: number;
  military: number;
  score: number;
  aiTime: number;
}

const PLAYER_COLORS = ["#e0b34a", "#d9603a", "#6fbf5a", "#6ea8de", "#b780d8", "#d58aaf", "#62c2bb", "#c4c8d4"];

export function createPlayers(count = 2): GamePlayer[] {
  const safeCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(Number(count) || 2)));
  return Array.from({ length: safeCount }, (_, id) => ({
    id,
    name: id === 0 ? "Dein Reich" : `Computer ${id}`,
    kind: id === 0 ? "human" : "computer",
    color: PLAYER_COLORS[id],
    population: id === 0 ? 8 : 5,
    military: 0,
    score: id === 0 ? 0 : 10,
    aiTime: 0,
  }));
}

/** Kleine, deterministische Computergegner-Simulation für den lokalen Spielmodus. */
export function advanceComputerPlayers(players: GamePlayer[], dt: number) {
  for (const player of players) {
    if (player.kind !== "computer") continue;
    player.aiTime += Math.max(0, dt);
    while (player.aiTime >= 10) {
      player.aiTime -= 10;
      player.population = Math.min(120, player.population + 1);
      player.score += 2;
      if (player.population >= 20 && player.score % 20 === 0) player.military += 1;
    }
  }
}

export function normalizePlayers(value: unknown): GamePlayer[] {
  if (!Array.isArray(value)) return createPlayers(2);
  const valid = value.slice(0, MAX_PLAYERS).filter((item): item is Partial<GamePlayer> => Boolean(item && typeof item === "object"));
  if (!valid.length) return createPlayers(2);
  return valid.map((item, id) => ({
    id,
    name: typeof item.name === "string" && item.name.trim() ? item.name.slice(0, 40) : id === 0 ? "Dein Reich" : `Computer ${id}`,
    kind: item.kind === "human" ? "human" : "computer",
    color: typeof item.color === "string" ? item.color : PLAYER_COLORS[id],
    population: Number.isFinite(item.population) ? Math.max(0, Math.floor(item.population as number)) : id === 0 ? 8 : 5,
    military: Number.isFinite(item.military) ? Math.max(0, Math.floor(item.military as number)) : 0,
    score: Number.isFinite(item.score) ? Math.max(0, Math.floor(item.score as number)) : 0,
    aiTime: Number.isFinite(item.aiTime) ? Math.max(0, Number(item.aiTime)) : 0,
  }));
}
