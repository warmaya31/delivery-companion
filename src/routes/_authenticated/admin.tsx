import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { fetchEmpresas, removeEmpresa, addEmpresa, buscarLugares, type Empresa, type ResultadoBusca } from "@/lib/empresas";
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

type MotoboyCadastrado = {
  id: string;
  nome: string;
  telefone: string | null;
  token: string;
  ativo: boolean;
  ativado_em: string | null;
};

type Tab = "geral" | "motoboys" | "empresas" | "dados";

function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("geral");
  const [posicoes, setPosicoes] = useState<Posicao[]>([]);
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cadastrados, setCadastrados] = useState<MotoboyCadastrado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Estados para Empresas
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  // Estados para Motoboys
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");

  const carregar = useCallback(async () => {
    setErro(null);
    const [pos, cor, emp, mot] = await Promise.all([
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
      supabase
        .from("motoboys")
        .select("id,nome,telefone,token,ativo,ativado_em")
        .order("created_at", { ascending: false }),
    ]);
    if (pos.error || cor.error || mot.error) {
      setErro(
        "Esta conta ainda não tem permissão de administrador para ver os dados dos motoboys.",
      );
    }
    setPosicoes((pos.data as Posicao[] | null) ?? []);
    setCorridas((cor.data as Corrida[] | null) ?? []);
    setEmpresas(emp);
    setCadastrados((mot.data as MotoboyCadastrado[] | null) ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
    const id = window.setInterval(() => void carregar(), 30000);
    return () => window.clearInterval(id);
  }, [carregar]);

  const linkDe = (token: string) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/?convite=${token}`;

  const copiarLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkDe(token));
      setErro("Link copiado. Envie para o motoboy.");
    } catch {
      setErro("Copie o link mostrado abaixo do nome.");
    }
  };

  const criarMotoboy = async () => {
    const nome = novoNome.trim();
    if (!nome) {
      setErro("Escreva o nome do motoboy.");
      return;
    }
    const { error } = await supabase
      .from("motoboys")
      .insert({ nome, telefone: novoTelefone.trim() || null });
    if (error) {
      setErro("Não foi possível cadastrar o motoboy agora.");
      return;
    }
    setNovoNome("");
    setNovoTelefone("");
    await carregar();
  };

  const alternarAtivo = async (m: MotoboyCadastrado) => {
    await supabase.from("motoboys").update({ ativo: !m.ativo }).eq("id", m.id);
    await carregar();
  };

  const apagarMotoboy = async (id: string) => {
    await supabase.from("motoboys").delete().eq("id", id);
    await carregar();
  };
  
  const limparInativos = async () => {
    const inativos = cadastrados.filter(c => !c.ativo || !c.ativado_em);
    for (const inativo of inativos) {
       await supabase.from("motoboys").delete().eq("id", inativo.id);
    }
    await carregar();
    setErro("Motoboys inativos e não ativados foram excluídos.");
  };

  const limparDadosAntigos = async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString();
    
    const { error: err1 } = await supabase.from("posicoes").delete().lt("registrado_em", dateStr);
    const { error: err2 } = await supabase.from("corridas").delete().lt("started_at", dateStr);
    
    if (err1 || err2) {
       setErro("Erro ao limpar dados antigos.");
    } else {
       setErro("Dados com mais de 30 dias foram limpos com sucesso.");
       await carregar();
    }
  };

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

  const procurarEmpresa = async () => {
    setBuscando(true);
    setErro(null);
    try {
      setResultados(await buscarLugares(busca));
    } catch {
      setErro("Erro na busca de empresas. Verifique a internet.");
    } finally {
      setBuscando(false);
    }
  };

  const salvarResultado = async (r: ResultadoBusca) => {
    const lista = await addEmpresa({
      nome: r.nome,
      endereco: r.endereco,
      lat: r.lat,
      lng: r.lng,
      raioM: 200,
    });
    setEmpresas(lista);
    setResultados([]);
    setBusca("");
    setErro(`${r.nome} cadastrada com sucesso.`);
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
      <header className="border-b border-border px-4 pt-6 pb-0">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Localização dos motoboys, empresas e entregas.
            </p>
          </div>
          <button onClick={sair} className="text-sm font-semibold text-destructive underline">
            Sair
          </button>
        </div>
        
        <nav className="flex gap-4 overflow-x-auto">
          {(
            [
              ["geral", "Visão Geral"],
              ["motoboys", "Motoboys"],
              ["empresas", "Empresas"],
              ["dados", "Dados / Sistema"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`border-b-2 px-2 py-3 text-sm font-semibold transition-colors whitespace-nowrap ${
                tab === value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {text}
            </button>
          ))}
        </nav>
      </header>

      <main className="space-y-6 px-4 py-6 pb-16 max-w-4xl mx-auto">
        {erro && (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm flex justify-between items-center shadow-sm">
            <span>{erro}</span>
            <button onClick={() => setErro(null)} className="text-muted-foreground hover:text-foreground ml-4">✕</button>
          </div>
        )}
        {carregando && (
          <p className="text-sm text-muted-foreground animate-pulse">Sincronizando informações com a base de dados…</p>
        )}

        {tab === "geral" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-3 gap-4">
              <Card value={String(motoboys.length)} text="Motoboys Ativos" />
              <Card value={String(entregas.length)} text="Entregas (Dia)" />
              <Card value={String(empresas.length)} text="Empresas" />
            </div>

            <ClientOnly fallback={fallback}>
              <Suspense fallback={fallback}>
                <AdminMap motoboys={motoboys} empresas={empresas} entregas={entregas} />
              </Suspense>
            </ClientOnly>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Corridas Recentes</h2>
              {corridas.length === 0 ? (
                <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhuma corrida enviada ainda.
                </p>
              ) : (
                <div className="grid gap-3">
                  {corridas.slice(0, 5).map((c) => (
                    <article key={c.id} className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold">{c.label ?? "Entrega"}</p>
                        <p className="text-sm font-bold tabular-nums text-primary">
                          {formatKm(c.distance_m)} km
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.motoboy_nome ? `Motoboy: ${c.motoboy_nome} · ` : ""}
                        {formatDay(new Date(c.started_at).getTime())} ·{" "}
                        {formatTime(new Date(c.started_at).getTime())}
                        {c.ended_at ? ` – ${formatTime(new Date(c.ended_at).getTime())}` : ""}
                      </p>
                      <p className="mt-2 text-xs">
                        {c.entregue_em ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                            ✓ Entregue em {c.empresa_nome}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Sem empresa reconhecida</span>
                        )}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "motoboys" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Convidar Novo Motoboy</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Nome do motoboy"
                  className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
                <input
                  value={novoTelefone}
                  onChange={(e) => setNovoTelefone(e.target.value)}
                  placeholder="Telefone (opcional)"
                  className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
                <button
                  onClick={criarMotoboy}
                  className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                >
                  Gerar Convite
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Envie o link gerado ao motoboy. O acesso é liberado automaticamente ao abrir o link.
              </p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Equipe Cadastrada</h2>
                <span className="text-sm text-muted-foreground">{cadastrados.length} membros</span>
              </div>
              
              {cadastrados.length === 0 ? (
                <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum motoboy cadastrado ainda.
                </p>
              ) : (
                <div className="grid gap-3">
                  {cadastrados.map((m) => (
                    <article key={m.id} className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <p className="text-base font-semibold flex items-center gap-2">
                            {m.nome}
                            <span className={`w-2 h-2 rounded-full ${m.ativo ? 'bg-emerald-500' : 'bg-destructive'}`}></span>
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {m.telefone ? `${m.telefone} · ` : ""}
                            {m.ativado_em
                              ? `Ativado em ${formatDay(new Date(m.ativado_em).getTime())}`
                              : "Pendente (Link não acessado)"}
                          </p>
                          <p className="mt-2 break-all rounded-md bg-secondary/50 px-2 py-1 text-xs text-secondary-foreground inline-block">
                            {linkDe(m.token)}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copiarLink(m.token)}
                            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent hover:text-accent-foreground transition-colors"
                          >
                            Copiar link
                          </button>
                          <button
                            onClick={() => alternarAtivo(m)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                              m.ativo 
                                ? "bg-secondary text-secondary-foreground hover:bg-secondary/80" 
                                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400"
                            }`}
                          >
                            {m.ativo ? "Desativar" : "Reativar"}
                          </button>
                          <button
                            onClick={() => apagarMotoboy(m.id)}
                            className="rounded-md border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground px-3 py-1.5 text-xs font-semibold transition-colors"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "empresas" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Buscar e Cadastrar Empresa</h2>
              <div className="flex gap-3">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Ex.: Retífica São Jorge, Rua X, 100"
                  className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && !buscando && busca.length >= 3 && procurarEmpresa()}
                />
                <button
                  onClick={procurarEmpresa}
                  disabled={buscando || busca.trim().length < 3}
                  className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors shadow-sm"
                >
                  {buscando ? "Buscando..." : "Buscar"}
                </button>
              </div>
              
              {resultados.length > 0 && (
                <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto pr-2">
                  {resultados.map((r, i) => (
                    <button
                      key={`${r.lat}-${r.lng}-${i}`}
                      onClick={() => void salvarResultado(r)}
                      className="block w-full rounded-lg border border-input bg-background p-3 text-left hover:border-primary/50 hover:bg-accent transition-colors"
                    >
                      <span className="block text-sm font-semibold text-foreground">{r.nome}</span>
                      <span className="block text-xs text-muted-foreground mt-1">{r.endereco}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Empresas Cadastradas</h2>
                <span className="text-sm text-muted-foreground">{empresas.length} empresas</span>
              </div>
              
              {empresas.length === 0 ? (
                <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma empresa cadastrada no momento.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {empresas.map((e) => (
                    <article
                      key={e.id}
                      className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
                    >
                      <div>
                        <p className="text-base font-semibold">{e.nome}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {e.endereco ?? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`}
                        </p>
                        <p className="text-[11px] font-medium text-primary mt-2">
                          Chegada automática raio {e.raioM}m
                        </p>
                      </div>
                      <button
                        onClick={() => apagarEmpresa(e.id)}
                        className="self-end rounded-md text-xs font-semibold text-destructive hover:underline"
                      >
                        Remover
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
        
        {tab === "dados" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
             <section className="space-y-4 rounded-xl border border-destructive/20 bg-destructive/5 p-5">
              <h2 className="text-lg font-semibold text-destructive">Ferramentas de Limpeza</h2>
              <p className="text-sm text-muted-foreground">
                Ações irreversíveis para manter a base de dados leve e organizada.
              </p>
              
              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <h3 className="font-semibold text-sm">Limpar Motoboys Inativos</h3>
                  <p className="text-xs text-muted-foreground mt-1 mb-4 h-8">
                    Exclui motoboys que foram desativados ou que nunca abriram o link de convite.
                  </p>
                  <button 
                    onClick={limparInativos}
                    className="w-full rounded-md bg-secondary text-secondary-foreground hover:bg-destructive hover:text-destructive-foreground px-4 py-2 text-sm font-semibold transition-colors"
                  >
                    Executar Limpeza
                  </button>
                </div>
                
                <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <h3 className="font-semibold text-sm">Limpar Histórico Antigo</h3>
                  <p className="text-xs text-muted-foreground mt-1 mb-4 h-8">
                    Exclui posições de GPS e corridas com mais de 30 dias.
                  </p>
                  <button 
                    onClick={limparDadosAntigos}
                    className="w-full rounded-md bg-secondary text-secondary-foreground hover:bg-destructive hover:text-destructive-foreground px-4 py-2 text-sm font-semibold transition-colors"
                  >
                    Apagar Dados (+30 dias)
                  </button>
                </div>
              </div>
             </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ value, text }: { value: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-3xl font-bold tabular-nums text-primary">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">{text}</p>
    </div>
  );
}
