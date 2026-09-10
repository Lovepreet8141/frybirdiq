"use client";

/**
 * The FRYBIRD badge, as a coin you can spin.
 *
 * design-system/3d.md sets the terms this has to meet, and they are all
 * load-bearing rather than decorative:
 *
 *   - never in the bundle for a page that does not render it (dynamic import)
 *   - never blocks LCP (mounts after paint, behind an idle callback)
 *   - a finished-looking fallback when WebGL is missing or refused
 *   - correct under reduced motion
 *   - "Turn WebGL off. If the page still sells the food and takes the order,
 *      the 3D was an enhancement." Everything here is aria-hidden and sits
 *      behind the copy; the order button does not depend on it.
 *
 * Textures are drawn on a canvas from the wordmark and the brand palette
 * rather than loaded as images. There are no photographic assets for the
 * badge, and a procedural face is sharp at any density, themeable, and costs
 * nothing against the 1.5 MB budget.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

const EMBER = 0xc21f11;
const AMBER = 0xf2a324;
const CREAM = "#F5EDD8";

/** Draws the front face: ember disc, amber ring, wordmark across the middle. */
function faceTexture(wordmark: HTMLImageElement | null): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const c = size / 2;

  g.fillStyle = "#C21F11";
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();

  // A lit edge, so the face reads as struck metal rather than a flat circle
  // even before the scene lights touch it.
  const sheen = g.createRadialGradient(c * 0.72, c * 0.6, 0, c, c, c);
  sheen.addColorStop(0, "rgba(242,163,36,0.28)");
  sheen.addColorStop(0.55, "rgba(242,163,36,0.05)");
  sheen.addColorStop(1, "rgba(31,7,5,0.45)");
  g.fillStyle = sheen;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = "#F2A324";
  g.lineWidth = size * 0.022;
  g.beginPath();
  g.arc(c, c, c * 0.9, 0, Math.PI * 2);
  g.stroke();

  g.strokeStyle = "rgba(245,237,216,0.35)";
  g.lineWidth = size * 0.006;
  g.beginPath();
  g.arc(c, c, c * 0.82, 0, Math.PI * 2);
  g.stroke();

  if (wordmark && wordmark.complete && wordmark.naturalWidth > 0) {
    const w = size * 0.62;
    const h = (w * wordmark.naturalHeight) / wordmark.naturalWidth;
    g.drawImage(wordmark, c - w / 2, c - h / 2, w, h);
  } else {
    // The wordmark is an enhancement of an enhancement. If it has not loaded,
    // the coin still reads as FRYBIRD rather than as a blank disc.
    g.fillStyle = CREAM;
    g.font = `900 ${size * 0.15}px Archivo, Helvetica, Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.letterSpacing = `${size * 0.01}px`;
    g.fillText("FRYBIRD", c, c);
  }

  g.fillStyle = "rgba(245,237,216,0.6)";
  g.font = `600 ${size * 0.038}px Manrope, Helvetica, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.letterSpacing = `${size * 0.012}px`;
  g.fillText("SECTOR 9 · AMBALA CITY", c, c + size * 0.3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** The reverse: charred field, amber ring, the tagline struck into it. */
function reverseTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const c = size / 2;

  g.fillStyle = "#2B0B07";
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = "#F2A324";
  g.lineWidth = size * 0.022;
  g.beginPath();
  g.arc(c, c, c * 0.9, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = "#F2A324";
  g.font = `900 ${size * 0.1}px Archivo, Helvetica, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("BORN", c, c - size * 0.11);
  g.fillText("CRISPY", c, c);
  g.fillStyle = CREAM;
  g.fillText("BUILT BOLD", c, c + size * 0.12);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function emberSprite(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,225,170,1)");
  grad.addColorStop(0.35, "rgba(242,163,36,0.75)");
  grad.addColorStop(1, "rgba(242,163,36,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export default function BadgeScene({ onReady }: { onReady?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // `onReady` must be referentially stable — the caller wraps it in
  // useCallback. An inline arrow would change identity on every render, and
  // since it is in this effect's dependency array that would dispose the
  // renderer and build a new GPU context each time the first frame reports
  // back. A browser allows only a handful of contexts before it starts
  // killing the oldest.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Probe before constructing. THREE.WebGLRenderer logs its own console
    // error on the way to throwing, which surfaces in the Next dev overlay and
    // in any error reporter as though something had actually gone wrong — on a
    // machine that simply has no WebGL, nothing has.
    const probe = document.createElement("canvas");
    let supported = false;
    try {
      supported = Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
    } catch {
      supported = false;
    }
    if (!supported) {
      // The poster underneath is already visible and is the finished state.
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 9);

    const wordmark = new Image();
    wordmark.src = "/frybird-wordmark.svg";

    const R = 2.55;
    const T = 0.34;
    const coin = new THREE.Group();
    const disposables: { dispose(): void }[] = [];

    const rimGeo = new THREE.CylinderGeometry(R, R, T, 128, 1, true);
    const rimMat = new THREE.MeshStandardMaterial({ color: AMBER, metalness: 0.6, roughness: 0.32, side: THREE.DoubleSide });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    coin.add(rim);
    disposables.push(rimGeo, rimMat);

    const frontGeo = new THREE.CircleGeometry(R, 128);
    const frontMap = faceTexture(null);
    const frontMat = new THREE.MeshStandardMaterial({ map: frontMap, roughness: 0.55, metalness: 0.08 });
    const front = new THREE.Mesh(frontGeo, frontMat);
    front.position.z = T / 2;
    coin.add(front);
    disposables.push(frontGeo, frontMat, frontMap);

    // Redraw the face once the wordmark decodes, so a slow SVG never leaves a
    // blank coin and never delays the first frame either.
    wordmark.onload = () => {
      const next = faceTexture(wordmark);
      frontMat.map?.dispose();
      frontMat.map = next;
      frontMat.needsUpdate = true;
      disposables.push(next);
    };

    const backGeo = new THREE.CircleGeometry(R, 128);
    const backMap = reverseTexture();
    const backMat = new THREE.MeshStandardMaterial({ map: backMap, roughness: 0.62, metalness: 0.05 });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.z = -T / 2;
    back.rotation.y = Math.PI;
    coin.add(back);
    disposables.push(backGeo, backMat, backMap);

    scene.add(coin);

    scene.add(new THREE.AmbientLight(0xffd9c0, 0.55));
    const key = new THREE.DirectionalLight(0xfff3e2, 2.1);
    key.position.set(4, 6, 8);
    scene.add(key);
    const fire = new THREE.PointLight(AMBER, 2.6, 24);
    fire.position.set(-4.2, -2.6, 4.4);
    scene.add(fire);
    const rimLight = new THREE.PointLight(EMBER, 2.2, 26);
    rimLight.position.set(5.5, 1.2, -3.5);
    scene.add(rimLight);

    // Embers cost a per-frame loop over 380 points. Under reduced motion they
    // would sit frozen mid-air, which looks broken rather than calm, so they
    // are not created at all.
    const COUNT = reduceMotion ? 0 : 320;
    const positions = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    const drifts = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
      speeds[i] = 0.006 + Math.random() * 0.016;
      drifts[i] = Math.random() * Math.PI * 2;
    }
    let emberGeo: THREE.BufferGeometry | null = null;
    if (COUNT > 0) {
      emberGeo = new THREE.BufferGeometry();
      emberGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const sprite = emberSprite();
      const emberMat = new THREE.PointsMaterial({
        size: 0.13,
        map: sprite,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      scene.add(new THREE.Points(emberGeo, emberMat));
      disposables.push(emberGeo, emberMat, sprite);
    }

    // How far right the coin sits, in world units. The copy occupies the left
    // of the hero; a centred coin lands on top of the lede and makes it
    // unreadable, which is the opposite of what a hero is for.
    let offsetX = 2.7;

    function layout() {
      const w = host!.clientWidth;
      const h = host!.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Narrower viewports leave less clear space beside the text, so the coin
      // moves further out and shrinks rather than crowding it.
      offsetX = w >= 1600 ? 3.4 : w >= 1280 ? 3.1 : 2.8;
      coin.position.x = offsetX;
      camera.updateProjectionMatrix();
    }
    layout();

    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(host);

    let spin = 0;
    let spinVel = 0;
    const idleSpin = reduceMotion ? 0 : 0.0032;
    let pointerX = 0;
    let pointerY = 0;
    let dragging = false;
    let lastX = 0;
    let tiltX = 0;

    canvas.style.touchAction = "pan-y";
    canvas.style.cursor = "grab";

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      const r = host!.getBoundingClientRect();
      pointerX = (e.clientX - r.left) / r.width - 0.5;
      pointerY = (e.clientY - r.top) / r.height - 0.5;
      if (dragging) {
        spinVel += (e.clientX - lastX) * 0.0022;
        lastX = e.clientX;
      }
    };
    const endDrag = () => {
      dragging = false;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
    }, { threshold: 0.02 });
    io.observe(host);

    const t0 = performance.now();
    const INTRO = reduceMotion ? 0 : 1400;
    let raf = 0;
    let signalled = false;

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      // Off-screen the loop keeps its slot but does no GPU work, so scrolling
      // past the hero stops costing battery.
      if (!visible) return;

      const t = (now - t0) / 1000;
      const p = INTRO ? Math.min((now - t0) / INTRO, 1) : 1;
      const e = 1 - Math.pow(1 - p, 3);

      spinVel *= 0.94;
      spin += idleSpin + spinVel;

      coin.rotation.y = spin + (1 - e) * -2.2;
      tiltX += (pointerY * 0.3 - tiltX) * 0.05;
      coin.rotation.x = reduceMotion ? 0 : tiltX;
      coin.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.5) * 0.035;
      coin.scale.setScalar(0.9 * (0.82 + 0.18 * e));
      coin.position.y = (reduceMotion ? 0 : Math.sin(t * 0.9) * 0.09) + (1 - e) * -0.8;

      camera.position.x += (pointerX * 0.7 - camera.position.x) * 0.04;
      camera.lookAt(offsetX * 0.35, 0, 0);

      if (!reduceMotion) {
        fire.intensity = 2.6 + Math.sin(t * 7.3) * 0.25 + Math.sin(t * 3.1) * 0.18;
      }

      if (emberGeo && !reduceMotion) {
        const arr = emberGeo.attributes.position!.array as Float32Array;
        for (let i = 0; i < COUNT; i++) {
          const yi = i * 3 + 1;
          const height = (arr[yi] ?? 0) + (speeds[i] ?? 0);
          arr[yi] = height > 7.5 ? -7.5 : height;
          arr[i * 3] =
            height > 7.5
              ? (Math.random() - 0.5) * 16
              : (arr[i * 3] ?? 0) + Math.sin(t * 0.6 + (drifts[i] ?? 0)) * 0.0022;
        }
        emberGeo.attributes.position!.needsUpdate = true;
      }

      renderer.render(scene, camera);

      if (!signalled) {
        signalled = true;
        onReady?.();
      }
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      // §140: disposable. A route change must not leak a GPU context — a
      // browser only allows a handful before it starts killing the oldest.
      for (const item of disposables) item.dispose();
      renderer.dispose();
    };
  }, [onReady]);

  return (
    <div ref={hostRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
