export type ArtworkSide = "outside" | "inside";

export type PresetName = "Small" | "Medium" | "Large";

export interface BagDimensions {
  width: number;
  height: number;
  gusset: number;
}

export interface BagRules {
  topFold: number;
  glueFlap: number;
  bottomRatio: number;
}

export interface ArtworkPlacement {
  image?: HTMLImageElement;
  objectUrl?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  opacity: number;
}

export interface BagState extends BagDimensions {
  activePreset: PresetName | "Custom";
  showDieline: boolean;
  artworkSide: ArtworkSide;
  artworks: Record<ArtworkSide, ArtworkPlacement>;
}
