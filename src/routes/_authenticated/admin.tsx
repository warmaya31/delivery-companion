import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { fetchEmpresas, removeEmpresa, type Empresa } from "@/lib/empresas";
import { formatDay, formatKm, formatTime } from "@/lib/trips";
import type { EntregaMarcador, MotoboyMarcador } from "@/components/AdminMap";

const AdminMap = lazy(() => import("@/components/AdminMap"));

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

type Posicao = {
  device_id: string;
  motoboy_nome: string | null;
  lat: number;
  lng: number;
  em_corrida: boolean;
  registrado_em: string;
};

type Corrida = {
  id: string;
  device_id: string;
  label: string | null;
  started_at: string;
  ended_at: string | null;
  distance_m: number;
  end_lat: number | null;
  end_lng: number | null;
  empresa_nome: string | null;
  entregue_em: string | null;
};

function AdminPage() {
  const navigate = useNavigate();
  const [posicoes, setPosicoes] = useState<Posicao[]>([]);
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setErro(null);
    const [pos, cor, emp] = await Promise.all([
      supabase
        .from("posicoes")
        .select("device_id,motoboy_nome,lat,lng,em_corrida,registrado_em")
        .order("registrado_em", { ascending: false })
        .limit(500),
      supabase
        .from("corridas")
        .select(
          "id,device_id,label,started_at,ended_at,distance_m,end_lat,end_lng,empresa_nome,entregue_em",
        )
        .order("started_at", { ascending: false })
        .limit(100),
      fetchEmpresas(),
    ]);
    if (pos.error || cor.error) {
      setErro(
        "Esta conta ainda não tem permissão de administrador para ver os dados dos motoboys.",
      );
    }
    setPosicoes((pos.data as Posicao[] | null) ?? []);
    setCorridas((cor.data as Corrida[] | null) ?? []);
    setEmpresas(emp);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
    const id = window.setInterval(() => void carregar(), 30000);
    return () => window.clearInterval(id);
  }, [carregar]);

  const motoboys: MotoboyMarcador[] = useMemo(() => {
    const vistos = new Map<string, Posicao>();
    for (const p of posicoes) if (!vistos.has(p.device_id)) vistos.set(p.device_id, p);
    return [...vistos.values()].map((p) => ({
      deviceId: p.device_id,
      nome: p.motoboy_nome ?? `Motoboy ${p.device_id.slice(-4)}`,
      lat: p.lat,
      lng: p.lng,
      emCorrida: p.em_corrida,
      quando: formatTime(new Date(p.registrado_em).getTime()),
    }));
  }, [posicoes]);

  const entregas: EntregaMarcador[] = useMemo(
    () =>
      corridas
        .filter((c) => c.entregue_em && c.end_lat != null && c.end_lng != null)
        .map((c) => ({
          id: c.id,
          empresaNome: c.empresa_nome ?? "Empresa",
          lat: c.end_lat as number,
          lng: c.end_lng as number,
          quando: formatTime(new Date(c.entregue_em as string).getTime()),
        })),
    [corridas],
  );

  const sair = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const apagarEmpresa = (id: string) => {
    setEmpresas(removeEmpresa(id));
  };

  const fallback = (
    <div className="flex h-80 w-full items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
      Carregando mapa…
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 pt-6 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel do administrador</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Localização dos motoboys, empresas e entregas confirmadas.
          </p>
        </div>
        <button onClick={sair} className="text-sm text-muted-foreground underline">
          Sair
        </button>
      </header>

      <main className="space-y-4 px-4 py-5 pb-16">
        {erro && (
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">{erro}</p>
        )}
        {carregando && (
          <p className="text-sm text-muted-foreground">Carregando informações…</p>
        )}

        <ClientOnly fallback={fallback}>
          <Suspense fallback={fallback}>
            <AdminMap motoboys={motoboys} empresas={empresas} entregas={entregas} />
          </Suspense>
        </ClientOnly>

        <div className="grid grid-cols-3 gap-3">
          <Card value={String(motoboys.length)} text="Motoboys com posição" />
          <Card value={String(entregas.length)} text="Entregas confirmadas" />
          <Card value={String(empresas.length)} text="Empresas cadastradas" />
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Cadastro de motoboys (por convite)</h2>
          <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-4">
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nome do motoboy"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              value={novoTelefone}
              onChange={(e) => setNovoTelefone(e.target.value)}
              placeholder="Telefone (opcional)"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={criarMotoboy}
              className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            >
              Gerar link de acesso
            </button>
            <p className="text-xs text-muted-foreground">
              Envie o link ao motoboy. Só quem abrir o link consegue usar o app.
            </p>
          </div>

          {cadastrados.map((m) => (
            <article key={m.id} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{m.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.telefone ? `${m.telefone} · ` : ""}
                    {m.ativado_em
                      ? `acesso ativado em ${formatDay(new Date(m.ativado_em).getTime())}`
                      : "ainda não abriu o link"}
                    {m.ativo ? "" : " · desativado"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3">
                  <button
                    onClick={() => copiarLink(m.token)}
                    className="text-xs font-semibold text-primary underline"
                  >
                    Copiar link
                  </button>
                  <button
                    onClick={() => alternarAtivo(m)}
                    className="text-xs text-muted-foreground underline"
                  >
                    {m.ativo ? "Desativar" : "Reativar"}
                  </button>
                  <button
                    onClick={() => apagarMotoboy(m.id)}
                    className="text-xs text-muted-foreground underline"
                  >
                    Apagar
                  </button>
                </div>
              </div>
              <p className="break-all rounded-lg bg-secondary px-2 py-1 text-[11px] text-secondary-foreground">
                {linkDe(m.token)}
              </p>
            </article>
          ))}
          {cadastrados.length === 0 && (
            <p className="rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              Nenhum motoboy cadastrado ainda.
            </p>
          )}
        </section>

        <section className="space-y-2">

          <h2 className="text-sm font-semibold">Motoboys</h2>
          {motoboys.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              Nenhuma posição recebida ainda. Abra o app no celular do motoboy com o GPS
              ligado.
            </p>
          ) : (
            motoboys.map((m) => (
              <article
                key={m.deviceId}
                className="flex items-baseline justify-between rounded-xl border border-border bg-card px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold">{m.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.lat.toFixed(5)}, {m.lng.toFixed(5)} · {m.quando}
                  </p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {m.emCorrida ? "em corrida" : "parado"}
                </span>
              </article>
            ))
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Últimas corridas</h2>
          {corridas.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              Nenhuma corrida enviada ainda.
            </p>
          ) : (
            corridas.map((c) => (
              <article key={c.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{c.label ?? "Entrega"}</p>
                  <p className="text-sm font-bold tabular-nums">
                    {formatKm(c.distance_m)} km
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDay(new Date(c.started_at).getTime())} ·{" "}
                  {formatTime(new Date(c.started_at).getTime())}
                  {c.ended_at ? ` – ${formatTime(new Date(c.ended_at).getTime())}` : ""}
                </p>
                <p className="mt-1 text-xs">
                  {c.entregue_em ? (
                    <span className="font-semibold text-accent">
                      Entregue em {c.empresa_nome} às{" "}
                      {formatTime(new Date(c.entregue_em).getTime())}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Sem empresa reconhecida</span>
                  )}
                </p>
              </article>
            ))
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Empresas cadastradas</h2>
          {empresas.map((e) => (
            <article
              key={e.id}
              className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold">{e.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {e.endereco ?? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`} · chegada em{" "}
                  {e.raioM} m
                </p>
              </div>
              <button
                onClick={() => apagarEmpresa(e.id)}
                className="text-xs text-muted-foreground underline"
              >
                Apagar
              </button>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

function Card({ value, text }: { value: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
