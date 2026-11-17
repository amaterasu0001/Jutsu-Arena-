import * as THREE from 'three';

import { clamp, easeInCubic, easeOutCubic, lerp, rand, type Dispose } from '../engine';

const DURATION = 3.6;
const GROW = 0.7;
const BURST = 2.5;

function glowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.25, 'rgba(150, 205, 255, 0.7)');
  gradient.addColorStop(1, 'rgba(40, 110, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Rotating 3D energy sphere: a bright core, counter-rotating shells and rings,
 * orbiting particles, then an outward burst. Throws if WebGL is unavailable.
 */
export function runSphereEffect(container: HTMLElement, quality: number, onDone: () => void): Dispose {
  const rect = container.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: quality >= 0.7, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality >= 1 ? 2 : 1.25));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'absolute inset-0 h-full w-full';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.z = 7.5;

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;

  const orb = new THREE.Group();
  scene.add(orb);

  // core and soft shells
  const coreMaterial = track(new THREE.MeshBasicMaterial({ color: 0xeaf5ff, ...additive }));
  orb.add(new THREE.Mesh(track(new THREE.SphereGeometry(0.62, 40, 40)), coreMaterial));
  const shellMaterial = track(new THREE.MeshBasicMaterial({ color: 0x4aa3ff, opacity: 0.35, ...additive }));
  orb.add(new THREE.Mesh(track(new THREE.SphereGeometry(1, 40, 40)), shellMaterial));

  // counter-rotating wire shells give the "spinning" read
  const wireMaterial = track(new THREE.MeshBasicMaterial({ color: 0xbfe1ff, wireframe: true, opacity: 0.5, ...additive }));
  const wireA = new THREE.Mesh(track(new THREE.IcosahedronGeometry(1.06, 2)), wireMaterial);
  const wireB = new THREE.Mesh(track(new THREE.IcosahedronGeometry(1.18, 1)), wireMaterial);
  orb.add(wireA, wireB);

  // energy rings and trailing arcs
  const ringMaterial = track(new THREE.MeshBasicMaterial({ color: 0x9fd0ff, opacity: 0.85, ...additive }));
  const rings: Array<{ mesh: THREE.Mesh; speed: number }> = [];
  const ringCount = Math.round(4 + 4 * quality);
  for (let i = 0; i < ringCount; i += 1) {
    const arc = i < 3 ? Math.PI * 2 : rand(1.2, 3.4);
    const geometry = track(new THREE.TorusGeometry(rand(1.1, 1.9), rand(0.008, 0.022), 8, 96, arc));
    const mesh = new THREE.Mesh(geometry, ringMaterial);
    mesh.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
    rings.push({ mesh, speed: rand(3, 8) * (i % 2 ? 1 : -1) });
    orb.add(mesh);
  }

  // orbiting particles
  const particleCount = Math.round(700 * quality);
  const positions = new Float32Array(particleCount * 3);
  const orbits = Array.from({ length: particleCount }, () => ({
    radius: rand(1.25, 3.1),
    angle: rand(0, Math.PI * 2),
    speed: rand(1.5, 5.5) * (Math.random() < 0.5 ? 1 : -1),
    inclination: rand(-1.2, 1.2),
    node: rand(0, Math.PI * 2),
  }));
  const particleGeometry = track(new THREE.BufferGeometry());
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const sprite = track(glowTexture());
  const particleMaterial = track(new THREE.PointsMaterial({ color: 0xa6d6ff, size: 0.11, map: sprite, ...additive }));
  scene.add(new THREE.Points(particleGeometry, particleMaterial));

  // large halo behind everything
  const haloMaterial = track(new THREE.SpriteMaterial({ map: sprite, color: 0x4f9dff, opacity: 0.7, ...additive }));
  const halo = new THREE.Sprite(haloMaterial);
  scene.add(halo);

  let raf = 0;
  let finished = false;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    disposables.forEach((item) => item.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };

  const started = performance.now();
  const loop = (now: number) => {
    const t = (now - started) / 1000;
    if (t >= DURATION) {
      finished = true;
      cleanup();
      onDone();
      return;
    }
    const grow = easeOutCubic(t / GROW);
    const burst = clamp((t - BURST) / 0.6);
    const fade = 1 - clamp((t - 3.0) / 0.6);
    const pulse = 1 + 0.035 * Math.sin(t * 24);
    const scale = lerp(0.05, 1 + clamp((t - GROW) / (BURST - GROW)) * 0.25, grow) * pulse * (1 + easeInCubic(burst) * 3.4);

    orb.scale.setScalar(scale);
    orb.rotation.y = t * 2.2;
    orb.rotation.x = Math.sin(t * 0.9) * 0.3;
    wireA.rotation.set(t * 3.1, t * 4.3, 0);
    wireB.rotation.set(-t * 2.4, 0, t * 3.7);
    for (const ring of rings) ring.mesh.rotation.z += ring.speed * 0.016;

    const spread = scale * (1 + burst * 0.8);
    for (let i = 0; i < particleCount; i += 1) {
      const orbit = orbits[i];
      const angle = orbit.angle + t * orbit.speed;
      const x = Math.cos(angle) * orbit.radius;
      const flat = Math.sin(angle) * orbit.radius;
      const y = flat * Math.sin(orbit.inclination);
      const z = flat * Math.cos(orbit.inclination);
      positions[i * 3] = (x * Math.cos(orbit.node) - z * Math.sin(orbit.node)) * spread;
      positions[i * 3 + 1] = y * spread;
      positions[i * 3 + 2] = (x * Math.sin(orbit.node) + z * Math.cos(orbit.node)) * spread;
    }
    particleGeometry.attributes.position.needsUpdate = true;

    coreMaterial.opacity = fade;
    shellMaterial.opacity = 0.35 * fade;
    wireMaterial.opacity = 0.5 * fade * (1 - burst * 0.6);
    ringMaterial.opacity = 0.85 * fade;
    particleMaterial.opacity = grow * fade;
    haloMaterial.opacity = 0.7 * grow * fade;
    halo.scale.setScalar(scale * 6.5);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    if (!finished) cleanup();
  };
}
