import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addEmpresa, buscarEnderecoPorCoordenadas } from "@/lib/empresas";
import type { Empresa } from "@/lib/empresas";

type Props = {
  open: boolean;
  initialLat?: number;
  initialLng?: number;
  onClose: () => void;
  onSaved: (empresa: Empresa) => void;
};

export default function CompanyLocationPickerModal({
  open,
  initialLat,
  initialLng,
  onClose,
  onSaved,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [lat, setLat] = useState<number | null>(initialLat ?? null);
  const [lng, setLng] = useState<number | null>(initialLng ?? null);
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [raio, setRaio] = useState(200);
  const [buscandoEnd, setBuscandoEnd] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pinIcon = L.divIcon({
    className: "",
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path d="M16 0C7.163 0 0 7.163 0 16c0 10.5 16 24 16 24s16-13.5 16-24C32 7.163 24.837 0 16 0z" fill="#3b82f6" stroke="#1d4ed8" stroke-width="1.5"/>
      <circle cx="16" cy="16" r="7" fill="white" fill-opacity="0.95"/>
      <circle cx="16" cy="16" r="4" fill="#3b82f6"/>
    </svg>`,
  });

  const updateMarker = useCallback(
    (lat: number, lng: number) => {
      const map = mapRef.current;
      if (!map) return;
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { icon: pinIcon, draggable: true })
          .addTo(map)
          .on("dragend", (e: L.LeafletEvent) => {
            const pos = (e as L.DragEndEvent).target.getLatLng();
            setLat(pos.lat);
            setLng(pos.lng);
            void fetchEndereco(pos.lat, pos.lng);
          });
      }
      map.setView([lat, lng], 17, { animate: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fetchEndereco = async (lat: number, lng: number) => {
    setBuscandoEnd(true);
    try {
      const end = await buscarEnderecoPorCoordenadas(lat, lng);
      if (end) setEndereco(end);
    } finally {
      setBuscandoEnd(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // defer map init so the modal is rendered
    const timer = setTimeout(() => {
      if (!containerRef.current || mapRef.current) return;
      const center: [number, number] = [
        lat ?? -15.7801,
        lng ?? -47.9292,
      ];
      const map = L.map(containerRef.current, {
        center,
        zoom: lat ? 17 : 13,
        zoomControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      mapRef.current = map;

      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        setLat(lat);
        setLng(lng);
        updateMarker(lat, lng);
        void fetchEndereco(lat, lng);
      });

      if (lat && lng) {
        updateMarker(lat, lng);
        void fetchEndereco(lat, lng);
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // cleanup on close
  useEffect(() => {
    if (!open && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
      setLat(initialLat ?? null);
      setLng(initialLng ?? null);
      setNome("");
      setEndereco("");
      setRaio(200);
      setErro(null);
    }
  }, [open, initialLat, initialLng]);

  const salvar = async () => {
    if (!lat || !lng) {
      setErro("Clique no mapa para fixar a localização da empresa.");
      return;
    }
    if (!nome.trim()) {
      setErro("Digite o nome da empresa.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const lista = await addEmpresa({
        nome: nome.trim(),
        endereco: endereco || null,
        lat,
        lng,
        raioM: raio,
      });
      const nova = lista.find((e) => e.nome === nome.trim());
      if (nova) onSaved(nova);
      onClose();
    } catch {
      setErro("Não foi possível salvar a empresa. Verifique a internet.");
    } finally {
      setSalvando(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative z-10 w-full sm:max-w-xl bg-card border border-border rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">📍 Marcar Localização no Mapa</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Clique no mapa para fixar o pino da empresa
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 hover:bg-accent transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Map */}
        <div
          ref={containerRef}
          className="w-full shrink-0"
          style={{ height: 280 }}
        />

        {/* Coordinates display */}
        {lat && lng && (
          <div className="px-5 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center gap-2 shrink-0">
            <span className="text-xs text-blue-400 font-mono">
              {lat.toFixed(6)}, {lng.toFixed(6)}
            </span>
            {buscandoEnd && (
              <span className="text-xs text-muted-foreground animate-pulse">
                buscando endereço…
              </span>
            )}
          </div>
        )}

        {/* Form */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              Nome da Empresa *
            </label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Retífica São Jorge"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
              Endereço (preenchido automaticamente)
            </label>
            <input
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Aguardando seleção no mapa…"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
              Raio de chegada automática:{" "}
              <span className="text-primary font-bold">{raio}m</span>
            </label>
            <input
              type="range"
              min={50}
              max={500}
              step={25}
              value={raio}
              onChange={(e) => setRaio(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>50m (preciso)</span>
              <span>500m (amplo)</span>
            </div>
          </div>

          {erro && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {erro}
            </p>
          )}

          {!lat && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                👆 Clique em qualquer ponto do mapa para marcar a localização
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 pt-3 border-t border-border flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando || !lat || !lng}
            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20"
          >
            {salvando ? "Salvando…" : "Salvar Empresa"}
          </button>
        </div>
      </div>
    </div>
  );
}
