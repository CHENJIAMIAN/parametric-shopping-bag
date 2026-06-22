import * as THREE from "three";
import { ASSET_PATHS } from "./config";
import type { ArtworkPlacement, ArtworkSide } from "./types";

const MM_TO_UNIT = 1;
const EPSILON = 1e-6;

const FACE_COLORS = [
  0xff4d4f, 0xff7a45, 0xfadb14, 0x52c41a, 0x13c2c2, 0x1677ff,
  0x722ed1, 0xeb2f96, 0xa0d911, 0x2f54eb, 0xfa8c16, 0x08979c,
  0x7cb305, 0xc41d7f
];

const TEXTURE_SCALE = 4;

interface KnifePoint {
  mtd?: string;
  x: number;
  y: number;
  rx?: number;
  ry?: number;
  ang?: number;
  arc?: number;
  dir?: number;
}

interface KnifeFace {
  name: string;
  w?: number;
  h?: number;
  x: number;
  y: number;
  dlist: KnifePoint[];
  holes?: Array<{ dlist?: KnifePoint[] } | KnifePoint[]> | null;
}

interface KnifeFold {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface KnifeAction {
  name: string;
  rotate: number;
}

interface KnifeData {
  cate_no?: string;
  totalX: number;
  totalY: number;
  thickness?: number;
  science?: {
    name?: string;
    image?: string;
    roughness?: number;
  };
  faces: KnifeFace[];
  folds?: KnifeFold[];
  animation?: { animations?: KnifeAction[][] };
  animate?: KnifeAction[][];
}

export interface KnifeJsonPayload {
  code?: number;
  data?: KnifeData;
}

export interface JsonKnifeSummary {
  cateNo?: string;
  faces: number;
  folds: number;
  steps: number;
  actions: number;
  width: number;
  height: number;
}

export interface DielineFaceInfo {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  points: Array<{ x: number; y: number }>;
}

export interface DielineInfo {
  totalX: number;
  totalY: number;
  faces: DielineFaceInfo[];
  folds: Array<{ name: string; x1: number; y1: number; x2: number; y2: number }>;
}

export class JsonKnifeModel {
  readonly root = new THREE.Group();
  readonly faceMeshes = new Map<string, THREE.Mesh>();
  readonly artworkMeshes = new Map<ArtworkSide, Map<string, THREE.Mesh>>();
  readonly faceGroups = new Map<string, THREE.Group>();

  private readonly knife: KnifeData;
  private activeKnife: KnifeData;
  private readonly foldMap = new Map<string, KnifeFold>();
  private readonly pivots = new Map<string, THREE.Group>();
  private readonly faceSource = new Map<string, KnifeFace>();
  private readonly actionByName: Map<string, KnifeAction>;
  private readonly animationSteps: KnifeAction[][];
  private readonly foldGroup = new THREE.Group();
  private readonly foldLines = new THREE.Group();
  private readonly paperTexture: THREE.Texture;
  private readonly artworkTextures: Record<ArtworkSide, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>;
  private center: THREE.Vector2;
  private progressPercent = 0;

  constructor(payload: KnifeJsonPayload | KnifeData) {
    this.knife = "data" in payload && payload.data ? payload.data : payload as KnifeData;
    this.activeKnife = this.knife;
    this.paperTexture = loadLocalPaperTexture();
    this.updatePaperRepeat();
    this.artworkTextures = {
      outside: createArtworkTextureTarget(),
      inside: createArtworkTextureTarget()
    };
    this.artworkMeshes.set("outside", new Map());
    this.artworkMeshes.set("inside", new Map());
    this.center = new THREE.Vector2(this.knife.totalX / 2, this.knife.totalY / 2);
    this.animationSteps = this.knife.animation?.animations ?? this.knife.animate ?? [];
    this.actionByName = new Map(this.animationSteps.flat().map((action) => [action.name, action]));
    this.root.name = "json-knife-model";
    this.foldGroup.name = "json-knife-faces";
    this.foldLines.name = "json-knife-fold-lines";
    this.root.add(this.foldGroup, this.foldLines);
  }

  build(): THREE.Group {
    this.clear();
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.updatePaperRepeat();
    this.center = new THREE.Vector2(this.activeKnife.totalX / 2, this.activeKnife.totalY / 2);
    this.buildFaces();
    this.buildFoldLines();
    this.buildPivotHierarchy();
    this.setProgress(this.progressPercent);
    this.fitToGround();
    return this.root;
  }

  getSummary(): JsonKnifeSummary {
    return {
      cateNo: this.knife.cate_no,
      faces: this.knife.faces.length,
      folds: this.knife.folds?.length ?? 0,
      steps: this.animationSteps.length,
      actions: this.animationSteps.reduce((sum, step) => sum + step.length, 0),
      width: this.activeKnife.totalX,
      height: this.activeKnife.totalY
    };
  }

  getWorldBounds(): { min: number[]; max: number[]; size: number[] } {
    const box = this.getFaceBounds();
    const size = box.getSize(new THREE.Vector3());
    return {
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: size.toArray()
    };
  }

  setProgress(percent: number): void {
    this.progressPercent = percent;
    const p = THREE.MathUtils.clamp(percent / 100, 0, 1);
    for (const pivot of this.pivots.values()) {
      pivot.rotation.set(0, 0, 0);
    }

    for (const { action, start, end } of this.flattenActions()) {
      const pivot = this.pivots.get(action.name);
      if (!pivot) continue;
      const localT = end <= start ? 1 : THREE.MathUtils.clamp((p - start) / (end - start), 0, 1);
      pivot.rotation.x = THREE.MathUtils.degToRad(this.getRotationSign(action.name) * action.rotate * localT);
    }
    this.fitToGround();
  }

  dispose(): void {
    this.clear();
  }

  setFoldLinesVisible(visible: boolean): void {
    this.foldLines.visible = visible;
  }

  setTargetDimensions(width: number, height: number, gusset: number): void {
    this.activeKnife = this.createParametricKnife(width, height, gusset);
    this.build();
  }

  getDielineInfo(): DielineInfo {
    return {
      totalX: this.activeKnife.totalX,
      totalY: this.activeKnife.totalY,
      faces: this.activeKnife.faces.map((face) => ({
        name: face.name,
        x: face.x,
        y: face.y,
        w: face.w ?? getFaceBounds2D(face).w,
        h: face.h ?? getFaceBounds2D(face).h,
        points: pathToPoints(face.dlist).map((point) => ({ x: point.x, y: point.y }))
      })),
      folds: (this.activeKnife.folds ?? []).map((fold) => ({ ...fold }))
    };
  }

  applyArtworks(artworks: Record<ArtworkSide, ArtworkPlacement>, renderer: THREE.WebGLRenderer): void {
    for (const side of ["outside", "inside"] as const) {
      const artwork = artworks[side];
      const canvas = this.renderArtworkTexture(artwork);
      const target = this.artworkTextures[side];
      if (target.canvas.width !== canvas.width || target.canvas.height !== canvas.height) {
        target.texture.dispose();
        target.canvas.width = canvas.width;
        target.canvas.height = canvas.height;
        target.texture = createArtworkCanvasTexture(target.canvas);
      }
      const ctx = target.canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context is unavailable.");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(canvas, 0, 0);
      target.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      target.texture.needsUpdate = true;
    }

    for (const mesh of this.faceMeshes.values()) {
      const material = mesh.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.map = this.paperTexture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    }

    for (const side of ["outside", "inside"] as const) {
      for (const mesh of this.artworkMeshes.get(side)?.values() ?? []) {
        const material = mesh.material;
        if (!(material instanceof THREE.MeshBasicMaterial)) continue;
        material.map = this.artworkTextures[side].texture;
        material.visible = Boolean(artworks[side].image);
        material.needsUpdate = true;
      }
    }
  }

  renderArtworkTexture(artwork: ArtworkPlacement): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(this.activeKnife.totalX * TEXTURE_SCALE));
    canvas.height = Math.max(1, Math.round(this.activeKnife.totalY * TEXTURE_SCALE));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is unavailable.");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawArtwork(ctx, artwork, TEXTURE_SCALE);
    return canvas;
  }

  private buildFaces(): void {
    const thickness = Math.max(this.activeKnife.thickness ?? 0.3, 0.1);

    this.activeKnife.faces.forEach((face, index) => {
      const points = pathToPoints(face.dlist);
      if (points.length < 3) return;

      const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(
        (point.x - face.x) * MM_TO_UNIT,
        -(point.y - face.y) * MM_TO_UNIT
      )));

      for (const hole of face.holes ?? []) {
        const holePoints = pathToPoints(Array.isArray(hole) ? hole : hole.dlist ?? []);
        if (holePoints.length < 3) continue;
        shape.holes.push(new THREE.Path(holePoints.map((point) => new THREE.Vector2(
          (point.x - face.x) * MM_TO_UNIT,
          -(point.y - face.y) * MM_TO_UNIT
        ))));
      }

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
        curveSegments: 1
      });
      geometry.translate(0, 0, -thickness / 2);
      applyGlobalDielineUv(geometry, face, this.activeKnife.totalX, this.activeKnife.totalY);
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: this.paperTint(index),
        map: this.paperTexture,
        roughness: 0.82,
        metalness: 0,
        side: THREE.DoubleSide
      }));
      mesh.name = face.name;
      mesh.userData.faceName = face.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const outsideArtworkMesh = new THREE.Mesh(createArtworkOverlayGeometry(geometry, "outside"), new THREE.MeshBasicMaterial({
        map: this.artworkTextures.outside.texture,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.FrontSide,
        visible: false
      }));
      outsideArtworkMesh.name = `${face.name}_outside_artwork`;
      outsideArtworkMesh.userData.faceName = face.name;
      outsideArtworkMesh.userData.side = "outside";

      const insideArtworkMesh = new THREE.Mesh(createArtworkOverlayGeometry(geometry, "inside"), new THREE.MeshBasicMaterial({
        map: this.artworkTextures.inside.texture,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.FrontSide,
        visible: false
      }));
      insideArtworkMesh.name = `${face.name}_inside_artwork`;
      insideArtworkMesh.userData.faceName = face.name;
      insideArtworkMesh.userData.side = "inside";

      const group = new THREE.Group();
      group.name = `face_${face.name}`;
      group.position.set(
        (face.x - this.center.x) * MM_TO_UNIT,
        -(face.y - this.center.y) * MM_TO_UNIT,
        0
      );
      group.add(mesh, outsideArtworkMesh, insideArtworkMesh);

      this.faceSource.set(face.name, face);
      this.faceMeshes.set(face.name, mesh);
      this.artworkMeshes.get("outside")?.set(face.name, outsideArtworkMesh);
      this.artworkMeshes.get("inside")?.set(face.name, insideArtworkMesh);
      this.faceGroups.set(face.name, group);
      this.foldGroup.add(group);
    });
  }

  private buildFoldLines(): void {
    const animatedNames = new Set(this.animationSteps.flat().map((action) => action.name));
    const regular = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.45 });
    const animated = new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.92 });

    for (const fold of this.activeKnife.folds ?? []) {
      this.foldMap.set(fold.name, fold);
      const geometry = new THREE.BufferGeometry().setFromPoints([
        this.toWorldPoint(fold.x1, fold.y1).setZ(1.2),
        this.toWorldPoint(fold.x2, fold.y2).setZ(1.2)
      ]);
      const line = new THREE.Line(geometry, animatedNames.has(fold.name) ? animated : regular);
      line.name = `fold_${fold.name}`;
      this.foldLines.add(line);
    }
  }

  private buildPivotHierarchy(): void {
    const hierarchy = this.buildHierarchy();

    for (const [foldName, parentFace, childFace] of hierarchy) {
      const fold = this.foldMap.get(foldName);
      const parent = this.faceGroups.get(parentFace);
      const child = this.faceGroups.get(childFace);
      const action = this.actionByName.get(foldName);
      if (!fold || !parent || !child || !action) continue;

      parent.updateWorldMatrix(true, false);
      child.updateWorldMatrix(true, true);

      const p1World = this.toWorldPoint(fold.x1, fold.y1);
      const p2World = this.toWorldPoint(fold.x2, fold.y2);
      const p1Local = parent.worldToLocal(p1World.clone());
      const p2Local = parent.worldToLocal(p2World.clone());
      const axisLocal = p2Local.sub(p1Local).normalize();
      if (axisLocal.lengthSq() < EPSILON) continue;

      const hinge = new THREE.Group();
      hinge.name = `hinge_${foldName}`;
      hinge.position.copy(p1Local);
      hinge.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axisLocal);

      const spinner = new THREE.Group();
      spinner.name = `spinner_${foldName}`;
      spinner.userData.foldName = foldName;
      spinner.userData.degrees = action.rotate;

      parent.add(hinge);
      hinge.add(spinner);
      spinner.attach(child);
      this.pivots.set(foldName, spinner);
    }
  }

  private buildHierarchy(): Array<[string, string, string]> {
    const preferred: Array<[string, string, string]> = [
      ["H_HL", "H", "HL"],
      ["H_R", "H", "R"],
      ["L_H", "H", "L"],
      ["F_L", "L", "F"],
      ["F_R", "F", "R"],
      ["F_HL", "F", "HL"],
      ["HL_HLT", "HL", "HLT"],
      ["H_HT", "H", "HT"],
      ["F_FT", "F", "FT"],
      ["L_LT", "L", "LT"],
      ["R_RT", "R", "RT"],
      ["R_RB", "R", "RB"],
      ["L_LB", "L", "LB"],
      ["HL_HLB", "HL", "HLB"],
      ["H_HB", "H", "HB"],
      ["HB_HBL", "HB", "HBL"],
      ["HB_HBR", "HB", "HBR"],
      ["F_FB", "F", "FB"],
      ["FB_FBL", "FB", "FBL"],
      ["FB_FBR", "FB", "FBR"]
    ];
    const seen = new Set(preferred.map(([name]) => name));
    const fallback = this.animationSteps.flat()
      .map((action) => parseFoldName(action.name))
      .filter((item): item is [string, string, string] => !!item && !seen.has(item[0]));
    return [...preferred, ...fallback];
  }

  private flattenActions(): Array<{ action: KnifeAction; start: number; end: number }> {
    return this.animationSteps.flatMap((step) => (
      step.map((action) => ({ action, start: 0, end: 1 }))
    ));
  }

  private getRotationSign(foldName: string): number {
    const signs: Record<string, number> = {
      H_R: 1,
      H_HL: 1,
      F_R: 1,
      F_HL: 1,
      HL_HLT: 1,
      H_HT: 1,
      F_FT: 1,
      L_LT: 1,
      R_RT: 1,
      R_RB: 1,
      L_LB: 1,
      HL_HLB: 1,
      H_HB: 1,
      HB_HBL: 1,
      HB_HBR: 1,
      F_FB: 1,
      FB_FBL: 1,
      FB_FBR: 1
    };
    return signs[foldName] ?? -1;
  }

  private toWorldPoint(x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(
      (x - this.center.x) * MM_TO_UNIT,
      -(y - this.center.y) * MM_TO_UNIT,
      0
    );
  }

  private paperTint(index: number): number {
    const debugColor = FACE_COLORS[index % FACE_COLORS.length];
    const paper = new THREE.Color(0xf6ecd8);
    const tint = new THREE.Color(debugColor);
    return paper.lerp(tint, 0.08).getHex();
  }

  private fitToGround(): void {
    const box = this.getFaceBounds();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    this.root.position.x -= center.x;
    this.root.position.y -= box.min.y;
    this.root.position.z -= center.z;
  }

  private clear(): void {
    this.faceMeshes.clear();
    this.artworkMeshes.get("outside")?.clear();
    this.artworkMeshes.get("inside")?.clear();
    this.faceGroups.clear();
    this.faceSource.clear();
    this.foldMap.clear();
    this.pivots.clear();
    this.disposeChildren(this.foldGroup);
    this.disposeChildren(this.foldLines);
  }

  private drawArtwork(ctx: CanvasRenderingContext2D, artwork: ArtworkPlacement, scale: number): void {
    const image = artwork.image;
    if (!image) return;

    const width = artwork.width * scale;
    const height = artwork.height * scale;
    const cx = (artwork.x + artwork.width / 2) * scale;
    const cy = (artwork.y + artwork.height / 2) * scale;
    ctx.save();
    ctx.globalAlpha = artwork.opacity;
    ctx.translate(cx, cy);
    ctx.rotate(THREE.MathUtils.degToRad(artwork.rotate));
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  private getFaceBounds(): THREE.Box3 {
    this.root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    const meshBounds = new THREE.Box3();
    for (const mesh of this.faceMeshes.values()) {
      meshBounds.setFromObject(mesh);
      bounds.union(meshBounds);
    }
    return bounds;
  }

  private disposeChildren(group: THREE.Group): void {
    while (group.children.length) {
      const child = group.children.pop();
      child?.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
    }
  }

  private updatePaperRepeat(): void {
    this.paperTexture.repeat.set(this.activeKnife.totalX * 0.018, this.activeKnife.totalY * 0.018);
  }

  private createParametricKnife(width: number, height: number, gusset: number): KnifeData {
    const layout = readBaseLayout(this.knife);
    if (!layout) return this.knife;

    const bottomDepth = Math.round(gusset * 0.75);
    const xSegments = [
      segment(0, layout.glue, 0, layout.glue),
      segment(layout.back.x, layout.back.x + layout.back.w, layout.glue, layout.glue + width),
      segment(layout.left.x, layout.left.x + layout.left.w, layout.glue + width, layout.glue + width + gusset),
      segment(layout.front.x, layout.front.x + layout.front.w, layout.glue + width + gusset, layout.glue + width + gusset + width),
      segment(layout.right.x, layout.right.x + layout.right.w, layout.glue + width + gusset + width, layout.glue + width + gusset + width + gusset)
    ];
    const ySegments = [
      segment(0, layout.top, 0, layout.top),
      segment(layout.body.y, layout.body.y + layout.body.h, layout.top, layout.top + height),
      segment(layout.bottom.y, layout.bottom.y + layout.bottom.h, layout.top + height, layout.top + height + bottomDepth)
    ];

    const mapX = (value: number) => mapBySegments(value, xSegments);
    const mapY = (value: number) => mapBySegments(value, ySegments);
    const mapPoint = (point: KnifePoint, scaleRadius = true): KnifePoint => ({
      ...point,
      x: mapX(point.x),
      y: mapY(point.y),
      rx: point.rx === undefined ? undefined : point.rx * (scaleRadius ? scaleAt(point.x, xSegments) : 1),
      ry: point.ry === undefined ? undefined : point.ry * (scaleRadius ? scaleAt(point.y, ySegments) : 1)
    });
    const mapPath = (path: KnifePoint[]) => path.map((point) => mapPoint(point));
    const mapHolePath = (path: KnifePoint[], sourceFace: KnifeFace, targetFace: { x: number; y: number }) => {
      const center = getPathCenter(path);
      const mappedCenter = {
        x: targetFace.x + (center.x - sourceFace.x),
        y: targetFace.y + (center.y - sourceFace.y)
      };
      return path.map((point) => ({
        ...point,
        x: mappedCenter.x + (point.x - center.x),
        y: mappedCenter.y + (point.y - center.y),
        rx: point.rx,
        ry: point.ry
      }));
    };

    const faces = this.knife.faces.map((face) => {
      const x = mapX(face.x);
      const y = mapY(face.y);
      const w = face.w === undefined ? undefined : mapX(face.x + face.w) - x;
      const h = face.h === undefined ? undefined : mapY(face.y + face.h) - y;
      return {
        ...face,
        x,
        y,
        w,
        h,
        dlist: mapPath(face.dlist),
        holes: face.holes?.map((hole) => (
          Array.isArray(hole)
            ? mapHolePath(hole, face, { x, y })
            : { ...hole, dlist: mapHolePath(hole.dlist ?? [], face, { x, y }) }
        )) ?? face.holes
      };
    });

    return {
      ...this.knife,
      totalX: layout.glue + width * 2 + gusset * 2,
      totalY: layout.top + height + bottomDepth,
      faces,
      folds: this.knife.folds?.map((fold) => ({
        ...fold,
        x1: mapX(fold.x1),
        y1: mapY(fold.y1),
        x2: mapX(fold.x2),
        y2: mapY(fold.y2)
      }))
    };
  }
}

interface Segment {
  from0: number;
  from1: number;
  to0: number;
  to1: number;
}

interface BaseLayout {
  glue: number;
  top: number;
  back: { x: number; w: number };
  left: { x: number; w: number };
  front: { x: number; w: number };
  right: { x: number; w: number };
  body: { y: number; h: number };
  bottom: { y: number; h: number };
}

function readBaseLayout(knife: KnifeData): BaseLayout | null {
  const face = (name: string) => knife.faces.find((item) => item.name === name);
  const back = face("H");
  const left = face("L");
  const front = face("F");
  const right = face("R");
  const glue = face("HL");
  const top = face("HT");
  const bottom = face("HB");
  if (!back || !left || !front || !right || !glue || !top || !bottom) return null;

  return {
    glue: glue.w ?? getFaceBounds2D(glue).w,
    top: top.h ?? getFaceBounds2D(top).h,
    back: { x: back.x, w: back.w ?? getFaceBounds2D(back).w },
    left: { x: left.x, w: left.w ?? getFaceBounds2D(left).w },
    front: { x: front.x, w: front.w ?? getFaceBounds2D(front).w },
    right: { x: right.x, w: right.w ?? getFaceBounds2D(right).w },
    body: { y: back.y, h: back.h ?? getFaceBounds2D(back).h },
    bottom: { y: bottom.y, h: bottom.h ?? getFaceBounds2D(bottom).h }
  };
}

function segment(from0: number, from1: number, to0: number, to1: number): Segment {
  return { from0, from1, to0, to1 };
}

function mapBySegments(value: number, segments: Segment[]): number {
  const matched = segments.find((item) => value >= item.from0 - EPSILON && value <= item.from1 + EPSILON);
  if (!matched) {
    const before = segments[0];
    const after = segments[segments.length - 1];
    if (value < before.from0) return before.to0 + (value - before.from0);
    return after.to1 + (value - after.from1);
  }
  const scale = scaleForSegment(matched);
  return matched.to0 + (value - matched.from0) * scale;
}

function scaleAt(value: number, segments: Segment[]): number {
  const matched = segments.find((item) => value >= item.from0 - EPSILON && value <= item.from1 + EPSILON);
  return matched ? scaleForSegment(matched) : 1;
}

function scaleForSegment(item: Segment): number {
  return Math.abs(item.from1 - item.from0) < EPSILON ? 1 : (item.to1 - item.to0) / (item.from1 - item.from0);
}

function loadLocalPaperTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load(ASSET_PATHS.paperTexture);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.018, 0.018);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createArtworkTextureTarget(): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  return { canvas, texture: createArtworkCanvasTexture(canvas) };
}

function createArtworkCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function parseFoldName(name: string): [string, string, string] | null {
  const parts = name.split("_");
  if (parts.length !== 2 || parts.includes("x")) return null;
  return [name, parts[0], parts[1]];
}

function applyGlobalDielineUv(geometry: THREE.BufferGeometry, face: KnifeFace, totalX: number, totalY: number): void {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!position || !uv) return;

  for (let index = 0; index < uv.count; index += 1) {
    const localX = position.getX(index) / MM_TO_UNIT;
    const localY = -position.getY(index) / MM_TO_UNIT;
    const dielineX = face.x + localX;
    const dielineY = face.y + localY;
    uv.setXY(
      index,
      THREE.MathUtils.clamp(dielineX / totalX, 0, 1),
      THREE.MathUtils.clamp(1 - dielineY / totalY, 0, 1)
    );
  }
  uv.needsUpdate = true;
}

function createArtworkOverlayGeometry(source: THREE.BufferGeometry, side: ArtworkSide): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const normal = geometry.getAttribute("normal");
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];

  let maxZ = -Infinity;
  let minZ = Infinity;
  for (let index = 0; index < position.count; index += 1) {
    maxZ = Math.max(maxZ, position.getZ(index));
    minZ = Math.min(minZ, position.getZ(index));
  }
  const zEpsilon = 1e-4;
  const targetZ = side === "outside" ? maxZ : minZ;
  const normalSign = side === "outside" ? 1 : -1;
  const zOffset = side === "outside" ? 0.02 : -0.02;

  for (let index = 0; index < position.count; index += 3) {
    const z0 = position.getZ(index);
    const z1 = position.getZ(index + 1);
    const z2 = position.getZ(index + 2);
    const nz = normal ? (normal.getZ(index) + normal.getZ(index + 1) + normal.getZ(index + 2)) / 3 : 0;
    if (
      Math.abs(z0 - targetZ) > zEpsilon
      || Math.abs(z1 - targetZ) > zEpsilon
      || Math.abs(z2 - targetZ) > zEpsilon
      || nz * normalSign < 0
    ) {
      continue;
    }

    for (let vertex = index; vertex < index + 3; vertex += 1) {
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex) + zOffset);
      uvs.push(uv.getX(vertex), uv.getY(vertex));
      if (normal) normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
      else normals.push(0, 0, 1);
    }
  }

  const overlay = new THREE.BufferGeometry();
  overlay.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  overlay.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  overlay.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  overlay.computeBoundingBox();
  overlay.computeBoundingSphere();
  geometry.dispose();
  return overlay;
}

function getFaceBounds2D(face: KnifeFace): { w: number; h: number } {
  const points = pathToPoints(face.dlist);
  if (!points.length) return { w: face.w ?? 0, h: face.h ?? 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { w: maxX - minX, h: maxY - minY };
}

function getPathCenter(path: KnifePoint[]): { x: number; y: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of path) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 0, y: 0 };
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
}

function pathToPoints(dlist: KnifePoint[]): KnifePoint[] {
  const points: KnifePoint[] = [];
  let current: KnifePoint | null = null;

  for (const item of dlist) {
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;

    if (item.mtd === "M" || item.mtd === "L") {
      points.push({ x: item.x, y: item.y });
      current = item;
      continue;
    }

    if (item.mtd === "A" && current) {
      const arcPoints = arcToPoints(current, item);
      points.push(...arcPoints);
      current = item;
    }
  }

  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) < EPSILON && Math.abs(first.y - last.y) < EPSILON) {
      points.pop();
    }
  }
  return points;
}

function arcToPoints(start: KnifePoint, end: KnifePoint): KnifePoint[] {
  const rx = Math.abs(end.rx ?? 0);
  const ry = Math.abs(end.ry ?? 0);
  if (rx < EPSILON || ry < EPSILON) return [{ x: end.x, y: end.y }];

  const rotation = THREE.MathUtils.degToRad(end.ang ?? 0);
  const largeArc = Boolean(end.arc);
  const sweep = Boolean(end.dir);
  const cosPhi = Math.cos(rotation);
  const sinPhi = Math.sin(rotation);
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let radiusX = rx;
  let radiusY = ry;
  const radiusScale = (x1p * x1p) / (radiusX * radiusX) + (y1p * y1p) / (radiusY * radiusY);
  if (radiusScale > 1) {
    const scale = Math.sqrt(radiusScale);
    radiusX *= scale;
    radiusY *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = radiusX * radiusX * radiusY * radiusY
    - radiusX * radiusX * y1p * y1p
    - radiusY * radiusY * x1p * x1p;
  const denominator = radiusX * radiusX * y1p * y1p + radiusY * radiusY * x1p * x1p;
  const centerFactor = sign * Math.sqrt(Math.max(0, numerator / Math.max(denominator, EPSILON)));
  const cxp = centerFactor * (radiusX * y1p) / radiusY;
  const cyp = centerFactor * -(radiusY * x1p) / radiusX;
  const centerX = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const centerY = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;

  const startVector = {
    x: (x1p - cxp) / radiusX,
    y: (y1p - cyp) / radiusY
  };
  const endVector = {
    x: (-x1p - cxp) / radiusX,
    y: (-y1p - cyp) / radiusY
  };
  const startAngle = vectorAngle({ x: 1, y: 0 }, startVector);
  let deltaAngle = vectorAngle(startVector, endVector);
  if (!sweep && deltaAngle > 0) deltaAngle -= Math.PI * 2;
  if (sweep && deltaAngle < 0) deltaAngle += Math.PI * 2;

  const segments = Math.max(8, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 12)));
  const points: KnifePoint[] = [];
  for (let index = 1; index <= segments; index += 1) {
    const theta = startAngle + deltaAngle * (index / segments);
    const x = centerX + cosPhi * radiusX * Math.cos(theta) - sinPhi * radiusY * Math.sin(theta);
    const y = centerY + sinPhi * radiusX * Math.cos(theta) + cosPhi * radiusY * Math.sin(theta);
    points.push({ x, y });
  }
  return points;
}

function vectorAngle(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const cross = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y;
  return Math.atan2(cross, dot);
}
