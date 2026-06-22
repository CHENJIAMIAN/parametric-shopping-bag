import * as THREE from "three";

const BOTTOM_FACE_NAMES = [
  "bottom-front-triangle",
  "bottom-right-triangle",
  "bottom-back-triangle",
  "bottom-left-triangle",
  "bottom-left-wing",
  "bottom-right-wing"
];

const CLICK_MOVE_TOLERANCE_PX = 4;

interface PickInteractionOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  pickRoot: THREE.Object3D;
  showToast: (name: string, dimensions: PickedDimensions) => void;
}

export interface PickedDimensions {
  width: number;
  height: number;
  depth: number;
}

interface PickedItem {
  name: string;
  object: THREE.Object3D;
  faceIndex?: number;
}

export class PickInteraction {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pickRoot: THREE.Object3D;
  private pointerDown: { x: number; y: number } | null = null;
  private highlight: THREE.Object3D | null = null;

  constructor(private readonly options: PickInteractionOptions) {
    this.pickRoot = options.pickRoot;
    this.options.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.options.canvas.addEventListener("pointerup", this.onPointerUp);
  }

  dispose(): void {
    this.options.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.options.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.clearHighlight();
  }

  highlightByName(name: string): boolean {
    const object = this.findByName(this.pickRoot, name);
    if (!object) return false;

    this.showHighlight({ name, object });
    return true;
  }

  setPickRoot(root: THREE.Object3D): void {
    this.clearHighlight();
    this.pickRoot = root;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.pointerDown) return;

    const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (distance > CLICK_MOVE_TOLERANCE_PX) return;

    const picked = this.pick(event);
    if (!picked) return;

    void this.copyAndToast(picked);
    this.showHighlight(picked);
  };

  private async copyAndToast(picked: PickedItem): Promise<void> {
    const copied = await this.copyToClipboard(picked.name);
    this.options.showToast(copied ? `已复制：${picked.name}` : `复制失败：${picked.name}`, this.measureObject(picked.object));
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard?.writeText(text);
      return true;
    } catch {
      return this.copyWithTextArea(text);
    }
  }

  private copyWithTextArea(text: string): boolean {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  private pick(event: PointerEvent): PickedItem | null {
    const rect = this.options.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.options.camera);

    const hits = this.raycaster.intersectObject(this.pickRoot, true);
    for (const hit of hits) {
      if (this.isHighlight(hit.object)) continue;
      const name = this.hitName(hit);
      if (name) return { name, object: hit.object, faceIndex: hit.faceIndex };
    }

    return null;
  }

  private hitName(hit: THREE.Intersection<THREE.Object3D>): string {
    if (hit.object.name === "bottom-fold-structure") {
      return BOTTOM_FACE_NAMES[Math.floor((hit.faceIndex ?? 0) / 1)] ?? "bottom-fold-structure";
    }

    if (hit.object.name) return this.stripDebugPrefix(hit.object.name);

    const namedParent = this.findNamedParent(hit.object);
    return namedParent ? this.stripDebugPrefix(namedParent.name) : "";
  }

  private findNamedParent(object: THREE.Object3D): THREE.Object3D | null {
    let current: THREE.Object3D | null = object.parent;
    while (current) {
      if (this.isHighlight(current)) return null;
      if (current.name && current.name !== "shopping-bag" && current.name !== "debug-overlay") return current;
      current = current.parent;
    }
    return null;
  }

  private findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
    if (root.name === name) return root;

    for (const child of root.children) {
      const found = this.findByName(child, name);
      if (found) return found;
    }

    return null;
  }

  private isHighlight(object: THREE.Object3D): boolean {
    return object.name.startsWith("click-highlight-");
  }

  private stripDebugPrefix(name: string): string {
    return name.replace(/^debug-surface-label-/, "").replace(/^debug-3d-label-/, "");
  }

  private measureObject(object: THREE.Object3D): PickedDimensions {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return { width: 0, height: 0, depth: 0 };

    const size = box.getSize(new THREE.Vector3());
    return {
      width: Math.round(size.x),
      height: Math.round(size.y),
      depth: Math.round(size.z)
    };
  }

  private showHighlight(picked: PickedItem): void {
    this.clearHighlight();

    const object = picked.object;
    const mesh = object as THREE.Mesh;
    if (!mesh.geometry) return;

    const edges = object.name === "bottom-fold-structure" && picked.faceIndex !== undefined
      ? this.bottomTriangleEdges(mesh.geometry as THREE.BufferGeometry, picked.faceIndex)
      : new THREE.EdgesGeometry(mesh.geometry);
    const material = new THREE.LineBasicMaterial({
      color: 0xffb000,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false
    });
    const outline = new THREE.LineSegments(edges, material);

    outline.name = `click-highlight-${picked.name}`;
    outline.renderOrder = 100;
    object.add(outline);

    this.highlight = outline;
  }

  private bottomTriangleEdges(geometry: THREE.BufferGeometry, faceIndex: number): THREE.BufferGeometry {
    const position = geometry.getAttribute("position");
    const index = geometry.index;
    const indices = index
      ? [index.getX(faceIndex * 3), index.getX(faceIndex * 3 + 1), index.getX(faceIndex * 3 + 2)]
      : [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
    const points = indices.map((vertexIndex) => new THREE.Vector3(
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex)
    ));

    return new THREE.BufferGeometry().setFromPoints([
      points[0],
      points[1],
      points[1],
      points[2],
      points[2],
      points[0]
    ]);
  }

  private clearHighlight(): void {
    if (!this.highlight) return;
    this.highlight.parent?.remove(this.highlight);
    this.highlight.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
    this.highlight = null;
  }
}
