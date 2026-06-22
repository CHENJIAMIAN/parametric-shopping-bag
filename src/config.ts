import type { BagRules, BagState, PresetName } from "./types";

export const PRESETS: Record<PresetName, Pick<BagState, "width" | "height" | "gusset">> = {
  Small: { width: 180, height: 230, gusset: 120 },
  Medium: { width: 240, height: 300, gusset: 120 },
  Large: { width: 310, height: 390, gusset: 145 }
};

export const BAG_RULES: BagRules = {
  topFold: 40,
  glueFlap: 20,
  bottomRatio: 0.75
};

export const ASSET_PATHS = {
  environmentHdr: publicUrl("assets/studio-env.hdr"),
  paperTexture: publicUrl("assets/kraft-paper-250g.jpg"),
  knifeData: publicUrl("data/knife-181.json")
};

function publicUrl(path: string): string {
  return new URL(path, window.location.origin + import.meta.env.BASE_URL).toString();
}

export const INITIAL_STATE: BagState = {
  ...PRESETS.Medium,
  activePreset: "Medium",
  showDieline: true,
  artworkSide: "outside",
  artworks: {
    outside: {
      x: 340,
      y: 110,
      width: 150,
      height: 95,
      rotate: 0,
      opacity: 1
    },
    inside: {
      x: 340,
      y: 110,
      width: 150,
      height: 95,
      rotate: 0,
      opacity: 1
    }
  }
};
