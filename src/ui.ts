import type { PickedDimensions } from "./pickInteraction";
import type { ArtworkPlacement, BagRules, BagState, PresetName } from "./types";
import { PRESETS } from "./config";
import type { DielineInfo } from "./jsonKnifeModel";

export interface UIHandlers {
  onPresetChange: (preset: PresetName) => void;
  onDimensionChange: () => void;
  onRenderOptionChange: () => void;
  onTextureUpload: () => void;
}

export interface DielineEditor {
  setDieline: (dieline: DielineInfo | null) => void;
  render: () => void;
}

export function renderAppShell(host: HTMLElement): HTMLCanvasElement {
  host.innerHTML = `
    <div class="app">
      <aside class="controls">
        <h1>JSON 3D 购物袋</h1>
        <section>
          <h2>尺寸预设</h2>
          <div class="segmented" id="presetButtons"></div>
          ${rangeField("width", "Width 宽度", 140, 320)}
          ${rangeField("height", "Height 高度", 180, 460)}
          ${rangeField("gusset", "Gusset 侧宽", 120, 180)}
        </section>
        <section>
          <h2>表面素材</h2>
          <div class="field">
            <label for="artworkSide">贴图侧</label>
            <select id="artworkSide">
              <option value="outside">外侧</option>
              <option value="inside">内侧</option>
            </select>
          </div>
          <div class="field">
            <label for="asset">替换图片 / logo</label>
            <input id="asset" type="file" accept="image/*" />
          </div>
          <canvas class="dieline-editor" id="dielineEditor" width="280" height="180"></canvas>
          <label class="check"><input id="showDieline" type="checkbox" />显示折线和底部结构</label>
          <p class="hint">上传后在展开刀线图上拖动图片定位，滚轮缩放；3D 预览会按展开坐标实时更新。</p>
        </section>
        <section>
          <h2>JSON 模型</h2>
          ${rangeField("foldProgress", "开合进度", 0, 100)}
        </section>
        <section class="stats" id="stats"></section>
      </aside>
      <main class="viewport">
        <canvas id="scene"></canvas>
        <div class="badge">拖拽旋转 · 滚轮缩放 · 右键平移</div>
        <div class="pick-toast" id="pickToast" role="status" aria-live="polite"></div>
      </main>
    </div>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  if (!canvas) throw new Error("Scene canvas was not mounted.");
  return canvas;
}

export function bindControls(state: BagState, handlers: UIHandlers): void {
  const presetHost = mustGet<HTMLElement>("#presetButtons");
  Object.keys(PRESETS).forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset;
    button.dataset.preset = preset;
    button.addEventListener("click", () => handlers.onPresetChange(preset as PresetName));
    presetHost.appendChild(button);
  });

  for (const key of ["width", "height", "gusset"] as const) {
    mustGet<HTMLInputElement>(`#${key}`).addEventListener("input", (event) => {
      state[key] = Number((event.target as HTMLInputElement).value);
      state.activePreset = "Custom";
      handlers.onDimensionChange();
    });
  }

  mustGet<HTMLInputElement>("#showDieline").addEventListener("change", (event) => {
    state.showDieline = (event.target as HTMLInputElement).checked;
    handlers.onRenderOptionChange();
  });
  mustGet<HTMLSelectElement>("#artworkSide").addEventListener("change", (event) => {
    state.artworkSide = (event.target as HTMLSelectElement).value as BagState["artworkSide"];
    handlers.onRenderOptionChange();
  });
  const assetInput = mustGet<HTMLInputElement>("#asset");
  assetInput.addEventListener("click", () => {
    assetInput.value = "";
  });
  assetInput.addEventListener("change", () => handlers.onTextureUpload());

  syncControls(state);
}

export function bindDielineEditor(state: BagState, onChange: () => void): DielineEditor {
  const canvas = mustGet<HTMLCanvasElement>("#dielineEditor");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Dieline editor canvas 2D context is unavailable.");

  let dieline: DielineInfo | null = null;
  let view = { scale: 1, offsetX: 0, offsetY: 0 };
  let dragging = false;
  let dragMode: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null = null;
  let dragStart = { x: 0, y: 0, artworkX: 0, artworkY: 0, artworkWidth: 0, artworkHeight: 0 };
  let movedHighlightUntil = 0;
  let movedHighlightTimer = 0;

  const currentArtwork = (): ArtworkPlacement => state.artworks[state.artworkSide];

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const updateView = () => {
    resize();
    if (!dieline) return;
    const margin = 14 * (window.devicePixelRatio || 1);
    const scale = Math.min(
      (canvas.width - margin * 2) / dieline.totalX,
      (canvas.height - margin * 2) / dieline.totalY
    );
    view = {
      scale: Math.max(scale, 0.01),
      offsetX: (canvas.width - dieline.totalX * scale) / 2,
      offsetY: (canvas.height - dieline.totalY * scale) / 2
    };
  };

  const clientToDieline = (event: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: ((event.clientX - rect.left) * dpr - view.offsetX) / view.scale,
      y: ((event.clientY - rect.top) * dpr - view.offsetY) / view.scale
    };
  };

  const getArtworkHit = (point: { x: number; y: number }) => {
    const artwork = currentArtwork();
    if (!artwork.image) return null;
    const handleSize = Math.max(8 / view.scale, 4);
    const left = artwork.x;
    const top = artwork.y;
    const right = artwork.x + artwork.width;
    const bottom = artwork.y + artwork.height;
    const centerX = artwork.x + artwork.width / 2;
    const centerY = artwork.y + artwork.height / 2;
    const handles: Array<{ mode: NonNullable<typeof dragMode>; x: number; y: number }> = [
      { mode: "nw", x: left, y: top },
      { mode: "n", x: centerX, y: top },
      { mode: "ne", x: right, y: top },
      { mode: "e", x: right, y: centerY },
      { mode: "se", x: right, y: bottom },
      { mode: "s", x: centerX, y: bottom },
      { mode: "sw", x: left, y: bottom },
      { mode: "w", x: left, y: centerY }
    ];

    for (const handle of handles) {
      if (Math.abs(point.x - handle.x) <= handleSize && Math.abs(point.y - handle.y) <= handleSize) {
        return handle.mode;
      }
    }

    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return "move";
    return null;
  };

  const updateCursor = (mode: typeof dragMode) => {
    const cursors: Record<NonNullable<typeof dragMode>, string> = {
      move: "move",
      n: "ns-resize",
      s: "ns-resize",
      e: "ew-resize",
      w: "ew-resize",
      ne: "nesw-resize",
      sw: "nesw-resize",
      nw: "nwse-resize",
      se: "nwse-resize"
    };
    canvas.style.cursor = mode ? cursors[mode] : "grab";
  };

  const applyArtworkDrag = (point: { x: number; y: number }) => {
    if (!dragMode) return;
    const dx = point.x - dragStart.x;
    const dy = point.y - dragStart.y;
    const minSize = 8;
    const artwork = currentArtwork();

    let left = dragStart.artworkX;
    let top = dragStart.artworkY;
    let right = dragStart.artworkX + dragStart.artworkWidth;
    let bottom = dragStart.artworkY + dragStart.artworkHeight;

    if (dragMode === "move") {
      artwork.x = dragStart.artworkX + dx;
      artwork.y = dragStart.artworkY + dy;
      return;
    }

    if (dragMode.includes("w")) left += dx;
    if (dragMode.includes("e")) right += dx;
    if (dragMode.includes("n")) top += dy;
    if (dragMode.includes("s")) bottom += dy;

    if (right - left < minSize) {
      if (dragMode.includes("w")) left = right - minSize;
      else right = left + minSize;
    }
    if (bottom - top < minSize) {
      if (dragMode.includes("n")) top = bottom - minSize;
      else bottom = top + minSize;
    }

    artwork.x = left;
    artwork.y = top;
    artwork.width = right - left;
    artwork.height = bottom - top;
  };

  const render = () => {
    updateView();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!dieline) {
      ctx.fillStyle = "#8a8176";
      ctx.font = `${12 * (window.devicePixelRatio || 1)}px Microsoft YaHei, Arial`;
      ctx.textAlign = "center";
      ctx.fillText("正在加载刀线", canvas.width / 2, canvas.height / 2);
      return;
    }

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);
    ctx.fillStyle = "#f6ecd8";
    ctx.fillRect(0, 0, dieline.totalX, dieline.totalY);

    dieline.faces.forEach((face) => {
      if (face.points.length < 3) return;
      ctx.beginPath();
      face.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(239, 229, 208, 0.92)";
      ctx.fill();
      ctx.strokeStyle = "rgba(30, 138, 118, 0.55)";
      ctx.lineWidth = 1 / view.scale;
      ctx.stroke();
    });

    ctx.setLineDash([5 / view.scale, 5 / view.scale]);
    ctx.strokeStyle = "rgba(239, 68, 68, 0.7)";
    for (const fold of dieline.folds) {
      ctx.beginPath();
      ctx.moveTo(fold.x1, fold.y1);
      ctx.lineTo(fold.x2, fold.y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const artwork = currentArtwork();
    const image = artwork.image;
    if (image) {
      const highlightMoved = dragging || Date.now() < movedHighlightUntil;
      if (dragging) {
        ctx.save();
        ctx.translate(dragStart.artworkX + dragStart.artworkWidth / 2, dragStart.artworkY + dragStart.artworkHeight / 2);
        ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
        ctx.lineWidth = 2.4 / view.scale;
        ctx.setLineDash([8 / view.scale, 5 / view.scale]);
        ctx.strokeRect(-dragStart.artworkWidth / 2, -dragStart.artworkHeight / 2, dragStart.artworkWidth, dragStart.artworkHeight);
        ctx.restore();

        const startCenter = {
          x: dragStart.artworkX + dragStart.artworkWidth / 2,
          y: dragStart.artworkY + dragStart.artworkHeight / 2
        };
        const currentCenter = {
          x: artwork.x + artwork.width / 2,
          y: artwork.y + artwork.height / 2
        };
        ctx.save();
        ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
        ctx.fillStyle = "rgba(245, 158, 11, 0.95)";
        ctx.lineWidth = 2.2 / view.scale;
        ctx.beginPath();
        ctx.moveTo(startCenter.x, startCenter.y);
        ctx.lineTo(currentCenter.x, currentCenter.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(currentCenter.x, currentCenter.y, 4.5 / view.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = artwork.opacity;
      ctx.translate(artwork.x + artwork.width / 2, artwork.y + artwork.height / 2);
      ctx.rotate(artwork.rotate * Math.PI / 180);
      ctx.drawImage(image, -artwork.width / 2, -artwork.height / 2, artwork.width, artwork.height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = highlightMoved ? "#f59e0b" : "#1e8a76";
      ctx.lineWidth = (highlightMoved ? 3.2 : 2) / view.scale;
      ctx.strokeRect(-artwork.width / 2, -artwork.height / 2, artwork.width, artwork.height);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = highlightMoved ? "#f59e0b" : "#1e8a76";
      ctx.lineWidth = (highlightMoved ? 1.8 : 1.4) / view.scale;
      const size = (highlightMoved ? 10 : 8) / view.scale;
      const points = [
        [-artwork.width / 2, -artwork.height / 2],
        [0, -artwork.height / 2],
        [artwork.width / 2, -artwork.height / 2],
        [artwork.width / 2, 0],
        [artwork.width / 2, artwork.height / 2],
        [0, artwork.height / 2],
        [-artwork.width / 2, artwork.height / 2],
        [-artwork.width / 2, 0]
      ];
      for (const [x, y] of points) {
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      }
      ctx.restore();
    }

    ctx.restore();
  };

  canvas.addEventListener("pointerdown", (event) => {
    const artwork = currentArtwork();
    if (!artwork.image) return;
    const point = clientToDieline(event);
    const hit = getArtworkHit(point);
    if (!hit) return;
    dragging = true;
    dragMode = hit;
    dragStart = {
      x: point.x,
      y: point.y,
      artworkX: artwork.x,
      artworkY: artwork.y,
      artworkWidth: artwork.width,
      artworkHeight: artwork.height
    };
    if (event.isPrimary && event.pointerId >= 0) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events in tests may not have an active browser pointer.
      }
    }
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = clientToDieline(event);
    if (!dragging) return;
    applyArtworkDrag(point);
    render();
    onChange();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (dragging) return;
    updateCursor(getArtworkHit(clientToDieline(event)));
  });

  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    dragMode = null;
    updateCursor(getArtworkHit(clientToDieline(event)));
    movedHighlightUntil = Date.now() + 900;
    if (movedHighlightTimer) window.clearTimeout(movedHighlightTimer);
    movedHighlightTimer = window.setTimeout(() => {
      movedHighlightTimer = 0;
      render();
    }, 920);
    render();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("wheel", (event) => {
    const artwork = currentArtwork();
    if (!artwork.image) return;
    event.preventDefault();
    const centerX = artwork.x + artwork.width / 2;
    const centerY = artwork.y + artwork.height / 2;
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    artwork.width = Math.max(12, artwork.width * factor);
    artwork.height = Math.max(12, artwork.height * factor);
    artwork.x = centerX - artwork.width / 2;
    artwork.y = centerY - artwork.height / 2;
    render();
    onChange();
  }, { passive: false });

  window.addEventListener("resize", render);

  return {
    setDieline: (next) => {
      dieline = next;
      render();
    },
    render
  };
}

export function syncControls(state: BagState, rules?: BagRules): void {
  for (const key of ["width", "height", "gusset"] as const) {
    mustGet<HTMLInputElement>(`#${key}`).value = String(state[key]);
    mustGet<HTMLElement>(`#${key}Value`).textContent = `${state[key]} mm`;
  }

  mustGet<HTMLInputElement>("#showDieline").checked = state.showDieline;
  mustGet<HTMLSelectElement>("#artworkSide").value = state.artworkSide;

  document.querySelectorAll<HTMLButtonElement>("#presetButtons button").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === state.activePreset);
  });

  if (rules) updateStats(state, rules);
}

export function readUploadedImage(state: BagState, onReady: () => void): void {
  const assetInput = mustGet<HTMLInputElement>("#asset");
  const file = assetInput.files?.[0];
  if (!file) return;

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    image.dataset.stamp = `${file.name}-${file.lastModified}-${file.size}`;
    const artwork = state.artworks[state.artworkSide];
    if (artwork.objectUrl) URL.revokeObjectURL(artwork.objectUrl);
    artwork.image = image;
    artwork.objectUrl = objectUrl;
    const aspect = image.naturalWidth / Math.max(image.naturalHeight, 1);
    artwork.width = 150;
    artwork.height = artwork.width / Math.max(aspect, 0.01);
    assetInput.value = "";
    onReady();
  };
  image.src = objectUrl;
}

export function updateStats(state: BagState, rules: BagRules): void {
  mustGet<HTMLElement>("#stats").innerHTML = `
    <div><span>固定翻折边</span><strong>${rules.topFold} mm</strong></div>
    <div><span>固定糊纸边</span><strong>${rules.glueFlap} mm</strong></div>
    <div><span>底部深度</span><strong>${Math.round(state.gusset * rules.bottomRatio)} mm</strong></div>
    <div><span>刀线展开宽</span><strong>${Math.round(state.width * 2 + state.gusset * 2 + rules.glueFlap)} mm</strong></div>
  `;
}

let toastTimer = 0;

export function showPickToast(name: string, dimensions: PickedDimensions): void {
  const toast = mustGet<HTMLElement>("#pickToast");
  toast.innerHTML = `
    <strong>${name}</strong>
    <span>W ${dimensions.width} mm · H ${dimensions.height} mm · D ${dimensions.depth} mm</span>
  `;
  toast.classList.add("visible");

  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
    toastTimer = 0;
  }, 1400);
}

function rangeField(id: string, label: string, min: number, max: number): string {
  return `
    <div class="field">
      <label for="${id}">${label}<span class="value" id="${id}Value"></span></label>
      <input id="${id}" type="range" min="${min}" max="${max}" step="1" />
    </div>
  `;
}

function mustGet<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
