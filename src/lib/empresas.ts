import { supabase } from "@/integrations/supabase/client";
import { getDeviceId, haversineM } from "./trips";

export type Empresa = {
  /** id do banco ou `local_...` enquanto não foi enviada */
  id: string;
  nome: string;
  endereco: string | null;
  lat: number;
  lng: number;
  raioM: number;
  pendingSync?: boolean;
};

const KEY = "mb.empresas";
const isBrowser = () => typeof window !== "undefined";

export function loadEmpresas(): Empresa[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Empresa[]) : [];
  } catch {
    return [];
  }
}

export function saveEmpresas(list: Empresa[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* armazenamento cheio */
  }
}

type Row = {
  id: string;
  nome: string;
  endereco: string | null;
  lat: number;
  lng: number;
  raio_m: number;
};

const fromRow = (r: Row): Empresa => ({
  id: r.id,
  nome: r.nome,
  endereco: r.endereco,
  lat: r.lat,
  lng: r.lng,
  raioM: r.raio_m,
});

/** Baixa as empresas cadastradas e junta com as que ainda estão só no celular. */
export async function fetchEmpresas(): Promise<Empresa[]> {
  const locais = loadEmpresas();
  try {
    const { data, error } = await supabase
      .from("empresas")
      .select("id,nome,endereco,lat,lng,raio_m")
      .order("nome");
    if (error || !data) return locais;
    const remotas = (data as Row[]).map(fromRow);
    const pendentes = locais.filter((e) => e.pendingSync);
    const merged = [...remotas, ...pendentes];
    saveEmpresas(merged);
    return merged;
  } catch {
    return locais;
  }
}

export async function addEmpresa(input: {
  nome: string;
  endereco?: string | null;
  lat: number;
  lng: number;
  raioM?: number;
}): Promise<Empresa[]> {
  const nova: Empresa = {
    id: `local_${Date.now().toString(36)}`,
    nome: input.nome.trim() || "Empresa sem nome",
    endereco: input.endereco ?? null,
    lat: input.lat,
    lng: input.lng,
    raioM: input.raioM ?? 200,
    pendingSync: true,
  };
  const lista = [...loadEmpresas(), nova];
  saveEmpresas(lista);
  await pushEmpresasPendentes();
  return loadEmpresas();
}

export function removeEmpresa(id: string): Empresa[] {
  const lista = loadEmpresas().filter((e) => e.id !== id);
  saveEmpresas(lista);
  if (!id.startsWith("local_")) void supabase.from("empresas").delete().eq("id", id);
  return lista;
}

/** Envia para a nuvem as empresas cadastradas offline. */
export async function pushEmpresasPendentes(): Promise<void> {
  const lista = loadEmpresas();
  const pendentes = lista.filter((e) => e.pendingSync);
  if (pendentes.length === 0) return;
  let mudou = false;
  const atualizada = [...lista];
  for (const e of pendentes) {
    try {
      const { data, error } = await supabase
        .from("empresas")
        .insert({
          nome: e.nome,
          endereco: e.endereco,
          lat: e.lat,
          lng: e.lng,
          raio_m: e.raioM,
          created_by_device: getDeviceId(),
        })
        .select("id,nome,endereco,lat,lng,raio_m")
        .single();
      if (error || !data) continue;
      const idx = atualizada.findIndex((x) => x.id === e.id);
      if (idx >= 0) atualizada[idx] = fromRow(data as Row);
      mudou = true;
    } catch {
      /* sem internet: tenta na próxima vez */
    }
  }
  if (mudou) saveEmpresas(atualizada);
}

/** Empresa cujo raio contém o ponto (a mais próxima, se houver várias). */
export function empresaNoPonto(
  point: { lat: number; lng: number },
  empresas: Empresa[],
): { empresa: Empresa; distanciaM: number } | null {
  let melhor: { empresa: Empresa; distanciaM: number } | null = null;
  for (const e of empresas) {
    const d = haversineM(point, e);
    if (d <= e.raioM && (!melhor || d < melhor.distanciaM)) {
      melhor = { empresa: e, distanciaM: d };
    }
  }
  return melhor;
}

const CITY_KEY = "mb.selected_city";

export function loadSavedCity(): string {
  if (!isBrowser()) return "";
  return window.localStorage.getItem(CITY_KEY) || "";
}

export function saveCity(city: string) {
  if (!isBrowser()) return;
  window.localStorage.setItem(CITY_KEY, city);
}

export type ResultadoBusca = {
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
};

/** Busca endereços/empresas no mapa livre do OpenStreetMap (gratuito) filtrando por cidade opcional. */
export async function buscarLugares(q: string, cidade?: string): Promise<ResultadoBusca[]> {
  const termo = q.trim();
  if (termo.length < 3) return [];
  const queryCompleta =
    cidade && cidade.trim() ? `${termo}, ${cidade.trim()}, Brasil` : `${termo}, Brasil`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&countrycodes=br&q=${encodeURIComponent(
    queryCompleta,
  )}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("busca indisponível");
  const data = (await res.json()) as Array<{
    display_name: string;
    name?: string;
    lat: string;
    lon: string;
  }>;
  return data.map((d) => ({
    nome: d.name && d.name.length > 0 ? d.name : d.display_name.split(",")[0]!.trim(),
    endereco: d.display_name,
    lat: Number(d.lat),
    lng: Number(d.lon),
  }));
}

/** Obtém endereço aproximado a partir de coordenadas (geocodificação reversa). */
export async function buscarEnderecoPorCoordenadas(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name || null;
  } catch {
    return null;
  }
}
