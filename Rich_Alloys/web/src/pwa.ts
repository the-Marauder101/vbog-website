// Installable app: the service worker (offline shell) and the "Install" prompt.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;
const listeners = new Set<() => void>();

export function startPwa() {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => { /* the site still works without it */ }); });
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BIP; listeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); });
}
export const onInstallChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const canPrompt = () => deferred !== null;
export async function promptInstall() { if (!deferred) return; await deferred.prompt(); await deferred.userChoice; deferred = null; listeners.forEach((f) => f()); }
export const isInstalled = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
