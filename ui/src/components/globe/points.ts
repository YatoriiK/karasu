import type { Listeners } from "../../lib/types";
import type { GlobePoint } from "./Globe";

const regions = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string | null) {
  if (!code) return "";
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

export function cityKey(c: { city: string; country: string | null }) {
  return `${c.city}|${c.country ?? ""}`;
}

export function toGlobePoints(data: Listeners | undefined): GlobePoint[] {
  if (!data || data.status !== "ok") return [];
  return data.cities
    .filter((c) => c.lat != null && c.lon != null)
    .map((c) => ({
      key: cityKey(c),
      lat: c.lat!,
      lon: c.lon!,
      value: c.listeners,
      label: `${c.city}, ${countryName(c.country)}`,
      detail: `${c.listeners.toLocaleString()} listeners`,
    }));
}
