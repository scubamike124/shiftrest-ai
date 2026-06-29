// 3D Ready Player Me head with idle breathing, blinks, gaze saccades, and
// speech-driven viseme morphs. Lazy-loaded so the Three.js bundle never
// reaches non-companion routes.
//
// If the GLB fails to load, the parent renders the 2D portrait fallback.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { KTX2Loader } from "three-stdlib";
import { cn } from "@/lib/utils";
import type { OrbState } from "@/components/PilotOrb";
import { useAvatar } from "@/lib/companion/use-avatar";
import { modelUrlFor } from "@/lib/companion/avatar-models";

type Props = {
  state: OrbState;
  level?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  onFail?: () => void;
};

const SIZE_PX = { sm: 40, md: 80, lg: 224 } as const;

// Map analyser RMS + heuristic visemes to ARKit / Oculus blendshape names.
const JAW_KEYS = ["jawOpen", "viseme_aa", "mouthOpen"];
const SMILE_KEYS = ["mouthSmileLeft", "mouthSmileRight", "mouthSmile"];
const BLINK_L = ["eyeBlinkLeft", "eyesClosed"];
const BLINK_R = ["eyeBlinkRight"];
const BROW_KEYS = ["browInnerUp", "browUp"];

function findMorphTarget(scene: THREE.Object3D, names: string[]): { mesh: THREE.Mesh; index: number } | null {
  let found: { mesh: THREE.Mesh; index: number } | null = null;
  scene.traverse((obj) => {
    if (found) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
    for (const n of names) {
      const idx = mesh.morphTargetDictionary[n];
      if (typeof idx === "number") {
        found = { mesh, index: idx };
        return;
      }
    }
  });
  return found;
}

function setMorph(target: { mesh: THREE.Mesh; index: number } | null, value: number) {
  if (!target || !target.mesh.morphTargetInfluences) return;
  target.mesh.morphTargetInfluences[target.index] = value;
}

const BASIS_TRANSCODER_PATH =
  "https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/libs/basis/";

let cachedKTX2Loader: KTX2Loader | null = null;

function getKTX2Loader(): KTX2Loader | null {
  if (cachedKTX2Loader) return cachedKTX2Loader;
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(BASIS_TRANSCODER_PATH);
    ktx2.detectSupport(renderer);
    renderer.dispose();
    cachedKTX2Loader = ktx2;
    return cachedKTX2Loader;
  } catch (err) {
    console.warn("KTX2Loader init failed; 3D textures may not decode", err);
    return null;
  }
}

function configureKTX2Loader(loader: { setKTX2Loader?: (l: KTX2Loader) => void }) {
  const ktx2 = getKTX2Loader();
  if (ktx2 && loader.setKTX2Loader) {
    loader.setKTX2Loader(ktx2);
  }
}

function HeadModel({ url, state }: {
  url: string;
  state: OrbState;
  level?: number;
  onFail?: () => void;
}) {
  const gltf = useGLTF(url, true, true, configureKTX2Loader);
  const group = useRef<THREE.Group>(null);
  const liveLevelRef = useRef(0);

  // Subscribe to live amplitude from speak.ts
  useEffect(() => {
    const onLvl = (e: Event) => {
      const d = (e as CustomEvent<{ rms: number }>).detail;
      const raw = Math.max(0, Math.min(1, d?.rms ?? 0));
      liveLevelRef.current = liveLevelRef.current * 0.4 + raw * 0.6;
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    return () => window.removeEventListener("companion:audio-level", onLvl as EventListener);
  }, []);

  // Cache morph target handles for the loaded scene.
  const morphs = useMemo(() => ({
    jaw: findMorphTarget(gltf.scene, JAW_KEYS),
    smileL: findMorphTarget(gltf.scene, ["mouthSmileLeft"]),
    smileR: findMorphTarget(gltf.scene, ["mouthSmileRight"]),
    smile: findMorphTarget(gltf.scene, SMILE_KEYS),
    blinkL: findMorphTarget(gltf.scene, BLINK_L),
    blinkR: findMorphTarget(gltf.scene, BLINK_R),
    brow: findMorphTarget(gltf.scene, BROW_KEYS),
  }), [gltf.scene]);

  // Blink scheduler — drives a target value the rAF lerps toward.
  const blinkTarget = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      const next = 2200 + Math.random() * 3200;
      setTimeout(() => {
        if (cancelled) return;
        blinkTarget.current = 1;
        setTimeout(() => { if (!cancelled) blinkTarget.current = 0; }, 110);
        // Occasional double-blink
        if (Math.random() < 0.18) {
          setTimeout(() => {
            if (cancelled) return;
            blinkTarget.current = 1;
            setTimeout(() => { if (!cancelled) blinkTarget.current = 0; }, 100);
          }, 240);
        }
        loop();
      }, next);
    };
    loop();
    return () => { cancelled = true; };
  }, []);

  // Saccade scheduler — random gaze targets.
  const gazeTarget = useRef(new THREE.Vector3(0, 0, 1));
  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      const next = 1800 + Math.random() * 2600;
      setTimeout(() => {
        if (cancelled) return;
        gazeTarget.current.set(
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.3,
          1,
        );
        loop();
      }, next);
    };
    loop();
    return () => { cancelled = true; };
  }, []);

  const blinkLP = useRef(0);
  const jawLP = useRef(0);

  useFrame((_, dt) => {
    if (!group.current) return;
    const t = performance.now() / 1000;

    // Breathing — gentle Y scale on the root.
    const breath = Math.sin(t * 1.05) * 0.006 + 0.998;
    group.current.scale.setScalar(breath);

    // Head sway.
    const swayX = Math.sin(t * 0.7) * 0.02;
    const swayY = Math.sin(t * 0.5 + 1.2) * 0.025;
    const lean = state === "listening" ? 0.04 : 0;
    group.current.rotation.x = swayX - lean;
    group.current.rotation.y = swayY + gazeTarget.current.x * 0.15;

    // Blink lerp.
    blinkLP.current += (blinkTarget.current - blinkLP.current) * Math.min(1, dt * 18);
    setMorph(morphs.blinkL, blinkLP.current);
    setMorph(morphs.blinkR, blinkLP.current * 0.95);

    // Speech → jaw.
    const speakingLvl = state === "speaking" ? liveLevelRef.current : 0;
    const targetJaw = Math.min(1, Math.pow(speakingLvl * 4.5, 0.6));
    jawLP.current += (targetJaw - jawLP.current) * Math.min(1, dt * 14);
    setMorph(morphs.jaw, jawLP.current * 0.85);

    // Subtle smile baseline; brow lift during speech.
    setMorph(morphs.smile, 0.18);
    setMorph(morphs.smileL, 0.18);
    setMorph(morphs.smileR, 0.18);
    setMorph(morphs.brow, state === "speaking" ? jawLP.current * 0.35 : 0.08);
  });

  return (
    <group ref={group} position={[0, -1.45, 0]}>
      <primitive object={gltf.scene} />
    </group>
  );
}

function ErrorTrap({ children, onError }: { children: React.ReactNode; onError: () => void }) {
  // Three.js loader errors propagate as thrown promises; this catches them
  // by listening for unhandled rejections. Host-agnostic so the bundled
  // default GLB and any custom URL are both covered → parent then falls
  // back to the 2D portrait.
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      const msg = String(e.reason ?? "").toLowerCase();
      if (
        msg.includes("gltf") ||
        msg.includes(".glb") ||
        msg.includes("could not load") ||
        msg.includes("failed to load") ||
        msg.includes("readyplayer")
      ) {
        onError();
      }
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, [onError]);
  return <>{children}</>;
}

export default function Avatar3D({ state, level = 0, size = "lg", className, onFail }: Props) {
  const px = SIZE_PX[size];
  const { id } = useAvatar();
  const url = modelUrlFor(id);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) onFail?.();
  }, [url, onFail]);

  useEffect(() => {
    if (failed) onFail?.();
  }, [failed, onFail]);

  if (!url || failed) return null;

  return (
    <div
      className={cn("relative overflow-hidden rounded-full bg-gradient-to-b from-indigo-950/40 to-slate-900/40", className)}
      style={{ width: px, height: px }}
      data-renderer="3d"
    >
      <Canvas
        camera={{ position: [0, 0.05, 0.85], fov: 28 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            setFailed(true);
          });
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[2, 3, 4]} intensity={1.1} color={"#fff6e8"} />
        <directionalLight position={[-3, 1, 2]} intensity={0.45} color={"#bcd8ff"} />
        <ErrorTrap onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <HeadModel url={url} state={state} level={level} onFail={() => setFailed(true)} />
          </Suspense>
        </ErrorTrap>
      </Canvas>
    </div>
  );
}

// Preload helper for the picker / hero entrypoint.
export function preloadAvatarModel(id: string | null | undefined) {
  const url = modelUrlFor(id);
  if (url) useGLTF.preload(url);
}
