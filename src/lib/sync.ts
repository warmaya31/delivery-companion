import { loadTrips, saveTrips, type Trip } from "./trips";

/**
 * Ponto único de sincronização com o futuro backend (login + painel admin).
 * Hoje não envia nada: apenas relata quantas corridas estão pendentes.
 * Quando o backend existir, troque só o corpo desta função.
 */
export async function syncPendingTrips(): Promise<{ pending: number; sent: number }> {
  const trips = loadTrips();
  const pending = trips.filter((t) => t.pendingSync && t.endedAt != null);
  return { pending: pending.length, sent: 0 };
}

export function markSynced(ids: string[]) {
  const trips = loadTrips().map((t: Trip) =>
    ids.includes(t.id) ? { ...t, pendingSync: false } : t,
  );
  saveTrips(trips);
}
