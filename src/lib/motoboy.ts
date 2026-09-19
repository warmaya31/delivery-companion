import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "./trips";

export type MotoboyLocal = {
  id: string;
  nome: string;
  token: string;
  ativadoEm: number;
};

const KEY = "mb.motoboy";

const isBrowser = () => typeof window !== "undefined";

export function loadMotoboy(): MotoboyLocal | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MotoboyLocal) : null;
  } catch {
    return null;
  }
}

export function saveMotoboy(m: MotoboyLocal | null) {
  if (!isBrowser()) return;
  if (m) window.localStorage.setItem(KEY, JSON.stringify(m));
  else window.localStorage.removeItem(KEY);
}

/** Lê o código do convite do endereço (?convite=...) */
export function conviteDaUrl(): string | null {
  if (!isBrowser()) return null;
  const t = new URLSearchParams(window.location.search).get("convite");
  return t && t.trim() ? t.trim() : null;
}

/** Ativa o convite enviado pelo administrador e guarda o motoboy no aparelho. */
export async function ativarConvite(
  token: string,
): Promise<{ ok: true; motoboy: MotoboyLocal } | { ok: false; erro: string }> {
  try {
    const { data, error } = await supabase.rpc("ativar_convite", {
      _token: token,
      _device_id: getDeviceId(),
    });
    if (error) return { ok: false, erro: "Não foi possível validar o convite agora." };
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return { ok: false, erro: "Este link de convite não é válido ou foi desativado." };
    const motoboy: MotoboyLocal = {
      id: row.id,
      nome: row.nome,
      token,
      ativadoEm: Date.now(),
    };
    saveMotoboy(motoboy);
    return { ok: true, motoboy };
  } catch {
    return { ok: false, erro: "Sem internet para validar o convite. Tente novamente." };
  }
}

/**
 * Verifica se o motoboy continua ativo e com permissão de acesso no sistema.
 * Retorna true se ativo, false se explicitamente bloqueado ou removido pelo admin.
 */
export async function checarAcessoMotoboy(m: MotoboyLocal | null): Promise<boolean> {
  if (!m || !m.id) return false;
  try {
    // 1. Tentar chamar a RPC verificar_motoboy_ativo
    const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
      "verificar_motoboy_ativo",
      {
        _id: m.id,
        _token: m.token || null,
      },
    );
    if (!rpcError && typeof rpcData === "boolean") {
      return rpcData;
    }

    // 2. Fallback: consulta direta na tabela motoboys
    const { data, error } = await supabase
      .from("motoboys")
      .select("id, ativo")
      .eq("id", m.id)
      .maybeSingle();

    if (!error) {
      if (!data) return false; // motoboy foi excluído
      return data.ativo === true;
    }

    // Se houve erro de rede/offline, preserva a sessão offline
    return true;
  } catch {
    return true;
  }
}
