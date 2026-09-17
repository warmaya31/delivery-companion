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
      L.circleMarker([current.lat, current.lng], {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: "#facc15",
        fillOpacity: 1,
      })
        .addTo(layer)
        .bindTooltip("Você está aqui");

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
