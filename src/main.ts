import "./styles.css";
import { ASSET_PATHS, BAG_RULES, INITIAL_STATE, PRESETS } from "./config";
import { JsonKnifeModel, type KnifeJsonPayload } from "./jsonKnifeModel";
import { PickInteraction } from "./pickInteraction";
import { createScene } from "./scene";
import { onPaperTextureReady } from "./textures";
import { bindControls, bindDielineEditor, readUploadedImage, renderAppShell, showPickToast, syncControls, updateStats } from "./ui";
import type { ArtworkSide, PresetName } from "./types";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("App root not found.");

const state = structuredClone(INITIAL_STATE);

const canvas = renderAppShell(app);
const sceneContext = createScene(canvas);
let jsonKnife: JsonKnifeModel | null = null;
let foldProgress = 100;
const lastDimensions = { width: state.width, height: state.height, gusset: state.gusset };
const dielineEditor = bindDielineEditor(state, () => {
  syncArtworkFromState();
});
const pickInteraction = new PickInteraction({
  canvas,
  camera: sceneContext.camera,
  pickRoot: sceneContext.scene,
  showToast: showPickToast
});
void pickInteraction;

(window as unknown as { __shoppingBagDebug?: { highlight: (name: string) => boolean } }).__shoppingBagDebug = {
  highlight: (name: string) => pickInteraction.highlightByName(name)
};
(window as unknown as { __shoppingBagScene?: typeof sceneContext }).__shoppingBagScene = sceneContext;
(window as unknown as { __shoppingBagState?: typeof state }).__shoppingBagState = state;

function rebuild(): void {
  syncJsonModelFromState();
  syncDielineEditorFromModel();
  dielineEditor.render();
  updateJsonCameraTarget();
  syncControls(state, BAG_RULES);
}

bindControls(state, {
  onPresetChange: (preset: PresetName) => {
    Object.assign(state, PRESETS[preset]);
    state.activePreset = preset;
    updateArtworkForDimensions();
    rebuild();
  },
  onDimensionChange: () => {
    updateArtworkForDimensions();
    rebuild();
  },
  onRenderOptionChange: rebuild,
  onTextureUpload: () => readUploadedImage(state, () => {
    resetArtworkToDefaultPosition();
    rebuild();
  })
});

updateStats(state, BAG_RULES);
rebuild();
onPaperTextureReady(rebuild);

bindJsonModelControls();
void loadJsonKnifeModel();

function animate(): void {
  requestAnimationFrame(animate);
  sceneContext.controls.update();
  sceneContext.render();
}

animate();

function bindJsonModelControls(): void {
  const progressInput = document.querySelector<HTMLInputElement>("#foldProgress");
  const progressValue = document.querySelector<HTMLElement>("#foldProgressValue");
  if (!progressInput || !progressValue) return;

  progressInput.value = String(foldProgress);
  progressValue.textContent = `${foldProgress}%`;
  progressInput.addEventListener("input", () => {
    foldProgress = Number(progressInput.value);
    progressValue.textContent = `${foldProgress}%`;
    jsonKnife?.setProgress(foldProgress);
    updateJsonCameraTarget();
  });
}

async function loadJsonKnifeModel(): Promise<void> {
  const payload = await fetch(ASSET_PATHS.knifeData).then((response) => response.json()) as KnifeJsonPayload;
  jsonKnife = new JsonKnifeModel(payload);
  jsonKnife.setFoldLinesVisible(state.showDieline);
  sceneContext.scene.add(jsonKnife.build());
  jsonKnife.root.visible = true;
  jsonKnife.setProgress(foldProgress);
  syncJsonModelFromState();
  syncDielineEditorFromModel();
  const summary = jsonKnife.getSummary();
  console.info("JSON knife model loaded", summary);
  (window as unknown as { __jsonKnifeDebug?: { model: JsonKnifeModel; summary: typeof summary } }).__jsonKnifeDebug = {
    model: jsonKnife,
    summary
  };
  applyModelMode();
}

function applyModelMode(): void {
  if (jsonKnife) {
    jsonKnife.root.visible = true;
    syncJsonModelFromState();
    jsonKnife.setProgress(foldProgress);
  }
  if (jsonKnife) pickInteraction.setPickRoot(jsonKnife.root);
  updateJsonCameraTarget();
}

function syncJsonModelFromState(): void {
  if (!jsonKnife) return;
  jsonKnife.setFoldLinesVisible(state.showDieline);
  jsonKnife.setTargetDimensions(state.width, state.height, state.gusset);
  jsonKnife.setProgress(foldProgress);
  jsonKnife.applyArtworks(state.artworks, sceneContext.renderer);
}

function syncArtworkFromState(): void {
  if (!jsonKnife) return;
  jsonKnife.applyArtworks(state.artworks, sceneContext.renderer);
}

function syncDielineEditorFromModel(): void {
  if (!jsonKnife) return;
  dielineEditor.setDieline(jsonKnife.getDielineInfo());
}

function updateArtworkForDimensions(): void {
  if (
    state.width === lastDimensions.width
    && state.height === lastDimensions.height
    && state.gusset === lastDimensions.gusset
  ) {
    return;
  }

  const previousLayout = createDielineLayout(lastDimensions);
  const nextLayout = createDielineLayout(state);

  for (const side of ["outside", "inside"] as ArtworkSide[]) {
    const artwork = state.artworks[side];
    const centerX = artwork.x + artwork.width / 2;
    const centerY = artwork.y + artwork.height / 2;
    const nextCenterX = mapByLayoutSegments(centerX, previousLayout.xSegments, nextLayout.xSegments);
    const nextCenterY = mapByLayoutSegments(centerY, previousLayout.ySegments, nextLayout.ySegments);
    const widthScale = scaleAtLayoutPosition(centerX, previousLayout.xSegments, nextLayout.xSegments);
    const heightScale = scaleAtLayoutPosition(centerY, previousLayout.ySegments, nextLayout.ySegments);
    const scale = Math.min(widthScale, heightScale);
    const nextWidth = Math.max(12, artwork.width * scale);
    const nextHeight = Math.max(12, artwork.height * scale);

    artwork.x = nextCenterX - nextWidth / 2;
    artwork.y = nextCenterY - nextHeight / 2;
    artwork.width = nextWidth;
    artwork.height = nextHeight;
  }

  lastDimensions.width = state.width;
  lastDimensions.height = state.height;
  lastDimensions.gusset = state.gusset;
}

function resetArtworkToDefaultPosition(): void {
  const layout = createDielineLayout(state);
  const frontX = BAG_RULES.glueFlap + state.width + state.gusset;
  const panelTop = BAG_RULES.topFold;

  for (const side of ["outside", "inside"] as ArtworkSide[]) {
    const artwork = state.artworks[side];
    const aspect = artwork.image ? artwork.image.naturalWidth / Math.max(artwork.image.naturalHeight, 1) : 150 / 95;
    const maxWidth = Math.min(state.width * 0.62, layout.totalX * 0.22);
    const maxHeight = Math.min(state.height * 0.32, layout.totalY * 0.22);
    let width = Math.max(40, maxWidth);
    let height = width / Math.max(aspect, 0.01);
    if (height > maxHeight) {
      height = Math.max(24, maxHeight);
      width = height * Math.max(aspect, 0.01);
    }

    artwork.x = frontX + (state.width - width) / 2;
    artwork.y = panelTop + state.height * 0.26;
    artwork.width = width;
    artwork.height = height;
    artwork.rotate = 0;
    artwork.opacity = 1;
  }
}

interface DielineLayout {
  totalX: number;
  totalY: number;
  xSegments: LayoutSegment[];
  ySegments: LayoutSegment[];
}

interface LayoutSegment {
  from0: number;
  from1: number;
}

function createDielineLayout(dimensions: { width: number; height: number; gusset: number }): DielineLayout {
  const bottomDepth = Math.round(dimensions.gusset * BAG_RULES.bottomRatio);
  const totalX = BAG_RULES.glueFlap + dimensions.width * 2 + dimensions.gusset * 2;
  const totalY = BAG_RULES.topFold + dimensions.height + bottomDepth;

  return {
    totalX,
    totalY,
    xSegments: [
      { from0: 0, from1: BAG_RULES.glueFlap },
      { from0: BAG_RULES.glueFlap, from1: BAG_RULES.glueFlap + dimensions.width },
      { from0: BAG_RULES.glueFlap + dimensions.width, from1: BAG_RULES.glueFlap + dimensions.width + dimensions.gusset },
      { from0: BAG_RULES.glueFlap + dimensions.width + dimensions.gusset, from1: BAG_RULES.glueFlap + dimensions.width + dimensions.gusset + dimensions.width },
      { from0: BAG_RULES.glueFlap + dimensions.width + dimensions.gusset + dimensions.width, from1: totalX }
    ],
    ySegments: [
      { from0: 0, from1: BAG_RULES.topFold },
      { from0: BAG_RULES.topFold, from1: BAG_RULES.topFold + dimensions.height },
      { from0: BAG_RULES.topFold + dimensions.height, from1: totalY }
    ]
  };
}

function mapByLayoutSegments(value: number, fromSegments: LayoutSegment[], toSegments: LayoutSegment[]): number {
  const index = findLayoutSegmentIndex(value, fromSegments);
  const from = fromSegments[index];
  const to = toSegments[index];
  const denominator = from.from1 - from.from0;
  const t = Math.abs(denominator) < 1e-6 ? 0 : (value - from.from0) / denominator;
  return to.from0 + t * (to.from1 - to.from0);
}

function scaleAtLayoutPosition(value: number, fromSegments: LayoutSegment[], toSegments: LayoutSegment[]): number {
  const index = findLayoutSegmentIndex(value, fromSegments);
  const from = fromSegments[index];
  const to = toSegments[index];
  const fromSize = from.from1 - from.from0;
  if (Math.abs(fromSize) < 1e-6) return 1;
  return (to.from1 - to.from0) / fromSize;
}

function findLayoutSegmentIndex(value: number, segments: LayoutSegment[]): number {
  const index = segments.findIndex((segment) => value >= segment.from0 - 1e-6 && value <= segment.from1 + 1e-6);
  if (index >= 0) return index;
  return value < segments[0].from0 ? 0 : segments.length - 1;
}

function updateJsonCameraTarget(): void {
  if (!jsonKnife) return;
  const bounds = jsonKnife.getWorldBounds();
  sceneContext.controls.target.set(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2
  );
}
