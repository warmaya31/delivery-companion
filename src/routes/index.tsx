import { ClientOnly, Link, createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/")({
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
});

type Tab = "corrida" | "empresas" | "historico" | "config";

function Index() {
  const [tab, setTab] = useState<Tab>("corrida");
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [base, setBase] = useState<BaseLocation | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [active, setActive] = useState<Trip | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [current, setCurrent] = useState<GeoPoint | null>(null);
  const [pending, setPending] = useState(0);
  const [motoboy, setMotoboy] = useState<MotoboyLocal | null>(null);
  const [checandoConvite, setChecandoConvite] = useState(true);
  const [erroConvite, setErroConvite] = useState<string | null>(null);

  const watchRef = useRef<number | null>(null);
  const activeRef = useRef<Trip | null>(null);
  const baseRef = useRef<BaseLocation | null>(null);
  const empresasRef = useRef<Empresa[]>([]);

  activeRef.current = active;
  baseRef.current = base;
  empresasRef.current = empresas;

  // Carrega tudo do aparelho (nunca durante o render)
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

    // Reconhece sozinho a chegada em uma empresa cadastrada
    let empresaId = trip.empresaId ?? null;
    let empresaNome = trip.empresaNome ?? null;
    let entregueEm = trip.entregueEm ?? null;
    if (!entregueEm) {
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

  // Rastreamento contínuo enquanto o app estiver aberto
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
    const trip: Trip = {
      id: `t_${now.toString(36)}`,
      deviceId: deviceId || getDeviceId(),
      label: label.trim() || "Entrega sem identificação",
      startedAt: now,
      endedAt: null,
      distanceM: 0,
      points: current ? [current] : [],
      startPoint: current,
      endPoint: current,
      baseToEndM: base && current ? haversineM(base, current) : null,
      leftBase: false,
      returnedToBase: false,
      empresaId: null,
      empresaNome: null,
      entregueEm: null,
      pendingSync: true,
    };
    persistActive(trip);
    setLabel("");
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

  const elapsed = active ? (active.endedAt ?? Date.now()) - active.startedAt : 0;

  if (checandoConvite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
        Verificando seu acesso…
      </div>
    );
  }

  if (!motoboy) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">KM Motoboy</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          O acesso é liberado apenas pelo link de convite enviado pelo administrador da operação.
          Peça o seu link e abra-o neste celular.
        </p>
        {erroConvite && (
          <p className="max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
            {erroConvite}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">KM Motoboy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {motoboy.nome} — conta os km pelo GPS e confirma sozinho a chegada na empresa.
        </p>
      </header>


      <nav className="sticky top-0 z-10 flex gap-1 border-b border-border bg-background px-2 py-2">
        {(
          [
            ["corrida", "Corrida"],
            ["empresas", "Empresas"],
            ["historico", "Histórico"],
            ["config", "Ajustes"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex-1 rounded-md px-2 py-2 text-xs font-semibold transition-colors ${
              tab === value
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground"
            }`}
          >
            {text}
          </button>
        ))}
      </nav>

      <main className="space-y-4 px-4 py-5 pb-16">
        {status && (
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            {status}
          </p>
        )}

        {tab === "corrida" && (
          <TripTab
            active={active}
            base={base}
            current={current}
            empresas={empresas}
            elapsed={elapsed}
            label={label}
            onLabel={setLabel}
            onStart={startTrip}
            onFinish={finishTrip}
          />
        )}

        {tab === "empresas" && (
          <EmpresasTab
            empresas={empresas}
            current={current}
            onChange={setEmpresas}
            onStatus={setStatus}
          />
        )}

        {tab === "historico" && <HistoryTab trips={trips} pending={pending} />}

        {tab === "config" && (
          <ConfigTab
            base={base}
            current={current}
            deviceId={deviceId}
            pending={pending}
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

function Stat({ value, text }: { value: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function TripTab({
  active,
  base,
  current,
  empresas,
  elapsed,
  label,
  onLabel,
  onStart,
  onFinish,
}: {
  active: Trip | null;
  base: BaseLocation | null;
  current: GeoPoint | null;
  empresas: Empresa[];
  elapsed: number;
  label: string;
  onLabel: (v: string) => void;
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

  const proxima = useMemo(() => {
    if (!current || empresas.length === 0) return null;
    const ordenadas = empresas
      .map((e) => ({ e, d: haversineM(current, e) }))
      .sort((a, b) => a.d - b.d);
    return ordenadas[0] ?? null;
  }, [current, empresas]);

  return (
    <>
      <MapPanel
        current={current}
        base={base}
        points={active?.points ?? []}
        empresas={empresas}
        entregueEmpresaId={active?.empresaId ?? null}
      />
      <div className="grid grid-cols-2 gap-3">
        <Stat value={`${formatKm(active?.distanceM ?? 0)} km`} text="Rodados nesta corrida" />
        <Stat value={formatDuration(elapsed)} text="Tempo em corrida" />
        <Stat value={`${avgKmh.toFixed(1).replace(".", ",")} km/h`} text="Velocidade média" />
        <Stat
          value={current?.acc != null ? `±${Math.round(current.acc)} m` : "—"}
          text="Precisão do GPS"
        />
      </div>

      {active ? (
        <>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-sm font-semibold">{active.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Início às {formatTime(active.startedAt)}
            </p>
            {active.entregueEm ? (
              <p className="mt-2 text-xs font-semibold text-accent">
                Entregue em {active.empresaNome} às {formatTime(active.entregueEm)}
              </p>
            ) : proxima ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Empresa mais próxima: {proxima.e.nome} · {formatKm(proxima.d)} km
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Cadastre empresas para o app confirmar a entrega sozinho.
              </p>
            )}
            {base && (
              <p className="mt-2 text-xs text-muted-foreground">
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
            className="w-full rounded-xl bg-destructive px-4 py-5 text-lg font-bold text-destructive-foreground"
          >
            Finalizar corrida
          </button>
        </>
      ) : (
        <>
          <label className="block">
            <span className="text-sm text-muted-foreground">
              Identificação da entrega (opcional)
            </span>
            <input
              value={label}
              onChange={(e) => onLabel(e.target.value)}
              placeholder="Nº do pedido ou cliente"
              className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <button
            onClick={onStart}
            className="w-full rounded-xl bg-primary px-4 py-5 text-lg font-bold text-primary-foreground"
          >
            Iniciar corrida
          </button>
          {!base && (
            <p className="text-xs text-muted-foreground">
              Dica: cadastre a base da operação em Ajustes para o app medir a ida e a volta
              automaticamente.
            </p>
          )}
        </>
      )}
    </>
  );
}

function EmpresasTab({
  empresas,
  current,
  onChange,
  onStatus,
}: {
  empresas: Empresa[];
  current: GeoPoint | null;
  onChange: (list: Empresa[]) => void;
  onStatus: (msg: string | null) => void;
}) {
  const [nome, setNome] = useState("");
  const [raio, setRaio] = useState(200);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  const cadastrarAqui = async () => {
    if (!current) {
      onStatus("Aguardando o GPS pegar sua posição.");
      return;
    }
    const lista = await addEmpresa({
      nome: nome || "Empresa",
      lat: current.lat,
      lng: current.lng,
      raioM: raio,
    });
    onChange(lista);
    setNome("");
    onStatus("Empresa cadastrada nesta localização.");
  };

  const procurar = async () => {
    setBuscando(true);
    onStatus(null);
    try {
      setResultados(await buscarLugares(busca));
    } catch {
      onStatus("Não foi possível buscar agora. Sem internet? Cadastre pela sua posição.");
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
      raioM: raio,
    });
    onChange(lista);
    setResultados([]);
    setBusca("");
    onStatus(`${r.nome} cadastrada. A entrega será marcada sozinha na chegada.`);
  };

  return (
    <>
      <section className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
        <h2 className="text-sm font-semibold">Buscar empresa pelo nome ou endereço</h2>
        <div className="flex gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Ex.: Retífica São Jorge, Rua X, 100"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={procurar}
            disabled={buscando || busca.trim().length < 3}
            className="rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {buscando ? "…" : "Buscar"}
          </button>
        </div>
        {resultados.map((r, i) => (
          <button
            key={`${r.lat}-${r.lng}-${i}`}
            onClick={() => void salvarResultado(r)}
            className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-left"
          >
            <span className="block text-sm font-semibold">{r.nome}</span>
            <span className="block text-xs text-muted-foreground">{r.endereco}</span>
          </button>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
        <h2 className="text-sm font-semibold">Cadastrar onde você está</h2>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome da mecânica ou retífica"
          className="w-full rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
        />
        <label className="block">
          <span className="text-xs text-muted-foreground">
            Distância que conta como chegada: {raio} m
          </span>
          <input
            type="range"
            min={50}
            max={600}
            step={10}
            value={raio}
            onChange={(e) => setRaio(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </label>
        <button
          onClick={() => void cadastrarAqui()}
          className="w-full rounded-lg bg-accent px-4 py-4 text-base font-bold text-accent-foreground"
        >
          Usar minha posição atual
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Empresas cadastradas ({empresas.length})</h2>
        {empresas.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
            Nenhuma empresa cadastrada. Depois de cadastrar, o app reconhece a chegada pela
            localização, sem você precisar escolher nada.
          </p>
        ) : (
          empresas.map((e) => (
            <article
              key={e.id}
              className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold">{e.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {e.endereco ?? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`} · chegada em{" "}
                  {e.raioM} m
                  {current ? ` · ${formatKm(haversineM(current, e))} km de você` : ""}
                </p>
              </div>
              <button
                onClick={() => onChange(removeEmpresa(e.id))}
                className="text-xs text-muted-foreground underline"
              >
                Apagar
              </button>
            </article>
          ))
        )}
      </section>
    </>
  );
}

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
      <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        Nenhuma corrida registrada ainda.
      </p>
    );
  }

  const totalM = trips.reduce((s, t) => s + t.distanceM, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat value={`${formatKm(totalM)} km`} text="Total registrado" />
        <Stat value={String(trips.length)} text="Corridas salvas" />
      </div>
      <button
        onClick={exportCsv}
        className="w-full rounded-lg border border-input bg-card px-4 py-3 text-sm font-semibold"
      >
        Exportar CSV para acerto
      </button>
      {pending > 0 && (
        <p className="text-xs text-muted-foreground">
          {pending} corrida(s) aguardando internet para chegar ao painel do administrador.
        </p>
      )}
      {groups.map(([day, dayTrips]) => (
        <section key={day} className="space-y-2">
          <h2 className="flex items-baseline justify-between text-sm font-semibold">
            <span>{day}</span>
            <span className="text-muted-foreground">
              {formatKm(dayTrips.reduce((s, t) => s + t.distanceM, 0))} km
            </span>
          </h2>
          {dayTrips.map((t) => (
            <article key={t.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{t.label}</p>
                <p className="text-sm font-bold tabular-nums">{formatKm(t.distanceM)} km</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTime(t.startedAt)}
                {t.endedAt ? ` – ${formatTime(t.endedAt)}` : ""} ·{" "}
                {formatDuration((t.endedAt ?? t.startedAt) - t.startedAt)}
                {t.baseToEndM != null ? ` · ${formatKm(t.baseToEndM)} km da base` : ""}
              </p>
              {t.entregueEm && (
                <p className="mt-1 text-xs font-semibold text-accent">
                  Entregue em {t.empresaNome} às {formatTime(t.entregueEm)}
                </p>
              )}
            </article>
          ))}
        </section>
      ))}
    </>
  );
}

function ConfigTab({
  base,
  current,
  deviceId,
  pending,
  onUseCurrent,
  onChangeBase,
}: {
  base: BaseLocation | null;
  current: GeoPoint | null;
  deviceId: string;
  pending: number;
  onUseCurrent: () => void;
  onChangeBase: (patch: Partial<BaseLocation>) => void;
}) {
  return (
    <>
      <section className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
        <h2 className="text-sm font-semibold">Base fixa da operação</h2>
        <button
          onClick={onUseCurrent}
          className="w-full rounded-lg bg-accent px-4 py-4 text-base font-bold text-accent-foreground"
        >
          Usar minha posição atual como base
        </button>
        {base ? (
          <>
            <label className="block">
              <span className="text-xs text-muted-foreground">Nome da base</span>
              <input
                value={base.label}
                onChange={(e) => onChangeBase({ label: e.target.value })}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
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
              Ponto salvo: {base.lat.toFixed(5)}, {base.lng.toFixed(5)} · salvo em{" "}
              {formatDay(base.savedAt)}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nenhuma base cadastrada. Com a base salva, o app marca sozinho a saída e o
            retorno, sem precisar selecionar nada.
          </p>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card px-4 py-4">
        <h2 className="text-sm font-semibold">Aparelho e envio</h2>
        <p className="text-xs text-muted-foreground">Identificação: {deviceId || "—"}</p>
        <p className="text-xs text-muted-foreground">
          Posição atual:{" "}
          {current ? `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}` : "aguardando GPS"}
        </p>
        <p className="text-xs text-muted-foreground">{pending} corrida(s) salvas</p>
      </section>
    </>
  );
}
