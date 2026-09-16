export type GeoPoint = {
  lat: number;
  lng: number;
  t: number;
  acc?: number;
};

export type Trip = {
  id: string;
  deviceId: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  distanceM: number;
  points: GeoPoint[];
  startPoint: GeoPoint | null;
  endPoint: GeoPoint | null;
  /** distância em linha reta da base até o ponto final */
  baseToEndM: number | null;
  leftBase: boolean;
  returnedToBase: boolean;
  pendingSync: boolean;
};

export type BaseLocation = {
  lat: number;
  lng: number;
  label: string;
  radiusM: number;
  savedAt: number;
};

const K = {
  trips: "mb.trips",
  active: "mb.activeTrip",
  base: "mb.base",
  device: "mb.deviceId",
} as const;

const isBrowser = () => typeof window !== "undefined";

function read<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento cheio ou bloqueado */
  }
}

export function getDeviceId(): string {
  if (!isBrowser()) return "";
  let id = window.localStorage.getItem(K.device);
  if (!id) {
    id = `mb_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    window.localStorage.setItem(K.device, id);
  }
  return id;
}

export function loadTrips(): Trip[] {
  return read<Trip[]>(K.trips) ?? [];
}

export function saveTrips(trips: Trip[]) {
  write(K.trips, trips);
}

export function loadActiveTrip(): Trip | null {
  return read<Trip>(K.active);
}

export function saveActiveTrip(trip: Trip | null) {
  if (!isBrowser()) return;
  if (trip) write(K.active, trip);
  else window.localStorage.removeItem(K.active);
}

export function loadBase(): BaseLocation | null {
  return read<BaseLocation>(K.base);
}

export function saveBase(base: BaseLocation | null) {
  if (!isBrowser()) return;
  if (base) write(K.base, base);
  else window.localStorage.removeItem(K.base);
}

/** Distância em metros entre dois pontos (Haversine). */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MAX_ACCURACY_M = 30;
export const MIN_STEP_M = 8;

export function formatKm(meters: number): string {
  return (meters / 1000).toFixed(2).replace(".", ",");
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function tripsToCsv(trips: Trip[]): string {
  const head = [
    "id",
    "motoboy",
    "entrega",
    "data",
    "inicio",
    "fim",
    "km",
    "duracao",
    "km_base_ate_entrega",
    "saiu_da_base",
    "voltou_a_base",
  ].join(";");
  const rows = trips.map((t) =>
    [
      t.id,
      t.deviceId,
      t.label.replace(/;/g, ","),
      formatDay(t.startedAt),
      formatTime(t.startedAt),
      t.endedAt ? formatTime(t.endedAt) : "",
      formatKm(t.distanceM),
      formatDuration((t.endedAt ?? t.startedAt) - t.startedAt),
      t.baseToEndM != null ? formatKm(t.baseToEndM) : "",
      t.leftBase ? "sim" : "nao",
      t.returnedToBase ? "sim" : "nao",
    ].join(";"),
  );
  return [head, ...rows].join("\n");
}
