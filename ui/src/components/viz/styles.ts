export type VizStyle = "bars" | "smoke" | "memo" | "mirror" | "wave";

export const VIZ_STYLES: { value: VizStyle; label: string }[] = [
  { value: "bars", label: "Cava bars" },
  { value: "smoke", label: "Ink smoke" },
  { value: "memo", label: "Voice memo" },
  { value: "mirror", label: "Mirror bars" },
  { value: "wave", label: "Ink line" },
];
