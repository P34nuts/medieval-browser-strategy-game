"use client";
/** Wurzel: Offline-App startet direkt; Web-Version prüft Anmeldung. */
import { useCallback, useEffect, useState } from "react";
import type { SaveData } from "@/game/engine";
import { api, tokenStore } from "@/lib/client-api";
import { isOfflineApp, readOfflineSave } from "@/lib/offline";
import AuthScreen from "./AuthScreen";
import GameView from "./GameView";

type State = { kind: "loading" } | { kind: "auth" } | { kind: "game"; username: string; save: SaveData | null; key: number };

export default function GameRoot() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const enter = useCallback(async (username: string) => {
    if (isOfflineApp()) {
      setState({ kind: "game", username: "Spieler", save: readOfflineSave<SaveData>(), key: Date.now() });
      return;
    }
    const res = await api<{ save: SaveData | null }>("/api/save");
    setState({ kind: "game", username, save: res.ok ? (res.data.save ?? null) : null, key: Date.now() });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isOfflineApp()) { await enter("Spieler"); return; }
      if (!tokenStore.get()) { setState({ kind: "auth" }); return; }
      const me = await api<{ username: string }>("/api/auth/me");
      if (!alive) return;
      if (me.ok) await enter(me.data.username);
      else { if (me.status === 401) tokenStore.clear(); setState({ kind: "auth" }); }
    })();
    return () => { alive = false; };
  }, [enter]);

  const logout = useCallback(async () => {
    if (!isOfflineApp()) {
      await api("/api/auth/logout", { method: "POST" });
      tokenStore.clear();
    }
    setState({ kind: "auth" });
  }, []);

  if (state.kind === "loading") {
    return <div className="fixed inset-0 grid place-items-center bg-[#14301f] text-amber-200"><div className="text-center"><div className="animate-pulse text-6xl">🏰</div><p className="font-display mt-3 text-xl">Burgfried wird geladen …</p></div></div>;
  }
  if (state.kind === "auth") return <AuthScreen onAuth={(u) => void enter(u)} />;
  return <GameView key={state.key} username={state.username} initialSave={state.save} onLogout={() => void logout()} />;
}
