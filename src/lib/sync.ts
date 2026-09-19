import { supabase } from "@/integrations/supabase/client";
import { pushEmpresasPendentes } from "./empresas";
import { loadMotoboy } from "./motoboy";
import { getDeviceId, loadTrips, saveTrips, type GeoPoint, type Trip } from "./trips";

/** Envia uma corrida finalizada para o painel do administrador. */
async function pushTrip(trip: Trip): Promise<boolean> {
  try {
    const motoboy = loadMotoboy();
    const { error } = await supabase.from("corridas").insert({
      device_id: trip.deviceId || getDeviceId(),
      motoboy_ref: motoboy?.id ?? null,
      motoboy_nome: motoboy?.nome ?? null,
      device_trip_id: trip.id,

      label: trip.label,
      started_at: new Date(trip.startedAt).toISOString(),
      ended_at: trip.endedAt ? new Date(trip.endedAt).toISOString() : null,
      distance_m: trip.distanceM,
      start_lat: trip.startPoint?.lat ?? null,
      start_lng: trip.startPoint?.lng ?? null,
      end_lat: trip.endPoint?.lat ?? null,
      end_lng: trip.endPoint?.lng ?? null,
      empresa_id:
        trip.empresaId && !trip.empresaId.startsWith("local_") ? trip.empresaId : null,
      empresa_nome: trip.empresaNome ?? null,
      entregue_em: trip.entregueEm ? new Date(trip.entregueEm).toISOString() : null,
      base_to_end_m: trip.baseToEndM,
    });

    // 23505 = já existia no painel; considera enviada
    if (error && error.code !== "23505") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Envia tudo o que está guardado no celular e devolve quantas corridas
 * continuam pendentes (sem internet, por exemplo).
 */
export async function syncPendingTrips(): Promise<{ pending: number; sent: number }> {
  await pushEmpresasPendentes();
  const trips = loadTrips();
  const pendentes = trips.filter((t) => t.pendingSync && t.endedAt != null);
  const enviadas: string[] = [];
  for (const t of pendentes) {
    if (await pushTrip(t)) enviadas.push(t.id);
  }
  if (enviadas.length > 0) markSynced(enviadas);
  return { pending: pendentes.length - enviadas.length, sent: enviadas.length };
}

export function markSynced(ids: string[]) {
  const trips = loadTrips().map((t: Trip) =>
    ids.includes(t.id) ? { ...t, pendingSync: false } : t,
  );
  saveTrips(trips);
}

let ultimoEnvio = 0;

/** Envia a posição atual para o painel (no máximo uma vez por minuto). */
export async function pushPosition(point: GeoPoint, emCorrida: boolean) {
  const agora = Date.now();
  if (agora - ultimoEnvio < 60000) return;
  ultimoEnvio = agora;
  try {
    const motoboy = loadMotoboy();
    await supabase.from("posicoes").insert({
      device_id: getDeviceId(),
      motoboy_ref: motoboy?.id ?? null,
      motoboy_nome: motoboy?.nome ?? null,
      lat: point.lat,
      lng: point.lng,
      acc: point.acc ?? null,
      em_corrida: emCorrida,
      registrado_em: new Date(point.t).toISOString(),
    });

  } catch {
    ultimoEnvio = 0;
  }
}
