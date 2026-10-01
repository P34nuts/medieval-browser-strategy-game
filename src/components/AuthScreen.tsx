"use client";
/** Login / Registrierung */
import { useState, type FormEvent } from "react";
import { api, tokenStore } from "@/lib/client-api";

export default function AuthScreen({ onAuth }: { onAuth: (username: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ token: string; username: string }>(`/api/auth/${mode}`, { method: "POST", body: { username, password } });
    setBusy(false);
    if (!res.ok) { setError(res.data.error ?? "Anmeldung fehlgeschlagen."); return; }
    tokenStore.set(res.data.token);
    onAuth(res.data.username);
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,#2e6a3c,#14301f_70%)]">
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-8">
        <div className="mb-6 text-center">
          <div className="text-6xl">🏰</div>
          <h1 className="font-display mt-2 text-5xl font-bold text-amber-200 drop-shadow">Burgfried</h1>
          <p className="mt-1 text-amber-100/80">Vom kleinen Weiler zur großen Stadt</p>
        </div>
        <form onSubmit={submit} className="wood space-y-3 rounded-2xl p-5">
          <div className="grid grid-cols-2 gap-2">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={`btn h-12 ${mode === m ? "btn-primary" : ""}`}
              >
                {m === "login" ? "Anmelden" : "Registrieren"}
              </button>
            ))}
          </div>
          <label className="block text-sm font-semibold text-amber-200">
            Benutzername
            <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={24} />
          </label>
          <label className="block text-sm font-semibold text-amber-200">
            Passwort
            <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={6} maxLength={100} />
          </label>
          {error && <p className="rounded-lg bg-red-900/70 px-3 py-2 text-sm text-red-100">{error}</p>}
          <button type="submit" className="btn btn-primary h-12 w-full text-base" disabled={busy}>
            {busy ? "Bitte warten …" : mode === "login" ? "Spiel betreten" : "Account erstellen & starten"}
          </button>
          <p className="text-center text-xs text-amber-100/60">Dein Fortschritt wird in deinem Account gespeichert.</p>
        </form>
      </div>
    </div>
  );
}
