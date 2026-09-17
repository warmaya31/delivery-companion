import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { Empresa } from "@/lib/empresas";

export type MotoboyMarcador = {
  deviceId: string;
  nome: string;
  lat: number;
  lng: number;
  emCorrida: boolean;
  quando: string;
};

export type EntregaMarcador = {
  id: string;
  empresaNome: string;
  lat: number;
  lng: number;
  quando: string;
};

type Props = {
  motoboys: MotoboyMarcador[];
  empresas: Empresa[];
  entregas: EntregaMarcador[];
};

export default function AdminMap({ motoboys, empresas, entregas }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const ajustadoRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [-23.55, -46.63],
      zoom: 11,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pontos: [number, number][] = [];

    for (const e of empresas) {
      pontos.push([e.lat, e.lng]);
      L.circle([e.lat, e.lng], {
        radius: e.raioM,
        color: "#60a5fa",
        weight: 1,
        dashArray: "4 4",
        fillOpacity: 0.08,
      }).addTo(layer);
      L.circleMarker([e.lat, e.lng], {
        radius: 6,
        color: "#0b1220",
        weight: 2,
        fillColor: "#60a5fa",
        fillOpacity: 1,
      })
        .addTo(layer)
        .bindTooltip(e.nome);
    }

    for (const d of entregas) {
      pontos.push([d.lat, d.lng]);
      L.circleMarker([d.lat, d.lng], {
        radius: 9,
        color: "#0b1220",
        weight: 2,
        fillColor: "#22c55e",
        fillOpacity: 1,
      })
        .addTo(layer)
        .bindTooltip(`Entregue: ${d.empresaNome} · ${d.quando}`, { permanent: false });
    }

    for (const m of motoboys) {
      pontos.push([m.lat, m.lng]);
      L.circleMarker([m.lat, m.lng], {
        radius: 9,
        color: "#ffffff",
        weight: 2,
        fillColor: m.emCorrida ? "#facc15" : "#94a3b8",
        fillOpacity: 1,
      })
        .addTo(layer)
        .bindTooltip(`${m.nome} · ${m.quando}`, { permanent: true, direction: "top" });
    }

    if (!ajustadoRef.current && pontos.length > 0) {
      map.fitBounds(L.latLngBounds(pontos).pad(0.3), { maxZoom: 15 });
      ajustadoRef.current = true;
    }
  }, [motoboys, empresas, entregas]);

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-xl border border-border bg-muted"
      aria-label="Mapa dos motoboys e entregas"
    />
  );
}
