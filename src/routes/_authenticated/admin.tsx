import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  fetchEmpresas,
  removeEmpresa,
  buscarLugares,
  loadSavedCity,
  saveCity,
  type Empresa,
  type ResultadoBusca,
} from "@/lib/empresas";
import { formatDay, formatKm, formatTime } from "@/lib/trips";
import type { EntregaMarcador, MotoboyMarcador } from "@/components/AdminMap";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const AdminMap = lazy(() => import("@/components/AdminMap"));
const CompanyLocationPickerModal = lazy(
  () => import("@/components/CompanyLocationPickerModal"),
);

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
  motoboy_nome: string | null;
  entregue_em: string | null;
  valor: number | null;
};

type MotoboyCadastrado = {
  id: string;
  nome: string;
  telefone: string | null;
  token: string;
  ativo: boolean;
  ativado_em: string | null;
};

type ConfirmAction = {
  titulo: string;
  descricao: string;
  acao: () => Promise<void>;
};

type Tab = "geral" | "motoboys" | "empresas" | "dados" | "corridas";

function AdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("geral");
  const [posicoes, setPosicoes] = useState<Posicao[]>([]);
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cadastrados, setCadastrados] = useState<MotoboyCadastrado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(() => Date.now());
  const [janelaMin, setJanelaMin] = useState(15);

  // Empresa search states
  const [busca, setBusca] = useState("");
  const [cidade, setCidade] = useState(() => loadSavedCity());
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Motoboy states
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");

  // Corridas filter
  const [filtroMotoboy, setFiltroMotoboy] = useState("");

  // Confirm dialog
  const [confirmacao, setConfirmacao] = useState<ConfirmAction | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [pos, cor, emp, mot] = await Promise.all([
      supabase
        .from("posicoes")
        .select("device_id,motoboy_nome,lat,lng,em_corrida,registrado_em")
        .order("registrado_em", { ascending: false })
        .limit(500),
      supabase
        .from("corridas")
        .select(
          "id,device_id,label,started_at,ended_at,distance_m,end_lat,end_lng,empresa_nome,motoboy_nome,entregue_em,valor",
        )
        .order("started_at", { ascending: false })
        .limit(200),
      fetchEmpresas(),
      supabase
        .from("motoboys")
        .select("id,nome,telefone,token,ativo,ativado_em")
        .order("created_at", { ascending: false }),
    ]);

    if (pos.error || cor.error || mot.error) {
      toast.error("Sem permissão de administrador ou erro ao carregar dados.");
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
    const idt = window.setInterval(() => setAgora(Date.now()), 30000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(idt);
    };
  }, [carregar]);

  const linkDe = (token: string) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/?convite=${token}`;

  const copiarLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkDe(token));
      toast.success("Link copiado! Envie ao motoboy.");
    } catch {
      toast.info("Copie o link manualmente.");
    }
  };

  const criarMotoboy = async () => {
    const nome = novoNome.trim();
    if (!nome) {
      toast.error("Escreva o nome do motoboy.");
      return;
    }
    const { error } = await supabase
      .from("motoboys")
      .insert({ nome, telefone: novoTelefone.trim() || null });
    if (error) {
      toast.error("Não foi possível cadastrar o motoboy agora.");
      return;
    }
    setNovoNome("");
    setNovoTelefone("");
    toast.success(`Motoboy ${nome} cadastrado com sucesso!`);
    await carregar();
  };

  const alternarAtivo = async (m: MotoboyCadastrado) => {
    const { error } = await supabase
      .from("motoboys")
      .update({ ativo: !m.ativo })
      .eq("id", m.id);
    if (error) {
      toast.error("Não foi possível alterar o status.");
      return;
    }
    toast.success(m.ativo ? `${m.nome} foi bloqueado.` : `${m.nome} foi reativado.`);
    await carregar();
  };

  const confirmarApagarMotoboy = (m: MotoboyCadastrado) => {
    setConfirmacao({
      titulo: `Excluir ${m.nome}?`,
      descricao:
        "Este motoboy será permanentemente removido do sistema e perderá acesso imediatamente. Esta ação não pode ser desfeita.",
      acao: async () => {
        const { error } = await supabase.from("motoboys").delete().eq("id", m.id);
        if (error) {
          toast.error("Não foi possível excluir o motoboy.");
          return;
        }
        toast.success(`${m.nome} foi excluído.`);
        await carregar();
      },
    });
  };

  const confirmarApagarEmpresa = (e: Empresa) => {
    setConfirmacao({
      titulo: `Remover ${e.nome}?`,
      descricao:
        "A empresa será removida do sistema. Corridas já registradas não serão afetadas, mas a detecção automática de chegada será desativada.",
      acao: async () => {
        setEmpresas(removeEmpresa(e.id));
        toast.success(`${e.nome} removida.`);
      },
    });
  };

  const procurarEmpresa = async () => {
    setBuscando(true);
    try {
      const res = await buscarLugares(busca, cidade);
      setResultados(res);
      if (res.length === 0)
        toast.info(
          `Nenhum resultado para "${busca}"${cidade ? ` em ${cidade}` : ""}. Tente marcar no mapa.`,
        );
    } catch {
      toast.error("Erro na busca. Verifique a internet.");
    } finally {
      setBuscando(false);
    }
  };

  const salvarResultado = async (r: ResultadoBusca) => {
    const { addEmpresa } = await import("@/lib/empresas");
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
    toast.success(`${r.nome} cadastrada!`);
  };

  const confirmarLimparInativos = () => {
    const inativos = cadastrados.filter((c) => !c.ativo || !c.ativado_em);
    if (inativos.length === 0) {
      toast.info("Não há motoboys inativos para excluir.");
      return;
    }
    setConfirmacao({
      titulo: `Excluir ${inativos.length} motoboy(s) inativo(s)?`,
      descricao:
        "Serão excluídos todos os motoboys desativados ou que nunca acessaram o link de convite. Esta ação não pode ser desfeita.",
      acao: async () => {
        let ok = 0;
        for (const inativo of inativos) {
          const { error } = await supabase.from("motoboys").delete().eq("id", inativo.id);
          if (!error) ok++;
        }
        await carregar();
        toast.success(`${ok} motoboy(s) inativo(s) excluído(s).`);
      },
    });
  };

  const confirmarLimparDadosAntigos = () => {
    setConfirmacao({
      titulo: "Apagar histórico com mais de 30 dias?",
      descricao:
        "Posições de GPS e corridas com mais de 30 dias serão permanentemente excluídas do banco de dados. Esta ação não pode ser desfeita.",
      acao: async () => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateStr = thirtyDaysAgo.toISOString();

        const [r1, r2] = await Promise.all([
          supabase.from("posicoes").delete().lt("registrado_em", dateStr),
          supabase.from("corridas").delete().lt("started_at", dateStr),
        ]);

        if (r1.error || r2.error) {
          toast.error(
            `Erro ao limpar dados: ${r1.error?.message || r2.error?.message || "desconhecido"}`,
          );
          return;
        }
        await carregar();
        toast.success("Histórico antigo (30+ dias) apagado com sucesso.");
      },
    });
  };

  const confirmarLimparTodasPosicoes = () => {
    setConfirmacao({
      titulo: "Apagar TODAS as posições GPS?",
      descricao:
        "Todos os registros de posição GPS de todos os motoboys serão excluídos permanentemente. Esta ação não pode ser desfeita.",
      acao: async () => {
        const { error } = await supabase.from("posicoes").delete().neq("id", "");
        if (error) {
          toast.error(`Erro: ${error.message}`);
          return;
        }
        await carregar();
        toast.success("Todas as posições GPS foram apagadas.");
      },
    });
  };

  const motoboys: MotoboyMarcador[] = useMemo(() => {
    const vistos = new Map<string, Posicao>();
    for (const p of posicoes) if (!vistos.has(p.device_id)) vistos.set(p.device_id, p);
    return [...vistos.values()].map((p) => {
      const t = new Date(p.registrado_em).getTime();
      const minutos = Math.max(0, Math.round((agora - t) / 60000));
      return {
        deviceId: p.device_id,
        nome: p.motoboy_nome ?? `Motoboy ${p.device_id.slice(-4)}`,
        lat: p.lat,
        lng: p.lng,
        emCorrida: p.em_corrida,
        quando: formatTime(t),
        online: minutos <= janelaMin,
        desdeTexto: textoDuracao(minutos),
      };
    });
  }, [posicoes, agora, janelaMin]);

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

  const empresasFiltradas = useMemo(
    () =>
      filtroEmpresa.trim().length > 0
        ? empresas.filter((e) =>
            e.nome.toLowerCase().includes(filtroEmpresa.toLowerCase()) ||
            (e.endereco ?? "").toLowerCase().includes(filtroEmpresa.toLowerCase()),
          )
        : empresas,
    [empresas, filtroEmpresa],
  );

  const corridasFiltradas = useMemo(
    () =>
      filtroMotoboy.trim().length > 0
        ? corridas.filter((c) =>
            (c.motoboy_nome ?? "").toLowerCase().includes(filtroMotoboy.toLowerCase()),
          )
        : corridas,
    [corridas, filtroMotoboy],
  );

  const sair = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const tabs = [
    { id: "geral", label: "Visão Geral", icon: "🗺️" },
    { id: "motoboys", label: "Motoboys", icon: "🏍️" },
    { id: "empresas", label: "Empresas", icon: "🏢" },
    { id: "corridas", label: "Corridas", icon: "📋" },
    { id: "dados", label: "Sistema", icon: "⚙️" },
  ] as const;

  const fallback = (
    <div className="flex h-80 w-full items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
      Carregando mapa…
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm px-4 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4 max-w-5xl mx-auto">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <span className="text-2xl">🏍️</span> Painel Administrativo
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {carregando ? "Sincronizando…" : `${motoboys.length} motoboy(s) · ${empresas.length} empresa(s) · ${corridas.length} corrida(s)`}
            </p>
          </div>
          <button
            onClick={sair}
            className="text-xs font-semibold text-destructive border border-destructive/30 rounded-lg px-3 py-1.5 hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            Sair
          </button>
        </div>

        <nav className="flex gap-1 overflow-x-auto pb-0 max-w-5xl mx-auto scrollbar-none">
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="space-y-6 px-4 py-6 pb-20 max-w-5xl mx-auto">
        {/* ── Visão Geral ── */}
        {tab === "geral" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                value={String(motoboys.length)}
                label="Motoboys Online"
                accent="blue"
                icon="📍"
              />
              <StatCard
                value={String(cadastrados.filter((m) => m.ativo).length)}
                label="Motoboys Ativos"
                accent="green"
                icon="✅"
              />
              <StatCard
                value={String(corridas.filter((c) => c.entregue_em).length)}
                label="Entregas Hoje"
                accent="violet"
                icon="📦"
              />
              <StatCard
                value={String(empresas.length)}
                label="Empresas"
                accent="amber"
                icon="🏢"
              />
            </div>

            <ClientOnly fallback={fallback}>
              <Suspense fallback={fallback}>
                <AdminMap motoboys={motoboys} empresas={empresas} entregas={entregas} />
              </Suspense>
            </ClientOnly>

            <section className="space-y-3">
              <h2 className="text-base font-bold">Corridas Recentes</h2>
              {corridas.length === 0 ? (
                <EmptyState text="Nenhuma corrida enviada ainda." />
              ) : (
                <div className="grid gap-2">
                  {corridas.slice(0, 8).map((c) => (
                    <TripCard key={c.id} c={c} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── Motoboys ── */}
        {tab === "motoboys" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-base font-bold">➕ Convidar Novo Motoboy</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Nome do motoboy"
                  className="rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                />
                <input
                  value={novoTelefone}
                  onChange={(e) => setNovoTelefone(e.target.value)}
                  placeholder="Telefone (opcional)"
                  className="rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                />
              </div>
              <button
                onClick={criarMotoboy}
                className="w-full rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20"
              >
                Gerar Link de Convite
              </button>
              <p className="text-xs text-muted-foreground">
                O link é gerado automaticamente. Envie-o ao motoboy — o acesso é liberado ao abri-lo.
              </p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">
                  Equipe Cadastrada{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({cadastrados.length})
                  </span>
                </h2>
              </div>

              {cadastrados.length === 0 ? (
                <EmptyState text="Nenhum motoboy cadastrado ainda." />
              ) : (
                <div className="grid gap-3">
                  {cadastrados.map((m) => (
                    <article
                      key={m.id}
                      className={`rounded-2xl border bg-card px-5 py-4 shadow-sm transition-all ${
                        m.ativo ? "border-border" : "border-destructive/30 bg-destructive/5"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-foreground truncate">
                              {m.nome}
                            </p>
                            <span
                              className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                !m.ativado_em
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                  : m.ativo
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    : "bg-destructive/15 text-destructive"
                              }`}
                            >
                              {!m.ativado_em ? "Pendente" : m.ativo ? "Ativo" : "Bloqueado"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {m.telefone ? `${m.telefone} · ` : ""}
                            {m.ativado_em
                              ? `Ativado em ${formatDay(new Date(m.ativado_em).getTime())}`
                              : "Link ainda não acessado"}
                          </p>
                          <p className="mt-2 break-all rounded-lg bg-secondary/50 px-2.5 py-1.5 text-[11px] font-mono text-secondary-foreground line-clamp-1 hover:line-clamp-none cursor-pointer transition-all">
                            {linkDe(m.token)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => copiarLink(m.token)}
                            title="Copiar link de convite"
                            className="rounded-xl border border-input bg-background px-3 py-2 text-xs font-semibold hover:bg-accent hover:text-accent-foreground transition-colors"
                          >
                            📋 Copiar
                          </button>
                          <button
                            onClick={() => alternarAtivo(m)}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                              m.ativo
                                ? "bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400"
                            }`}
                          >
                            {m.ativo ? "🔒 Bloquear" : "✅ Reativar"}
                          </button>
                          <button
                            onClick={() => confirmarApagarMotoboy(m)}
                            className="rounded-xl border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground px-3 py-2 text-xs font-semibold transition-colors"
                          >
                            🗑️
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

        {/* ── Empresas ── */}
        {tab === "empresas" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="text-base font-bold">🔍 Buscar e Cadastrar Empresa</h2>

              {/* City filter */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Filtrar por cidade
                </label>
                <input
                  value={cidade}
                  onChange={(e) => {
                    setCidade(e.target.value);
                    saveCity(e.target.value);
                  }}
                  placeholder="Ex.: São Paulo, Campinas, Recife…"
                  className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                />
              </div>

              {/* Search bar */}
              <div className="flex gap-2">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={`Buscar empresa${cidade ? ` em ${cidade}` : ""}…`}
                  className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                  onKeyDown={(e) =>
                    e.key === "Enter" && !buscando && busca.length >= 3 && procurarEmpresa()
                  }
                />
                <button
                  onClick={procurarEmpresa}
                  disabled={buscando || busca.trim().length < 3}
                  className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-all active:scale-[0.98] shadow-md shadow-primary/20"
                >
                  {buscando ? "…" : "Buscar"}
                </button>
              </div>

              {resultados.length > 0 && (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {resultados.map((r, i) => (
                    <button
                      key={`${r.lat}-${r.lng}-${i}`}
                      onClick={() => void salvarResultado(r)}
                      className="block w-full rounded-xl border border-input bg-background p-3 text-left hover:border-primary/60 hover:bg-primary/5 transition-all"
                    >
                      <span className="block text-sm font-semibold text-foreground">
                        {r.nome}
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {r.endereco}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Map pin button */}
              <div className="pt-1 border-t border-border">
                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-3.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-all"
                >
                  📍 Marcar Localização no Mapa
                  <span className="text-xs text-muted-foreground font-normal">
                    (empresa não encontrada na busca)
                  </span>
                </button>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold shrink-0">
                  Empresas Cadastradas{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({empresasFiltradas.length}/{empresas.length})
                  </span>
                </h2>
                <input
                  value={filtroEmpresa}
                  onChange={(e) => setFiltroEmpresa(e.target.value)}
                  placeholder="Filtrar…"
                  className="max-w-[180px] rounded-xl border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {empresasFiltradas.length === 0 ? (
                <EmptyState
                  text={
                    filtroEmpresa
                      ? `Nenhuma empresa encontrada para "${filtroEmpresa}".`
                      : "Nenhuma empresa cadastrada."
                  }
                />
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {empresasFiltradas.map((e) => (
                    <article
                      key={e.id}
                      className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div>
                        <p className="text-sm font-bold text-foreground">{e.nome}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {e.endereco ?? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`}
                        </p>
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold text-blue-400">
                          📡 Raio {e.raioM}m
                        </span>
                      </div>
                      <button
                        onClick={() => confirmarApagarEmpresa(e)}
                        className="self-end rounded-lg border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground px-3 py-1.5 text-xs font-semibold transition-colors"
                      >
                        🗑️ Remover
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Map picker modal */}
            <Suspense>
              <CompanyLocationPickerModal
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSaved={(nova) => {
                  setEmpresas((prev) => [...prev, nova]);
                  toast.success(`${nova.nome} salva com sucesso!`);
                }}
              />
            </Suspense>
          </div>
        )}

        {/* ── Corridas ── */}
        {tab === "corridas" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold shrink-0">
                Histórico de Corridas{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({corridasFiltradas.length})
                </span>
              </h2>
              <input
                value={filtroMotoboy}
                onChange={(e) => setFiltroMotoboy(e.target.value)}
                placeholder="Filtrar por motoboy…"
                className="max-w-[200px] rounded-xl border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {corridasFiltradas.length === 0 ? (
              <EmptyState text="Nenhuma corrida encontrada." />
            ) : (
              <div className="grid gap-2">
                {corridasFiltradas.map((c) => (
                  <TripCard key={c.id} c={c} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Dados / Sistema ── */}
        {tab === "dados" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Stats overview */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
              <h2 className="text-base font-bold">📊 Resumo do Banco de Dados</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{corridas.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Corridas</p>
                </div>
                <div className="rounded-xl bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{posicoes.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Posições GPS</p>
                </div>
                <div className="rounded-xl bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{empresas.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Empresas</p>
                </div>
                <div className="rounded-xl bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{cadastrados.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Motoboys</p>
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-5">
              <div>
                <h2 className="text-base font-bold text-destructive">⚠️ Ferramentas de Limpeza</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Ações irreversíveis — uma confirmação será exigida para cada operação.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <CleanCard
                  title="Limpar Motoboys Inativos"
                  description={`Exclui ${
                    cadastrados.filter((c) => !c.ativo || !c.ativado_em).length
                  } motoboy(s) desativados ou que nunca acessaram o convite.`}
                  onClick={confirmarLimparInativos}
                  buttonLabel="Executar Limpeza"
                />
                <CleanCard
                  title="Limpar Histórico (+30 dias)"
                  description="Exclui posições de GPS e corridas com mais de 30 dias do banco de dados."
                  onClick={confirmarLimparDadosAntigos}
                  buttonLabel="Apagar Histórico Antigo"
                />
                <CleanCard
                  title="Apagar Todas Posições GPS"
                  description="Remove todos os registros de rastreamento GPS do banco. Útil para liberar espaço."
                  onClick={confirmarLimparTodasPosicoes}
                  buttonLabel="Apagar Posições"
                  danger
                />
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmacao} onOpenChange={(open) => !open && setConfirmacao(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmacao?.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{confirmacao?.descricao}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await confirmacao?.acao();
                setConfirmacao(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({
  value,
  label,
  accent,
  icon,
}: {
  value: string;
  label: string;
  accent: "blue" | "green" | "violet" | "amber";
  icon: string;
}) {
  const accentCls = {
    blue: "text-blue-400 bg-blue-500/10",
    green: "text-emerald-400 bg-emerald-500/10",
    violet: "text-violet-400 bg-violet-500/10",
    amber: "text-amber-400 bg-amber-500/10",
  }[accent];
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm hover:shadow-md transition-shadow">
      <p className={`text-3xl font-bold tabular-nums ${accentCls.split(" ")[0]}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

function TripCard({ c }: { c: Corrida }) {
  return (
    <article className="rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{c.label ?? "Entrega"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {c.motoboy_nome ? `${c.motoboy_nome} · ` : ""}
            {formatDay(new Date(c.started_at).getTime())} ·{" "}
            {formatTime(new Date(c.started_at).getTime())}
            {c.ended_at ? ` – ${formatTime(new Date(c.ended_at).getTime())}` : ""}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {c.entregue_em ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                ✓ {c.empresa_nome ?? "Entregue"}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
            {c.valor != null && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                R$ {c.valor.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <p className="text-sm font-bold tabular-nums text-primary shrink-0">
          {formatKm(c.distance_m)} km
        </p>
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function CleanCard({
  title,
  description,
  onClick,
  buttonLabel,
  danger = false,
}: {
  title: string;
  description: string;
  onClick: () => void;
  buttonLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col gap-3">
      <div>
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <button
        onClick={onClick}
        className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
          danger
            ? "border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            : "bg-secondary text-secondary-foreground hover:bg-destructive hover:text-destructive-foreground"
        }`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
