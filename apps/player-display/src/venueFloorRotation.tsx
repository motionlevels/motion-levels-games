import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const floorRotationDegrees = [0, 90, 180, 270] as const;
type FloorRotationDegrees = typeof floorRotationDegrees[number];

type VenueClientConfig = {
  floorRotationDegrees?: unknown;
};

const VenueFloorRotationContext = createContext<FloorRotationDegrees>(0);

function normalizeFloorRotationDegrees(value: unknown): FloorRotationDegrees {
  const numeric = typeof value === "string" ? Number(value.trim()) : value;
  return numeric === 90 || numeric === 180 || numeric === 270 ? numeric : 0;
}

export function floorRotationFromSearch(search: string): FloorRotationDegrees | null {
  const value = new URLSearchParams(search).get("floorRotation");
  if (value === null) return null;
  const normalized = normalizeFloorRotationDegrees(value);
  return floorRotationDegrees.some((candidate) => String(candidate) === value.trim())
    ? normalized
    : null;
}

export function floorRotationFromVenueConfig(config: VenueClientConfig): FloorRotationDegrees {
  return normalizeFloorRotationDegrees(config.floorRotationDegrees);
}

export function VenueFloorRotationProvider({ children }: { children?: ReactNode }) {
  const queryRotation = floorRotationFromSearch(window.location.search);
  const [rotation, setRotation] = useState<FloorRotationDegrees>(queryRotation ?? 0);

  useEffect(() => {
    if (queryRotation !== null) return;
    let cancelled = false;
    const configURL = new URL("venue-config.json", window.location.href);
    void fetch(configURL, { cache: "no-store", credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`venue config failed: ${response.status}`);
        return response.json() as Promise<VenueClientConfig>;
      })
      .then((config) => {
        if (!cancelled) setRotation(floorRotationFromVenueConfig(config));
      })
      .catch(() => {
        // Development and old venue hosts keep the canonical unrotated view.
      });
    return () => { cancelled = true; };
  }, [queryRotation]);

  return (
    <VenueFloorRotationContext.Provider value={rotation}>
      {children}
    </VenueFloorRotationContext.Provider>
  );
}

export function useVenueFloorRotation(): FloorRotationDegrees {
  return useContext(VenueFloorRotationContext);
}
