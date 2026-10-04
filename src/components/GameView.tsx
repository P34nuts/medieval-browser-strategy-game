"use client";
/** GameView – verbindet Engine, Renderer und HUD; Android speichert lokal. */
import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine, type SaveData } from "@/game/engine";
import { GameRenderer } from "@/game/renderer";
import { api } from "@/lib/client-api";
import { isOfflineApp, readOfflineSave, writeOfflineSave } from "@/lib/offline";
import { type GameCtx, type Panel } from "./hud/common";
import TopBar from "./hud/TopBar";
import { BuildMenu, QuestPanel } from "./hud/SidePanels";
import { BottomBar, BuildHint, Inspector, Toasts, ZoomButtons } from "./hud/BottomUi";
import { EconomyModal, MenuModal, PopulationModal, ResearchModal, TradeModal } from "./hud/Modals";

const randomSeed = () => Math.floor(Math.random() * 2_000_000_000) + 1;
function createEngine(save: SaveData | null): GameEngine {
  if (save) { try { return GameEngine.load(save); } catch (err) { console.error("Spielstand defekt, starte neues Spiel", err); } }
  return GameEngine.newGame(randomSeed());
}

export default function GameView({ username, initialSave, onLogout }: { username: string; initialSave: SaveData | null; onLogout: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const [engine, setEngine] = useState<GameEngine>(() => createEngine(initialSave));
  const engineRef = useRef(engine);
  const [panel, setPanelState] = useState<Panel>(null);
  const [saveInfo, setSaveInfo] = useState(initialSave ? "Spielstand geladen." : "Noch nicht gespeichert.");
  const [renderer, setRenderer] = useState<GameRenderer | null>(null);

  useEffect(() => { const r = new GameRenderer(canvasRef.current!, engineRef.current); rendererRef.current = r; r.start(); r.centerOnTile(32, 34); setRenderer(r); return () => { r.stop(); rendererRef.current = null; }; }, []);
  useEffect(() => { engineRef.current = engine; rendererRef.current?.setEngine(engine); }, [engine]);
  const setPanel = useCallback((p: Panel) => { setPanelState(p); if (p) engineRef.current.setBuildType(null); }, []);

  const save = useCallback(async () => {
    setSaveInfo("Speichere …");
    if (isOfflineApp()) { writeOfflineSave(engineRef.current.serialize()); setSaveInfo(`Lokal gespeichert um ${new Date().toLocaleTimeString("de-DE")}.`); engineRef.current.toast("Spiel lokal gespeichert", "good"); return; }
    const res = await api("/api/save", { method: "PUT", body: engineRef.current.serialize() });
    if (res.ok) { setSaveInfo(`Gespeichert um ${new Date().toLocaleTimeString("de-DE")}.`); engineRef.current.toast("Spiel gespeichert", "good"); }
    else { setSaveInfo(`Speichern fehlgeschlagen: ${res.data.error ?? res.status}`); engineRef.current.toast("Speichern fehlgeschlagen", "warn"); }
  }, []);

  const load = useCallback(async () => {
    if (isOfflineApp()) { const saved = readOfflineSave<SaveData>(); if (!saved) { setSaveInfo("Kein lokaler Spielstand vorhanden."); return; } const e = createEngine(saved); setEngine(e); setPanelState(null); setSaveInfo("Spielstand geladen."); e.toast("Spielstand geladen", "good"); return; }
    const res = await api<{ save: SaveData | null }>("/api/save");
    if (!res.ok) { setSaveInfo(`Laden fehlgeschlagen: ${res.data.error ?? res.status}`); return; }
    if (!res.data.save) { setSaveInfo("Kein Spielstand vorhanden."); return; }
    const e = createEngine(res.data.save); setEngine(e); setPanelState(null); setSaveInfo("Spielstand geladen."); e.toast("Spielstand geladen", "good");
  }, []);

  const newGame = useCallback((playerCount = 2) => { const e = GameEngine.newGame(randomSeed(), playerCount); setEngine(e); setPanelState(null); setSaveInfo("Neue Karte erstellt (noch nicht gespeichert)."); e.toast("Neue Karte generiert", "info"); }, []);
  const logout = useCallback(async () => { await save(); onLogout(); }, [save, onLogout]);

  useEffect(() => {
    const iv = setInterval(() => { if (isOfflineApp()) writeOfflineSave(engineRef.current.serialize()); else void api("/api/save", { method: "PUT", body: engineRef.current.serialize() }).then((r) => { if (r.ok) setSaveInfo(`Automatisch gespeichert um ${new Date().toLocaleTimeString("de-DE")}.`); }); }, 60_000);
    const flush = () => { if (document.visibilityState === "hidden" || isOfflineApp()) { if (isOfflineApp()) writeOfflineSave(engineRef.current.serialize()); else void api("/api/save", { method: "PUT", body: engineRef.current.serialize(), keepalive: true }); } };
    document.addEventListener("visibilitychange", flush); window.addEventListener("pagehide", flush);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", flush); };
  }, []);

  const g: GameCtx = { engine, renderer, panel, setPanel, username, saveInfo, save, load, newGame, logout };
  return <div className="fixed inset-0 select-none overflow-hidden bg-[#17425f]"><canvas ref={canvasRef} className="absolute inset-0 h-full w-full" /><TopBar g={g} /><BuildMenu g={g} /><QuestPanel g={g} /><ZoomButtons g={g} /><BuildHint g={g} /><Inspector g={g} /><Toasts g={g} /><BottomBar g={g} />{panel === "economy" && <EconomyModal g={g} />}{panel === "population" && <PopulationModal g={g} />}{panel === "research" && <ResearchModal g={g} />}{panel === "trade" && <TradeModal g={g} />}{panel === "menu" && <MenuModal g={g} />}</div>;
}
