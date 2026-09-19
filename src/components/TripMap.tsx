import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { BaseLocation, GeoPoint } from "@/lib/trips";
import type { Empresa } from "@/lib/empresas";

type Props = {
  current: GeoPoint | null;
  base: BaseLocation | null;
  points: GeoPoint[];
  empresas?: Empresa[];
  /** empresa já marcada como entregue nesta corrida */
  entregueEmpresaId?: string | null;
};

export default function TripMap({
  current,
  base,
  points,
  empresas = [],
  entregueEmpresaId = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const followedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [current?.lat ?? base?.lat ?? -23.55, current?.lng ?? base?.lng ?? -46.63],
      zoom: current || base ? 16 : 11,
      zoomControl: true,
      attributionControl: true,
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

    if (base) {
      L.circle([base.lat, base.lng], {
        radius: base.radiusM,
        color: "#34d399",
        weight: 2,
        fillOpacity: 0.12,
      })
        .addTo(layer)
        .bindTooltip(base.label);
      L.circleMarker([base.lat, base.lng], {
        radius: 6,
        color: "#34d399",
        fillColor: "#34d399",
        fillOpacity: 1,
      }).addTo(layer);
    }

    for (const e of empresas) {
      const entregue = entregueEmpresaId === e.id;
      const cor = entregue ? "#22c55e" : "#60a5fa";
      L.circle([e.lat, e.lng], {
        radius: e.raioM,
        color: cor,
        weight: 1,
        dashArray: "4 4",
        fillOpacity: 0.08,
      }).addTo(layer);
      L.circleMarker([e.lat, e.lng], {
        radius: 7,
        color: "#0b1220",
        weight: 2,
        fillColor: cor,
        fillOpacity: 1,
      })
        .addTo(layer)
        .bindTooltip(entregue ? `${e.nome} — entregue` : e.nome, { permanent: entregue });
    }

    if (points.length > 1) {
      L.polyline(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { color: "#facc15", weight: 5, opacity: 0.9 },
      ).addTo(layer);
    }

    if (current) {
      const iconHtml = `
        <div class="relative flex h-10 w-10 items-center justify-center">
          <div class="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-30"></div>
          <div class="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 shadow-md">
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

      L.marker([current.lat, current.lng], { icon: motoboyIcon })
        .addTo(layer)
        .bindTooltip("Você está aqui", { permanent: false, direction: "top", offset: [0, -16], className: "bg-background text-foreground border-border font-semibold shadow-sm rounded-md" });

      if (!followedRef.current) {
        map.setView([current.lat, current.lng], 16);
        followedRef.current = true;
      } else if (!map.getBounds().pad(-0.25).contains([current.lat, current.lng])) {
        map.panTo([current.lat, current.lng]);
      }
    }
  }, [current, base, points, empresas, entregueEmpresaId]);

  return (
    <div
      ref={containerRef}
      className="h-64 w-full overflow-hidden rounded-xl border border-border bg-muted"
      aria-label="Mapa da corrida"
    />
  );
}
