"use client";
/** Lädt das Spiel ausschließlich im Browser (Canvas/localStorage) – kein SSR nötig. */
import dynamic from "next/dynamic";

const GameRoot = dynamic(() => import("./GameRoot"), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#14301f]" />,
});

export default function GameLoader() {
  return <GameRoot />;
}
