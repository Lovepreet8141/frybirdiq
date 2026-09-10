"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";

export interface Point {
  lat: number;
  lng: number;
}

/**
 * An OpenStreetMap map.
 *
 * Plain Leaflet rather than a React wrapper: one dependency instead of two,
 * and no waiting on a wrapper to catch up with a React release. OSM tiles need
 * no API key, no billing account and no usage cap — which is why this works
 * today rather than after someone sets up a Google Cloud project.
 *
 * Leaflet is imported inside an effect, not at module scope. It touches
 * `window` on import, and a "use client" module is still rendered on the
 * server for the initial HTML.
 */
export function Map({
  centre,
  pin,
  shop,
  onPinChange,
  className,
}: {
  centre: Point;
  /** The customer's pin. Draggable when `onPinChange` is given. */
  pin?: Point | null;
  /** The outlet, shown for context. Never draggable. */
  shop?: Point | null;
  onPinChange?: (point: Point) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  // The callback is held in a ref so a re-render with a new closure does not
  // tear down and rebuild the map. Synced in an effect, not during render —
  // mutating a ref while rendering is not safe under concurrent rendering,
  // where a render can be thrown away and re-run.
  const onChange = useRef(onPinChange);
  useEffect(() => {
    onChange.current = onPinChange;
  }, [onPinChange]);

  useEffect(() => {
    let cancelled = false;
    let instance: LeafletMap | null = null;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !container.current || map.current) return;

      instance = L.map(container.current, {
        center: [centre.lat, centre.lng],
        zoom: 16,
        // A map that eats the page scroll is infuriating on a phone. Zoom by
        // pinch or by the buttons; the page keeps scrolling.
        scrollWheelZoom: false,
        attributionControl: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        // Required by the OSM tile usage policy.
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance);

      const dot = (colour: string, label: string) =>
        L.divIcon({
          className: "",
          html: `<span aria-hidden="true" style="display:block;width:18px;height:18px;border-radius:9999px;background:${colour};border:3px solid #F5EDD8;box-shadow:0 2px 6px rgba(0,0,0,.5)" title="${label}"></span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });

      if (shop) {
        L.marker([shop.lat, shop.lng], { icon: dot("#C21F11", "FRYBIRD"), interactive: false })
          .addTo(instance)
          .bindTooltip("FRYBIRD", { permanent: false });
      }

      if (pin) {
        pinMarker.current = L.marker([pin.lat, pin.lng], {
          icon: dot("#F2A324", "Your location"),
          draggable: Boolean(onChange.current),
          keyboard: true,
        }).addTo(instance);

        pinMarker.current.on("dragend", () => {
          const position = pinMarker.current?.getLatLng();
          if (position) onChange.current?.({ lat: position.lat, lng: position.lng });
        });
      }

      // Tapping the map moves the pin. Dragging a small marker with a thumb is
      // fiddly; tapping where you live is not.
      if (onChange.current) {
        instance.on("click", (event) => {
          const { lat, lng } = event.latlng;
          if (pinMarker.current) pinMarker.current.setLatLng([lat, lng]);
          onChange.current?.({ lat, lng });
        });
      }

      map.current = instance;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
      pinMarker.current = null;
    };
    // Built once. Position updates are pushed through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker in step when the pin changes from outside — the "use my
  // location" button, or a restored draft. Depends on the two numbers rather
  // than the object, so a caller passing a fresh object literal each render
  // does not re-pan the map on every keystroke elsewhere in the form.
  const pinLat = pin?.lat;
  const pinLng = pin?.lng;
  useEffect(() => {
    if (!ready || pinLat === undefined || pinLng === undefined) return;
    if (!pinMarker.current || !map.current) return;
    pinMarker.current.setLatLng([pinLat, pinLng]);
    map.current.panTo([pinLat, pinLng]);
  }, [ready, pinLat, pinLng]);

  return (
    <div
      ref={container}
      className={cn("h-64 w-full overflow-hidden rounded-lg border border-border bg-surface-muted", className)}
      // Leaflet renders an interactive canvas of its own; the surrounding UI
      // carries the accessible controls.
      role="application"
      aria-label="Map"
    />
  );
}
