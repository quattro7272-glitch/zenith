/* 3D のステージ照明（Three.js）。ページの奥で常に動き、場面（clock.js の zenith:scene）で色と動きが変わる。
   音が鳴っている時は window.ZENITH_AUDIO.level() に合わせて跳ねる。
   動きを減らす設定（prefers-reduced-motion）では 1 コマだけ描いて止める。WebGL が無ければ写真に置きかわる */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const wrap = document.getElementById('stage3d');
const canvas = document.getElementById('stage3d-canvas');
const flash = document.getElementById('stage3d-flash');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmall = window.matchMedia('(max-width: 767px)').matches;

const SCENES = {
  open:      { beams: ['#7b3fe4', '#22e3ff'], led: ['#7b3fe4', '#22e3ff'], fog: '#07060f', lasers: false, speed: 0.4, energy: 0.5, strobe: false },
  lineup:    { beams: ['#22e3ff', '#9d6bff'], led: ['#22e3ff', '#ffffff'], fog: '#050a14', lasers: false, speed: 1.2, energy: 0.8, strobe: false },
  stages:    { beams: ['#7b3fe4', '#22e3ff', '#ff2fa0'], led: ['#ff2fa0', '#22e3ff'], fog: '#0a0614', lasers: true, speed: 1.0, energy: 0.9, strobe: false },
  timetable: { beams: ['#ff2fa0', '#ffd1e8'], led: ['#ff2fa0', '#7b3fe4'], fog: '#0d0510', lasers: true, speed: 0.9, energy: 0.8, strobe: false },
  zenith:    { beams: ['#ffffff', '#22e3ff', '#ff2fa0', '#7b3fe4'], led: ['#ffffff', '#22e3ff'], fog: '#000000', lasers: true, speed: 1.8, energy: 1.0, strobe: true },
  tickets:   { beams: ['#7b3fe4', '#c9b8ff'], led: ['#7b3fe4', '#1a0f3a'], fog: '#06040c', lasers: false, speed: 0.5, energy: 0.5, strobe: false },
  dawn:      { beams: ['#ffb347', '#ffd9a8'], led: ['#ffb347', '#ff7a59'], fog: '#2a2040', lasers: false, speed: 0.25, energy: 0.3, strobe: false }
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (error) {
  wrap.classList.add('is-fallback');
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall ? 1.25 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07060f');
scene.fog = new THREE.FogExp2('#07060f', 0.03);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 160);
camera.position.set(0, 3.5, 17);
const lookTarget = new THREE.Vector3(0, 4, -12);

/* ---- 地面：暗い面＋光る格子 ---- */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshBasicMaterial({ color: '#06050d' }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(160, 64, '#3a2a7a', '#1d1640');
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.position.y = 0.02;
scene.add(grid);

/* ---- 舞台と骨組み ---- */
const dark = new THREE.MeshBasicMaterial({ color: '#0d0c18' });
const stage = new THREE.Mesh(new THREE.BoxGeometry(26, 1.4, 9), dark);
stage.position.set(0, 0.7, -12);
scene.add(stage);
const truss = new THREE.MeshBasicMaterial({ color: '#2b2840' });
const bar = new THREE.Mesh(new THREE.BoxGeometry(30, 0.35, 0.35), truss);
bar.position.set(0, 10.5, -12);
scene.add(bar);
[-15, 15].forEach((x) => {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 10.5, 0.35), truss);
  post.position.set(x, 5.25, -12);
  scene.add(post);
});

/* ---- LED の壁（シェーダーで光る縦の棒） ---- */
const ledUniforms = {
  uTime: { value: 0 },
  uLevel: { value: 0 },
  uA: { value: new THREE.Color('#7b3fe4') },
  uB: { value: new THREE.Color('#22e3ff') },
  uWhite: { value: 0 }
};
const led = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 9),
  new THREE.ShaderMaterial({
    uniforms: ledUniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uLevel; uniform vec3 uA; uniform vec3 uB; uniform float uWhite;
      varying vec2 vUv;
      void main(){
        float x = vUv.x * 32.0;
        float col = floor(x);
        float h = 0.25 + 0.75 * abs(sin(col * 1.37 + uTime * 2.2)) * (0.45 + 0.55 * uLevel);
        float bar = step(vUv.y, h) * step(0.12, fract(x));
        float scan = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 6.0);
        vec3 c = mix(uA, uB, vUv.y) * (0.3 + 0.6 * uLevel) * (0.75 + 0.25 * scan);
        c = mix(c * bar, vec3(1.0), uWhite);
        gl_FragColor = vec4(c, 1.0);
      }`
  })
);
led.position.set(0, 6, -16);
scene.add(led);

/* ---- ビーム（光の円錐） ---- */
const BEAM_COUNT = isSmall ? 8 : 12;
const beamGeometry = new THREE.ConeGeometry(1.7, 30, 20, 1, true);
beamGeometry.translate(0, -15, 0);   // 先端を根元に
const beams = [];
for (let i = 0; i < BEAM_COUNT; i++) {
  const material = new THREE.MeshBasicMaterial({
    color: '#7b3fe4', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, depthWrite: false
  });
  const beam = new THREE.Mesh(beamGeometry, material);
  const x = -13 + (26 / (BEAM_COUNT - 1)) * i;
  beam.position.set(x, 10.5, -12);
  scene.add(beam);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  lamp.position.copy(beam.position);
  scene.add(lamp);
  beams.push({ mesh: beam, lamp, phase: i * 0.9, target: new THREE.Color('#7b3fe4') });
}

/* ---- レーザー（細い線の扇） ---- */
const LASER_COUNT = 18;
const laserPositions = new Float32Array(LASER_COUNT * 2 * 3);
const laserGeometry = new THREE.BufferGeometry();
laserGeometry.setAttribute('position', new THREE.BufferAttribute(laserPositions, 3));
const laserMaterial = new THREE.LineBasicMaterial({ color: '#22e3ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
const lasers = new THREE.LineSegments(laserGeometry, laserMaterial);
scene.add(lasers);

/* ---- 粒子（舞う光）と、客席のスマホの光 ---- */
const makePoints = (count, box, size, color, opacity) => {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = box.x[0] + Math.random() * (box.x[1] - box.x[0]);
    positions[i * 3 + 1] = box.y[0] + Math.random() * (box.y[1] - box.y[0]);
    positions[i * 3 + 2] = box.z[0] + Math.random() * (box.z[1] - box.z[0]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color, size, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return { points, positions, box, count };
};
const dust = makePoints(isSmall ? 500 : 1200, { x: [-34, 34], y: [0, 20], z: [-30, 14] }, 0.14, '#ffffff', 0.55);
const crowd = makePoints(isSmall ? 180 : 420, { x: [-26, 26], y: [1.1, 2.2], z: [-4, 13] }, 0.1, '#22e3ff', 0.7);

/* ---- にじむ光（bloom） ---- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.1, 0.55, 0.12);
composer.addPass(bloom);

/* ---- 場面・入力 ---- */
let current = SCENES[document.body.dataset.scene] || SCENES.open;
let currentName = document.body.dataset.scene || 'open';
const fogTarget = new THREE.Color(current.fog);
const ledA = new THREE.Color(current.led[0]);
const ledB = new THREE.Color(current.led[1]);
let laserTarget = current.lasers ? 0.55 : 0;
let bloomTarget = 1.1;
let scrollProgress = 0;
const mouse = { x: 0, y: 0 };
let strobeBeat = -1;
let firstScene = true;   // 開いた直後は閃光を出さない（#zenith を直接開いた時に、いきなり白くならないように）

const setScene = (name) => {
  current = SCENES[name] || SCENES.open;
  currentName = name;
  fogTarget.set(current.fog);
  ledA.set(current.led[0]);
  ledB.set(current.led[1]);
  laserTarget = current.lasers ? 0.55 : 0;
  beams.forEach((beam, i) => beam.target.set(current.beams[i % current.beams.length]));
  if (name === 'zenith' && !reducedMotion && !firstScene) {
    flash.classList.remove('is-on');
    void flash.offsetWidth;   // アニメーションを最初から
    flash.classList.add('is-on');
    bloom.strength = 3;
  }
  bloomTarget = name === 'zenith' ? 1.6 : name === 'dawn' ? 0.7 : 1.1;
  firstScene = false;
  if (reducedMotion) renderOnce();
};

document.addEventListener('zenith:scene', (event) => setScene(event.detail.scene));
document.addEventListener('zenith:tick', (event) => { scrollProgress = event.detail.progress || 0; });
window.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  mouse.x = (event.clientX / window.innerWidth - 0.5) * 2;
  mouse.y = (event.clientY / window.innerHeight - 0.5) * 2;
}, { passive: true });

const resize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (reducedMotion) renderOnce();
};
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });

/* ---- 毎コマの更新 ---- */
const clock = new THREE.Clock();
let elapsed = 0;

const update = (delta) => {
  elapsed += delta * current.speed;
  const audio = window.ZENITH_AUDIO;
  const soundOn = audio && audio.isOn();
  const level = soundOn ? audio.level() : 0.25 + 0.25 * Math.pow(Math.max(0, Math.cos((audio ? audio.beatPhase() : 0) * Math.PI * 2)), 6);
  const energy = current.energy * (0.6 + 0.8 * level);

  scene.fog.color.lerp(fogTarget, 0.04);
  scene.background.copy(scene.fog.color);
  ledUniforms.uTime.value = elapsed;
  ledUniforms.uLevel.value = level;
  ledUniforms.uA.value.lerp(ledA, 0.05);
  ledUniforms.uB.value.lerp(ledB, 0.05);

  // 00:00 だけ、拍ごとに白くまたたく
  let white = 0;
  if (current.strobe && soundOn) {
    const beat = Math.floor(audio.beatPhase() * 4);
    if (beat !== strobeBeat) { strobeBeat = beat; white = 1; }
  }
  ledUniforms.uWhite.value = Math.max(white, ledUniforms.uWhite.value * 0.8);

  beams.forEach((beam, i) => {
    const t = elapsed + beam.phase;
    beam.mesh.rotation.z = Math.sin(t * 0.9) * 0.75 * (i % 2 ? 1 : -1);
    beam.mesh.rotation.x = Math.cos(t * 0.6 + i) * 0.45 - 0.2;
    beam.mesh.material.color.lerp(beam.target, 0.05);
    beam.mesh.material.opacity = 0.05 + 0.2 * energy;
    beam.lamp.material.color.copy(beam.mesh.material.color).multiplyScalar(1.5);
  });

  laserMaterial.opacity += (laserTarget * (0.5 + level) - laserMaterial.opacity) * 0.06;
  laserMaterial.color.lerp(ledB, 0.05);
  if (laserMaterial.opacity > 0.01) {
    const sweep = Math.sin(elapsed * 1.4) * 0.6;
    for (let i = 0; i < LASER_COUNT; i++) {
      const angle = -1.1 + (2.2 / (LASER_COUNT - 1)) * i + sweep;
      const base = i * 6;
      laserPositions[base] = 0; laserPositions[base + 1] = 9.6; laserPositions[base + 2] = -12;
      laserPositions[base + 3] = Math.sin(angle) * 60;
      laserPositions[base + 4] = 9.6 + Math.cos(angle) * 40 * (0.3 + 0.7 * Math.abs(Math.sin(elapsed * 0.7 + i)));
      laserPositions[base + 5] = -12 + Math.cos(angle) * 30;
    }
    laserGeometry.attributes.position.needsUpdate = true;
  }

  const rise = delta * (0.4 + energy * 1.6);
  for (let i = 0; i < dust.count; i++) {
    let y = dust.positions[i * 3 + 1] + rise;
    if (y > dust.box.y[1]) y = dust.box.y[0];
    dust.positions[i * 3 + 1] = y;
  }
  dust.points.geometry.attributes.position.needsUpdate = true;
  dust.points.material.opacity = 0.3 + 0.5 * energy;
  crowd.points.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(elapsed * 3));
  crowd.points.material.color.lerp(ledB, 0.05);

  bloom.strength += (bloomTarget + level * 0.5 - bloom.strength) * 0.05;

  camera.position.x += ((mouse.x * 2.2) - camera.position.x) * 0.04;
  camera.position.y += ((3.5 + scrollProgress * 2.5 - mouse.y * 0.8) - camera.position.y) * 0.04;
  camera.position.z = 17 - scrollProgress * 3;
  camera.lookAt(lookTarget);
};

const renderOnce = () => {
  update(0.016);
  composer.render();
};

let rafId = null;
const loop = () => {
  rafId = requestAnimationFrame(loop);
  const delta = Math.min(clock.getDelta(), 0.05);
  update(delta);
  composer.render();
};

document.addEventListener('visibilitychange', () => {
  if (reducedMotion) return;
  if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
  else if (rafId === null) { clock.getDelta(); loop(); }
});

setScene(currentName);
if (reducedMotion) {
  // 色が落ち着くまで数コマ回してから 1 枚だけ描く
  for (let i = 0; i < 60; i++) update(0.016);
  composer.render();
} else {
  loop();
}
