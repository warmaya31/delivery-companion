import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { syncPendingTrips } from "@/lib/sync";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KM Motoboy — contador de km offline para entregas" },
      {
        name: "description",
        content:
          "Registre entregas e conte os km rodados pelo GPS, mesmo sem internet. Base fixa da operação, histórico do dia e exportação em CSV.",
      },
      { property: "og:title", content: "KM Motoboy — contador de km offline para entregas" },
      {
        property: "og:description",
        content:
          "Inicie a corrida, o app conta os km pelo GPS e salva tudo no celular. Funciona offline.",
      },
    ],
  }),
  component: Index,
});

type Tab = "corrida" | "historico" | "config";

function Index() {
  const [tab, setTab] = useState<Tab>("corrida");
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [base, setBase] = useState<BaseLocation | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [active, setActive] = useState<Trip | null>(null);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [current, setCurrent] = useState<GeoPoint | null>(null);
  const [pending, setPending] = useState(0);

  const watchRef = useRef<number | null>(null);
  const activeRef = useRef<Trip | null>(null);
  const baseRef = useRef<BaseLocation | null>(null);

  activeRef.current = active;
  baseRef.current = base;

  // Carrega tudo do aparelho (nunca durante o render)
  useEffect(() => {
    setDeviceId(getDeviceId());
    setBase(loadBase());
    setTrips(loadTrips());
    setActive(loadActiveTrip());
    setReady(true);
    void syncPendingTrips().then((r) => setPending(r.pending));
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

    const updated: Trip = {
      ...trip,
      points,
      distanceM,
      startPoint: trip.startPoint ?? point,
      endPoint: point,
      baseToEndM: b ? haversineM(b, point) : null,
      leftBase,
      returnedToBase,
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
    setPending((p) => p + 1);
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">KM Motoboy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conta os km pelo GPS e salva no próprio celular — funciona sem internet.
        </p>
      </header>

      <nav className="sticky top-0 z-10 flex gap-1 border-b border-border bg-background px-2 py-2">
        {(
          [
            ["corrida", "Corrida"],
            ["historico", "Histórico"],
            ["config", "Configurações"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
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
            elapsed={elapsed}
            label={label}
            onLabel={setLabel}
            onStart={startTrip}
            onFinish={finishTrip}
          />
        )}

        {tab === "historico" && (
          <HistoryTab trips={trips} pending={pending} />
        )}

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
  elapsed,
  label,
  onLabel,
  onStart,
  onFinish,
}: {
  active: Trip | null;
  base: BaseLocation | null;
  current: GeoPoint | null;
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

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat value={`${formatKm(active?.distanceM ?? 0)} km`} text="Rodados nesta corrida" />
        <Stat value={formatDuration(elapsed)} text="Tempo em corrida" />
        <Stat value={`${avgKmh.toFixed(1).replace(".", ",")} km/h`} text="Velocidade média" />
        <Stat
          value={
            current?.acc != null ? `±${Math.round(current.acc)} m` : "—"
          }
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
              Dica: cadastre a base da operação em Configurações para o app medir a
              ida e a volta automaticamente.
            </p>
          )}
        </>
      )}
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
          {pending} corrida(s) aguardando envio para o painel — serão enviadas quando o
          login do administrador for ativado.
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
            <article
              key={t.id}
              className="rounded-xl border border-border bg-card px-4 py-3"
            >
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
        <p className="text-xs text-muted-foreground">
          {pending} corrida(s) guardada(s) no celular esperando o painel do administrador.
        </p>
      </section>
    </>
  );
}
