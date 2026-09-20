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
  online: boolean;
  desdeTexto: string;
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
      const cor = m.online ? (m.emCorrida ? "#2563eb" : "#16a34a") : "#6b7280";
      const iconHtml = `
        <div class="relative flex h-10 w-10 items-center justify-center" style="${m.online ? "" : "opacity:0.65"}">
          ${m.online && m.emCorrida ? '<div class="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-30"></div>' : ''}
          <div class="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-md" style="background:${cor}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1 .4-1 1v10H2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
          </div>
        </div>
      `;
      const motoboyIcon = L.divIcon({
        html: iconHtml,
        className: "",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      L.marker([m.lat, m.lng], { icon: motoboyIcon })
        .addTo(layer)
        .bindTooltip(
          `${m.nome} · ${m.online ? `ao vivo · ${m.quando}` : `inativo há ${m.desdeTexto}`}`,
          {
            permanent: true,
            direction: "top",
            offset: [0, -16],
            className: "bg-background text-foreground border-border font-semibold shadow-sm rounded-md",
          },
        );
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
