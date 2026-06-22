import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { ASSET_PATHS } from "./config";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  resize: () => void;
  render: () => void;
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6f4ef);

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  camera.position.set(390, 310, 520);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 140, 0);
  controls.minDistance = 260;
  controls.maxDistance = 1050;

  addGround(scene);
  loadEnvironment(scene, renderer);

  const resize = () => {
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(rect.height, 1);
    camera.updateProjectionMatrix();
  };

  const render = () => renderer.render(scene, camera);
  window.addEventListener("resize", resize);
  resize();

  return { scene, camera, renderer, controls, resize, render };
}

function loadEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  new RGBELoader().load(
    ASSET_PATHS.environmentHdr,
    (texture) => {
      const environment = pmrem.fromEquirectangular(texture).texture;
      scene.environment = environment;
      texture.dispose();
      pmrem.dispose();
    },
    undefined,
    () => {
      pmrem.dispose();
    }
  );
}

function addGround(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 900),
    new THREE.ShadowMaterial({ color: 0x736b5e, opacity: 0.14 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  ground.receiveShadow = true;
  scene.add(ground);
}
