/** Erkennung und lokaler Spielstand für die vollständig offline laufende Android-App. */

const SAVE_KEY = "burgfried_offline_save_v1";

declare global {
  interface Window {
    __BURGFRIED_OFFLINE__?: boolean;
  }
}

export function isOfflineApp(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.__BURGFRIED_OFFLINE__ ||
    window.location.protocol === "capacitor:" ||
    /;\s*wv\)/i.test(window.navigator.userAgent),
  );
}

export function readOfflineSave<T>(): T | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeOfflineSave(value: unknown): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(value));
  } catch {
    // Ein voller oder deaktivierter Speicher darf das Spiel nicht stoppen.
  }
}
