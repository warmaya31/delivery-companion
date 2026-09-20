import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MAX_ACCURACY_M,
  MIN_STEP_M,
  formatDay,
  formatDuration,
  formatKm,
  formatTime,
  getDeviceId,
  haversineM,
  loadActiveTrip,
  loadBase,
  loadTrips,
  saveActiveTrip,
  saveBase,
  saveTrips,
  tripsToCsv,
  type BaseLocation,
  type GeoPoint,
  type Trip,
  type TripDestino,
} from "@/lib/trips";
import {
  addEmpresa,
  buscarLugares,
  empresaNoPonto,
  fetchEmpresas,
  loadEmpresas,
  removeEmpresa,
  type Empresa,
  type ResultadoBusca,
} from "@/lib/empresas";
import { pushPosition, syncPendingTrips } from "@/lib/sync";
import {
  ativarConvite,
  checarAcessoMotoboy,
  conviteDaUrl,
  loadMotoboy,
  saveMotoboy,
  type MotoboyLocal,
} from "@/lib/motoboy";

const TripMap = lazy(() => import("@/components/TripMap"));

function MapPanel(props: {
  current: GeoPoint | null;
  base: BaseLocation | null;
  points: GeoPoint[];
  empresas: Empresa[];
  entregueEmpresaId: string | null;
}) {
  const fallback = (
    <div className="flex h-64 w-full items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
      Carregando mapa…
    </div>
  );
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <TripMap {...props} />
      </Suspense>
    </ClientOnly>
  );
}

export const Route = createFileRoute("/")(({
  head: () => ({
    meta: [
      { title: "KM Motoboy — contador de km offline para entregas" },
      {
        name: "description",
        content:
          "Registre entregas e conte os km rodados pelo GPS, mesmo sem internet. Empresas cadastradas com confirmação automática de entrega, base fixa da operação e histórico do dia.",
      },
      { property: "og:title", content: "KM Motoboy — contador de km offline para entregas" },
      {
        property: "og:description",
        content:
          "Inicie a corrida, o app conta os km pelo GPS e confirma sozinho a chegada na empresa. Funciona offline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
} as any));

type Tab = "corrida" | "historico" | "config";

function Index() {
  const [tab, setTab] = useState<Tab>("corrida");
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [base, setBase] = useState<BaseLocation | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [active, setActive] = useState<Trip | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [current, setCurrent] = useState<GeoPoint | null>(null);
  const [pending, setPending] = useState(0);
  const [motoboy, setMotoboy] = useState<MotoboyLocal | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [checandoConvite, setChecandoConvite] = useState(true);
  const [erroConvite, setErroConvite] = useState<string | null>(null);

  // Multi-destination state (before starting a trip)
  const [destinos, setDestinos] = useState<TripDestino[]>([]);
  const [buscaEmpresa, setBuscaEmpresa] = useState("");
  const [resultadosBusca, setResultadosBusca] = useState<ResultadoBusca[]>([]);
  const [buscandoEmpresa, setBuscandoEmpresa] = useState(false);
  const [editandoValorIdx, setEditandoValorIdx] = useState<number | null>(null);
  const [valorInput, setValorInput] = useState("");

  const watchRef = useRef<number | null>(null);
  const activeRef = useRef<Trip | null>(null);
  const baseRef = useRef<BaseLocation | null>(null);
  const empresasRef = useRef<Empresa[]>([]);
  const motoboyRef = useRef<MotoboyLocal | null>(null);

  activeRef.current = active;
  baseRef.current = base;
  empresasRef.current = empresas;
  motoboyRef.current = motoboy;

  // Load everything from device
  useEffect(() => {
    setDeviceId(getDeviceId());
    setBase(loadBase());
    setTrips(loadTrips());
    setActive(loadActiveTrip());
    setEmpresas(loadEmpresas());

    const salvo = loadMotoboy();
    const token = conviteDaUrl();

    const liberar = (m: MotoboyLocal | null) => {
      setMotoboy(m);
      setChecandoConvite(false);
      if (!m) return;
      setReady(true);
      void syncPendingTrips().then((r) => setPending(r.pending));
      void fetchEmpresas().then(setEmpresas);
    };

    if (token && (!salvo || salvo.token !== token)) {
      void ativarConvite(token).then((r) => {
        if (r.ok) {
          window.history.replaceState({}, "", window.location.pathname);
          liberar(r.motoboy);
        } else {
          setErroConvite(r.erro);
          liberar(salvo);
        }
      });
      return;
    }
    liberar(salvo);
  }, []);

  // Periodic access check (every 30 seconds while online)
  useEffect(() => {
    if (!motoboy) return;
    const check = async () => {
      const ativo = await checarAcessoMotoboy(motoboy);
      if (!ativo) {
        setBloqueado(true);
        setReady(false);
        saveMotoboy(null);
        setMotoboy(null);
        if (watchRef.current != null) {
          navigator.geolocation.clearWatch(watchRef.current);
          watchRef.current = null;
        }
      }
    };
    const id = window.setInterval(() => void check(), 30000);
    return () => window.clearInterval(id);
  }, [motoboy]);

  const persistActive = useCallback((trip: Trip | null) => {
    setActive(trip);
    saveActiveTrip(trip);
  }, []);

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const point: GeoPoint = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      t: pos.timestamp,
      acc: pos.coords.accuracy,
    };
    setCurrent(point);
    setStatus(null);
    void pushPosition(point, activeRef.current != null);

    const trip = activeRef.current;
    if (!trip) return;
    if (point.acc != null && point.acc > MAX_ACCURACY_M) return;

    const last = trip.points[trip.points.length - 1];
    let distanceM = trip.distanceM;
    let points = trip.points;

    if (!last) {
      points = [point];
    } else {
      const step = haversineM(last, point);
      if (step < MIN_STEP_M) return;
      distanceM += step;
      points = [...trip.points.slice(-499), point];
    }

    const b = baseRef.current;
    let leftBase = trip.leftBase;
    let returnedToBase = trip.returnedToBase;
    if (b) {
      const distFromBase = haversineM(b, point);
      if (!leftBase && distFromBase > b.radiusM) leftBase = true;
      else if (leftBase && distFromBase <= b.radiusM) returnedToBase = true;
    }

    // Multi-destination auto-detection
    let updatedDestinos = trip.destinos ? [...trip.destinos] : [];
    if (updatedDestinos.length > 0) {
      const longeDaBase = !b || haversineM(b, point) > b.radiusM;
      if (longeDaBase) {
        let anyDelivered = false;
        updatedDestinos = updatedDestinos.map((d) => {
          if (d.entregueEm) return d;
          const empresa = empresasRef.current.find((e) => e.id === d.empresaId);
          if (!empresa) return d;
          const dist = haversineM(point, empresa);
          if (dist <= empresa.raioM) {
            anyDelivered = true;
            setStatus(`Chegada em ${empresa.nome} — entrega marcada automaticamente.`);
            return { ...d, entregueEm: point.t };
          }
          return d;
        });
        if (anyDelivered) {
          const updated: Trip = {
            ...trip,
            points,
            distanceM,
            startPoint: trip.startPoint ?? point,
            endPoint: point,
            baseToEndM: b ? haversineM(b, point) : null,
            leftBase,
            returnedToBase,
            destinos: updatedDestinos,
            empresaNome: updatedDestinos.map((d) => d.empresaNome).join(", "),
            entregueEm: updatedDestinos.every((d) => d.entregueEm)
              ? point.t
              : trip.entregueEm ?? null,
          };
          setActive(updated);
          saveActiveTrip(updated);
          return;
        }
      }
    }

    // Single-destination legacy detection
    let empresaId = trip.empresaId ?? null;
    let empresaNome = trip.empresaNome ?? null;
    let entregueEm = trip.entregueEm ?? null;
    if (!entregueEm && updatedDestinos.length === 0) {
      const achou = empresaNoPonto(point, empresasRef.current);
      const longeDaBase = !b || haversineM(b, point) > b.radiusM;
      if (achou && longeDaBase) {
        empresaId = achou.empresa.id;
        empresaNome = achou.empresa.nome;
        entregueEm = point.t;
        setStatus(`Chegada em ${achou.empresa.nome} — entrega marcada automaticamente.`);
      }
    }

    const updated: Trip = {
      ...trip,
      points,
      distanceM,
      startPoint: trip.startPoint ?? point,
      endPoint: point,
      baseToEndM: b ? haversineM(b, point) : null,
      leftBase,
      returnedToBase,
      destinos: updatedDestinos.length > 0 ? updatedDestinos : trip.destinos ?? [],
      empresaId,
      empresaNome,
      entregueEm,
    };
    setActive(updated);
    saveActiveTrip(updated);
  }, []);

  const handleError = useCallback((err: GeolocationPositionError) => {
    setStatus(
      err.code === err.PERMISSION_DENIED
        ? "Permissão de localização negada. Libere o GPS para o app nas configurações do celular."
        : "Sinal de GPS fraco. Fique com o celular em local aberto por alguns segundos.",
    );
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("Este aparelho não permite acesso ao GPS pelo navegador.");
      return;
    }
    const id = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000,
    });
    watchRef.current = id;
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    };
  }, [ready, handlePosition, handleError]);

  const startTrip = () => {
    const now = Date.now();
    const temDestinos = destinos.length > 0;
    const label = temDestinos
      ? destinos.map((d) => d.empresaNome).join(" → ")
      : "Entrega sem identificação";
    const totalValor = temDestinos
      ? destinos.reduce((s, d) => s + (d.valor ?? 0), 0) || null
      : null;

    const trip: Trip = {
      id: `t_${now.toString(36)}`,
      deviceId: deviceId || getDeviceId(),
      label,
      startedAt: now,
      endedAt: null,
      distanceM: 0,
      points: current ? [current] : [],
      startPoint: current,
      endPoint: current,
      baseToEndM: base && current ? haversineM(base, current) : null,
      leftBase: false,
      returnedToBase: false,
      empresaId: temDestinos ? destinos[0]?.empresaId ?? null : null,
      empresaNome: temDestinos ? destinos.map((d) => d.empresaNome).join(", ") : null,
      entregueEm: null,
      valor: totalValor,
      destinos: temDestinos ? destinos : [],
      pendingSync: true,
    };
    persistActive(trip);
    setDestinos([]);
    setBuscaEmpresa("");
    setResultadosBusca([]);
  };

  const finishTrip = () => {
    if (!active) return;
    const finished: Trip = { ...active, endedAt: Date.now() };
    const next = [finished, ...trips];
    setTrips(next);
    saveTrips(next);
    persistActive(null);
    void syncPendingTrips().then((r) => setPending(r.pending));
    setTab("historico");
  };

  const useCurrentAsBase = () => {
    if (!current) {
      setStatus("Aguardando o GPS pegar sua posição. Tente de novo em alguns segundos.");
      return;
    }
    const next: BaseLocation = {
      lat: current.lat,
      lng: current.lng,
      label: base?.label || "Base da operação",
      radiusM: base?.radiusM ?? 150,
      savedAt: Date.now(),
    };
    setBase(next);
    saveBase(next);
    setStatus("Base salva com sua posição atual.");
  };

  const buscarEmpresas = async () => {
    if (buscaEmpresa.trim().length < 2) return;
    setBuscandoEmpresa(true);
    try {
      const res = await buscarLugares(buscaEmpresa);
      setResultadosBusca(res);
    } catch {
      // fallback — filter from local
      setResultadosBusca([]);
    } finally {
      setBuscandoEmpresa(false);
    }
  };

  const adicionarDestino = (empresa: Empresa) => {
    if (destinos.some((d) => d.empresaId === empresa.id)) return;
    setDestinos((prev) => [
      ...prev,
      {
        empresaId: empresa.id,
        empresaNome: empresa.nome,
        endereco: empresa.endereco,
        valor: null,
        lat: empresa.lat,
        lng: empresa.lng,
      },
    ]);
    setBuscaEmpresa("");
    setResultadosBusca([]);
  };

  const removerDestino = (idx: number) => {
    setDestinos((prev) => prev.filter((_, i) => i !== idx));
  };

  const salvarValorDestino = (idx: number, val: string) => {
    const parsed = parseFloat(val.replace(",", "."));
    setDestinos((prev) =>
      prev.map((d, i) =>
        i === idx ? { ...d, valor: isNaN(parsed) ? null : parsed } : d,
      ),
    );
    setEditandoValorIdx(null);
    setValorInput("");
  };

  const elapsed = active ? (active.endedAt ?? Date.now()) - active.startedAt : 0;

  // ── Tela de verificação ──
  if (checandoConvite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
        <div className="space-y-3">
          <div className="text-4xl animate-pulse">🏍️</div>
          <p>Verificando seu acesso…</p>
        </div>
      </div>
    );
  }

  // ── Tela de bloqueio ──
  if (bloqueado) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center">
        <div className="text-6xl">🔒</div>
        <h1 className="text-xl font-bold text-foreground">Acesso Bloqueado</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Seu acesso foi revogado pelo administrador da operação. Entre em contato com a
          central para mais informações.
        </p>
      </div>
    );
  }

  // ── Tela de convite ──
  if (!motoboy) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center">
        <div className="text-6xl">🏍️</div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">KM Motoboy</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          O acesso é liberado apenas pelo link de convite enviado pelo administrador da
          operação. Peça o seu link e abra-o neste celular.
        </p>
        {erroConvite && (
          <p className="max-w-sm rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {erroConvite}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 pt-5 pb-4 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <span className="text-2xl">🏍️</span> KM Motoboy
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{motoboy.nome}</p>
          </div>
          {active && (
            <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-bold text-primary">Em corrida</span>
            </div>
          )}
        </div>
      </header>

      <nav className="sticky top-[69px] z-10 flex gap-1 border-b border-border bg-background/95 backdrop-blur-sm px-2 py-2">
        {(
          [
            ["corrida", "🚴 Corrida"],
            ["historico", "📋 Histórico"],
            ["config", "⚙️ Ajustes"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex-1 rounded-xl px-2 py-2.5 text-xs font-bold transition-all ${
              tab === value
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {text}
          </button>
        ))}
      </nav>

      <main className="space-y-4 px-4 py-5 pb-20">
        {status && (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm animate-in slide-in-from-top-2 duration-200">
            <p className="text-sm text-foreground flex-1">{status}</p>
            <button
              onClick={() => setStatus(null)}
              className="text-muted-foreground hover:text-foreground shrink-0 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* ── Corrida ── */}
        {tab === "corrida" && (
          <TripTab
            active={active}
            base={base}
            current={current}
            empresas={empresas}
            elapsed={elapsed}
            destinos={destinos}
            buscaEmpresa={buscaEmpresa}
            setBuscaEmpresa={setBuscaEmpresa}
            resultadosBusca={resultadosBusca}
            buscandoEmpresa={buscandoEmpresa}
            editandoValorIdx={editandoValorIdx}
            valorInput={valorInput}
            setValorInput={setValorInput}
            setEditandoValorIdx={setEditandoValorIdx}
            onBuscarEmpresas={buscarEmpresas}
            onAdicionarDestino={adicionarDestino}
            onRemoverDestino={removerDestino}
            onSalvarValorDestino={salvarValorDestino}
            onStart={startTrip}
            onFinish={finishTrip}
          />
        )}

        {/* ── Histórico ── */}
        {tab === "historico" && <HistoryTab trips={trips} pending={pending} />}

        {/* ── Ajustes ── */}
        {tab === "config" && (
          <ConfigTab
            base={base}
            current={current}
            deviceId={deviceId}
            pending={pending}
            empresas={empresas}
            onEmpresas={setEmpresas}
            onStatus={setStatus}
            onUseCurrent={useCurrentAsBase}
            onChangeBase={(patch) => {
              if (!base) return;
              const next = { ...base, ...patch };
              setBase(next);
              saveBase(next);
            }}
          />
        )}
      </main>
    </div>
  );
}

/* ══════════════════ TripTab ══════════════════ */

function Stat({ value, text }: { value: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 shadow-sm">
      <p className="text-xl font-bold tabular-nums text-primary">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">{text}</p>
    </div>
  );
}

function TripTab({
  active,
  base,
  current,
  empresas,
  elapsed,
  destinos,
  buscaEmpresa,
  setBuscaEmpresa,
  resultadosBusca,
  buscandoEmpresa,
  editandoValorIdx,
  valorInput,
  setValorInput,
  setEditandoValorIdx,
  onBuscarEmpresas,
  onAdicionarDestino,
  onRemoverDestino,
  onSalvarValorDestino,
  onStart,
  onFinish,
}: {
  active: Trip | null;
  base: BaseLocation | null;
  current: GeoPoint | null;
  empresas: Empresa[];
  elapsed: number;
  destinos: TripDestino[];
  buscaEmpresa: string;
  setBuscaEmpresa: (v: string) => void;
  resultadosBusca: ResultadoBusca[];
  buscandoEmpresa: boolean;
  editandoValorIdx: number | null;
  valorInput: string;
  setValorInput: (v: string) => void;
  setEditandoValorIdx: (i: number | null) => void;
  onBuscarEmpresas: () => void;
  onAdicionarDestino: (e: Empresa) => void;
  onRemoverDestino: (i: number) => void;
  onSalvarValorDestino: (i: number, v: string) => void;
  onStart: () => void;
  onFinish: () => void;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const avgKmh =
    active && elapsed > 5000 ? (active.distanceM / 1000) / (elapsed / 3600000) : 0;

  const [buscaFiltro, setBuscaFiltro] = useState("");
  const empresasFiltradas = useMemo(() => {
    const q = buscaFiltro.toLowerCase();
    return q
      ? empresas.filter(
          (e) =>
            e.nome.toLowerCase().includes(q) ||
            (e.endereco ?? "").toLowerCase().includes(q),
        )
      : empresas;
  }, [empresas, buscaFiltro]);

  const totalValorRota = destinos.reduce((s, d) => s + (d.valor ?? 0), 0);

  return (
    <>
      <MapPanel
        current={current}
        base={base}
        points={active?.points ?? []}
        empresas={
          active?.destinos?.length
            ? empresas.filter((e) =>
                active.destinos!.some((d) => d.empresaId === e.id),
              )
            : empresas
        }
        entregueEmpresaId={active?.empresaId ?? null}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <Stat value={`${formatKm(active?.distanceM ?? 0)} km`} text="Rodados nesta corrida" />
        <Stat value={formatDuration(elapsed)} text="Tempo em corrida" />
        <Stat value={`${avgKmh.toFixed(1).replace(".", ",")} km/h`} text="Velocidade média" />
        <Stat
          value={current?.acc != null ? `±${Math.round(current.acc)} m` : "—"}
          text="Precisão do GPS"
        />
      </div>

      {active ? (
        /* ── Active trip display ── */
        <>
          <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm space-y-2">
            <p className="text-sm font-bold truncate">{active.label}</p>
            <p className="text-xs text-muted-foreground">
              Início às {formatTime(active.startedAt)}
            </p>

            {/* Multi-destination progress */}
            {active.destinos && active.destinos.length > 0 ? (
              <div className="space-y-2 pt-1">
                {active.destinos.map((d, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${
                      d.entregueEm
                        ? "bg-emerald-500/10 border border-emerald-500/20"
                        : "bg-secondary/40 border border-border"
                    }`}
                  >
                    <span className="text-base">{d.entregueEm ? "✅" : "📦"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{d.empresaNome}</p>
                      {d.entregueEm && (
                        <p className="text-muted-foreground">
                          Às {formatTime(d.entregueEm)}
                        </p>
                      )}
                    </div>
                    {d.valor != null && (
                      <span className="font-bold text-primary shrink-0">
                        R$ {d.valor.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              active.entregueEm ? (
                <p className="text-xs font-semibold text-emerald-500">
                  ✅ Entregue em {active.empresaNome} às {formatTime(active.entregueEm)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Monitorando chegada automaticamente…
                </p>
              )
            )}

            {base && (
              <p className="text-xs text-muted-foreground">
                {active.baseToEndM != null
                  ? `${formatKm(active.baseToEndM)} km em linha reta da base`
                  : "Calculando distância da base…"}
                {active.returnedToBase
                  ? " · já voltou à base"
                  : active.leftBase
                    ? " · saiu da base"
                    : " · ainda na base"}
              </p>
            )}
          </div>

          <button
            onClick={onFinish}
            className="w-full rounded-xl bg-destructive px-4 py-5 text-lg font-bold text-destructive-foreground shadow-lg hover:bg-destructive/90 transition-all active:scale-[0.98]"
          >
            Finalizar Corrida
          </button>
        </>
      ) : (
        /* ── Pre-trip: destination selection ── */
        <>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Destinos da Rota</h2>
              {destinos.length > 0 && (
                <span className="text-xs font-bold text-primary">
                  {destinos.length} empresa{destinos.length > 1 ? "s" : ""}
                  {totalValorRota > 0
                    ? ` · R$ ${totalValorRota.toFixed(2)}`
                    : ""}
                </span>
              )}
            </div>

            {/* Destination list */}
            {destinos.length > 0 && (
              <div className="space-y-2">
                {destinos.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5"
                  >
                    <span className="text-base shrink-0">📦</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{d.empresaNome}</p>
                      {editandoValorIdx === i ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-xs text-muted-foreground">R$</span>
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            value={valorInput}
                            onChange={(e) => setValorInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") onSalvarValorDestino(i, valorInput);
                              if (e.key === "Escape") {
                                setEditandoValorIdx(null);
                                setValorInput("");
                              }
                            }}
                            placeholder="0,00"
                            className="w-20 rounded-lg border border-primary bg-card px-2 py-0.5 text-sm font-bold text-primary outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            onClick={() => onSalvarValorDestino(i, valorInput)}
                            className="text-xs font-bold text-primary hover:underline"
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <button
                          onDoubleClick={() => {
                            setEditandoValorIdx(i);
                            setValorInput(d.valor != null ? String(d.valor) : "");
                          }}
                          onClick={() => {
                            setEditandoValorIdx(i);
                            setValorInput(d.valor != null ? String(d.valor) : "");
                          }}
                          className="mt-0.5 text-xs text-left w-full"
                          title="Clique para editar o valor"
                        >
                          {d.valor != null ? (
                            <span className="font-bold text-primary">
                              R$ {d.valor.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              — toque para adicionar valor
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => onRemoverDestino(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors text-lg shrink-0"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* Total row */}
                {destinos.length > 1 && (
                  <div className="flex justify-end pt-1">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                      Total: {totalValorRota > 0 ? `R$ ${totalValorRota.toFixed(2)}` : "—"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Add company to route */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                Buscar Empresa para Adicionar
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  value={buscaFiltro}
                  onChange={(e) => setBuscaFiltro(e.target.value)}
                  placeholder="Filtrar empresas cadastradas…"
                  className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                />
              </div>
              {empresasFiltradas.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {empresasFiltradas.map((e) => {
                    const jaNaRota = destinos.some((d) => d.empresaId === e.id);
                    return (
                      <button
                        key={e.id}
                        onClick={() => !jaNaRota && onAdicionarDestino(e)}
                        disabled={jaNaRota}
                        className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                          jaNaRota
                            ? "border-primary/30 bg-primary/5 opacity-60 cursor-default"
                            : "border-border bg-background hover:border-primary/50 hover:bg-primary/5 active:scale-[0.98]"
                        }`}
                      >
                        <span className="text-base">{jaNaRota ? "✅" : "➕"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{e.nome}</p>
                          {current && (
                            <p className="text-xs text-muted-foreground">
                              {formatKm(haversineM(current, e))} km de você
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {empresas.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Nenhuma empresa cadastrada. Peça ao administrador para cadastrar.
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onStart}
            className="w-full rounded-xl bg-primary px-4 py-5 text-lg font-bold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-[0.98]"
          >
            {destinos.length > 0
              ? `🚀 Iniciar Corrida (${destinos.length} destino${destinos.length > 1 ? "s" : ""})`
              : "🚀 Iniciar Corrida"}
          </button>

          {!base && (
            <p className="text-center text-xs text-muted-foreground">
              Dica: cadastre a base em Ajustes para o app medir a ida e a volta automaticamente.
            </p>
          )}
        </>
      )}
    </>
  );
}

/* ══════════════════ HistoryTab ══════════════════ */

function HistoryTab({ trips, pending }: { trips: Trip[]; pending: number }) {
  const groups = useMemo(() => {
    const map = new Map<string, Trip[]>();
    for (const t of trips) {
      const day = formatDay(t.startedAt);
      map.set(day, [...(map.get(day) ?? []), t]);
    }
    return [...map.entries()];
  }, [trips]);

  const exportCsv = () => {
    const blob = new Blob([tripsToCsv(trips)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "corridas.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (trips.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
        Nenhuma corrida registrada ainda.
      </div>
    );
  }

  const totalM = trips.reduce((s, t) => s + t.distanceM, 0);
  const totalValor = trips.reduce((s, t) => s + (t.valor ?? 0), 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <Stat value={`${formatKm(totalM)} km`} text="Total registrado" />
        <Stat value={String(trips.length)} text="Corridas salvas" />
        {totalValor > 0 && (
          <div className="col-span-2">
            <Stat value={`R$ ${totalValor.toFixed(2)}`} text="Faturamento total" />
          </div>
        )}
      </div>

      <button
        onClick={exportCsv}
        className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm font-semibold hover:bg-accent transition-colors"
      >
        📥 Exportar CSV para acerto
      </button>

      {pending > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {pending} corrida(s) aguardando internet para chegar ao painel do administrador.
        </p>
      )}

      {groups.map(([day, dayTrips]) => (
        <section key={day} className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold">{day}</h2>
            <span className="text-xs text-muted-foreground">
              {formatKm(dayTrips.reduce((s, t) => s + t.distanceM, 0))} km
            </span>
          </div>
          {dayTrips.map((t) => {
            const temDestinos = t.destinos && t.destinos.length > 0;
            return (
              <article key={t.id} className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{t.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatTime(t.startedAt)}
                      {t.endedAt ? ` – ${formatTime(t.endedAt)}` : ""} ·{" "}
                      {formatDuration((t.endedAt ?? t.startedAt) - t.startedAt)}
                      {t.baseToEndM != null
                        ? ` · ${formatKm(t.baseToEndM)} km da base`
                        : ""}
                    </p>
                    {temDestinos ? (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {t.destinos!.map((d, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              d.entregueEm
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : "bg-secondary text-secondary-foreground"
                            }`}
                          >
                            {d.entregueEm ? "✓" : "·"} {d.empresaNome}
                            {d.valor != null && ` (R$ ${d.valor.toFixed(2)})`}
                          </span>
                        ))}
                      </div>
                    ) : (
                      t.entregueEm && (
                        <p className="mt-1 text-xs font-semibold text-emerald-500">
                          ✓ Entregue em {t.empresaNome} às {formatTime(t.entregueEm)}
                        </p>
                      )
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums text-primary">
                      {formatKm(t.distanceM)} km
                    </p>
                    <p className="text-sm font-bold text-emerald-500 mt-0.5">
                      {t.valor != null ? `R$ ${t.valor.toFixed(2)}` : "—"}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ))}
    </>
  );
}

/* ══════════════════ ConfigTab ══════════════════ */

function ConfigTab({
  base,
  current,
  deviceId,
  pending,
  empresas,
  onEmpresas,
  onStatus,
  onUseCurrent,
  onChangeBase,
}: {
  base: BaseLocation | null;
  current: GeoPoint | null;
  deviceId: string;
  pending: number;
  empresas: Empresa[];
  onEmpresas: (list: Empresa[]) => void;
  onStatus: (msg: string | null) => void;
  onUseCurrent: () => void;
  onChangeBase: (patch: Partial<BaseLocation>) => void;
}) {
  return (
    <>
      <section className="space-y-4 rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
        <h2 className="text-sm font-bold">🏠 Base fixa da operação</h2>
        <button
          onClick={onUseCurrent}
          className="w-full rounded-xl bg-accent px-4 py-4 text-sm font-bold text-accent-foreground hover:bg-accent/80 transition-all active:scale-[0.98]"
        >
          📍 Usar minha posição atual como base
        </button>
        {base ? (
          <>
            <label className="block">
              <span className="text-xs text-muted-foreground">Nome da base</span>
              <input
                value={base.label}
                onChange={(e) => onChangeBase({ label: e.target.value })}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">
                Raio da base: {base.radiusM} m
              </span>
              <input
                type="range"
                min={50}
                max={500}
                step={10}
                value={base.radiusM}
                onChange={(e) => onChangeBase({ radiusM: Number(e.target.value) })}
                className="mt-2 w-full accent-primary"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {base.lat.toFixed(5)}, {base.lng.toFixed(5)} · salvo em {formatDay(base.savedAt)}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nenhuma base cadastrada. Com a base salva, o app marca a saída e o retorno automaticamente.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
        <h2 className="text-sm font-bold">📡 Aparelho e envio</h2>
        <p className="text-xs text-muted-foreground">ID do aparelho: {deviceId || "—"}</p>
        <p className="text-xs text-muted-foreground">
          Posição atual:{" "}
          {current
            ? `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}`
            : "aguardando GPS"}
        </p>
        <p className="text-xs text-muted-foreground">{pending} corrida(s) pendentes de envio</p>
      </section>
    </>
  );
}
