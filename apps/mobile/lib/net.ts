/**
 * Connectivity state derived from API calls (no NetInfo module is installed): a network-level fetch failure
 * marks the app offline, any HTTP response marks it online. While offline a light probe of /health runs
 * every 15 s so the banner clears by itself. FR-APP-6: every action requires the network.
 */
type Listener = (online: boolean) => void;

let online = true;
const listeners = new Set<Listener>();
let probe: ReturnType<typeof setInterval> | null = null;
let prober: (() => Promise<boolean>) | null = null;

export function isOnline() {
  return online;
}

export function setOnline(v: boolean) {
  if (v === online) return;
  online = v;
  listeners.forEach((l) => l(v));
  if (!v && !probe && prober) {
    probe = setInterval(() => {
      void prober?.().then((ok) => ok && setOnline(true));
    }, 15000);
  }
  if (v && probe) {
    clearInterval(probe);
    probe = null;
  }
}

export function onOnlineChange(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function setProbe(fn: () => Promise<boolean>) {
  prober = fn;
}
