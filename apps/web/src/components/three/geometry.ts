import * as THREE from "three";

/** Deterministic PRNG so every render of a scene looks identical. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Profile = { x: number; y: number; nx: number; ny: number }[];

/**
 * Rounded-rectangle cross-section (a superellipse) with analytic normals.
 * `w` is the extent along the curve normal, `h` along the binormal.
 */
export function roundedRectProfile(w: number, h: number, n = 4, count = 28): Profile {
  const pts: Profile = [];
  const a = w / 2;
  const b = h / 2;
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const x = a * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n);
    const y = b * Math.sign(st) * Math.pow(Math.abs(st), 2 / n);
    let nx = (Math.sign(x) * Math.pow(Math.abs(x) / a, n - 1)) / a;
    let ny = (Math.sign(y) * Math.pow(Math.abs(y) / b, n - 1)) / b;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    pts.push({ x, y, nx, ny });
  }
  return pts;
}

export function circleProfile(r: number, count = 16): Profile {
  const pts: Profile = [];
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2;
    pts.push({ x: r * Math.cos(th), y: r * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th) });
  }
  return pts;
}

/** A smooth, wandering spine through space. */
export function randomSpine(
  seed: number,
  points = 6,
  spread: [number, number, number] = [3, 2, 1.2],
) {
  const rnd = mulberry32(seed);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    pts.push(
      new THREE.Vector3(
        (t - 0.5) * 2 * spread[0] + (rnd() - 0.5) * spread[0] * 0.5,
        (rnd() - 0.5) * 2 * spread[1],
        (rnd() - 0.5) * 2 * spread[2],
      ),
    );
  }
  return new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
}

/** A sine-wave spine along X, used for the wide twisted ribbons. */
export function waveSpine(length: number, amplitude: number, waves: number, phase = 0, z = 0) {
  const pts: THREE.Vector3[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(
      new THREE.Vector3(
        (t - 0.5) * length,
        Math.sin(t * Math.PI * 2 * waves + phase) * amplitude,
        z + Math.cos(t * Math.PI * 2 * waves * 0.5 + phase) * amplitude * 0.25,
      ),
    );
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

/**
 * A helix wound around an arbitrary spine, like a cartoon alpha helix that
 * wanders through space.
 */
export class CoilCurve extends THREE.Curve<THREE.Vector3> {
  private frames: ReturnType<THREE.Curve<THREE.Vector3>["computeFrenetFrames"]>;

  constructor(
    private spine: THREE.Curve<THREE.Vector3>,
    private radius: number,
    private turns: number,
    private samples = 240,
  ) {
    super();
    this.frames = spine.computeFrenetFrames(samples, false);
  }

  getPoint(t: number, target = new THREE.Vector3()) {
    const p = this.spine.getPointAt(t);
    const idx = t * this.samples;
    const i0 = Math.min(Math.floor(idx), this.samples);
    const i1 = Math.min(i0 + 1, this.samples);
    const f = idx - i0;
    const n = this.frames.normals[i0].clone().lerp(this.frames.normals[i1], f).normalize();
    const b = this.frames.binormals[i0].clone().lerp(this.frames.binormals[i1], f).normalize();
    const phi = t * this.turns * Math.PI * 2;
    return target
      .copy(p)
      .addScaledVector(n, Math.cos(phi) * this.radius)
      .addScaledVector(b, Math.sin(phi) * this.radius);
  }
}

/**
 * Sweeps a 2-D profile along a curve. Normals are analytic so the result
 * shades smoothly along the length and keeps crisp edges across it.
 */
export function extrudeProfile(
  curve: THREE.Curve<THREE.Vector3>,
  profile: Profile,
  segments: number,
  twist = 0,
) {
  const frames = curve.computeFrenetFrames(segments, false);
  const P = profile.length;
  const rings = segments + 1;
  const positions = new Float32Array(rings * P * 3);
  const normals = new Float32Array(rings * P * 3);
  const uvs = new Float32Array(rings * P * 2);
  const pos = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();

  for (let i = 0; i < rings; i++) {
    const t = i / segments;
    curve.getPointAt(t, pos);
    const ang = twist * t;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    N.copy(frames.normals[i]).multiplyScalar(c).addScaledVector(frames.binormals[i], s);
    B.copy(frames.binormals[i]).multiplyScalar(c).addScaledVector(frames.normals[i], -s);
    for (let j = 0; j < P; j++) {
      const q = profile[j];
      const k = i * P + j;
      positions[k * 3] = pos.x + N.x * q.x + B.x * q.y;
      positions[k * 3 + 1] = pos.y + N.y * q.x + B.y * q.y;
      positions[k * 3 + 2] = pos.z + N.z * q.x + B.z * q.y;
      normals[k * 3] = N.x * q.nx + B.x * q.ny;
      normals[k * 3 + 1] = N.y * q.nx + B.y * q.ny;
      normals[k * 3 + 2] = N.z * q.nx + B.z * q.ny;
      uvs[k * 2] = j / P;
      uvs[k * 2 + 1] = t;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < P; j++) {
      const a = i * P + j;
      const b = i * P + ((j + 1) % P);
      const c = (i + 1) * P + j;
      const d = (i + 1) * P + ((j + 1) % P);
      // Counter-clockwise as seen from outside so the outer surface is
      // front-facing and lit with the analytic (outward) normals.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Procedural fused-ring "ball and stick" molecule graph. */
export function buildMolecule(seed: number, rings = 6) {
  const rnd = mulberry32(seed);
  const atoms: THREE.Vector3[] = [];
  const bonds: [number, number][] = [];
  const R = 1;

  const hasBond = (a: number, b: number) =>
    bonds.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  const addRing = (cx: number, cy: number) => {
    const idx: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = k * (Math.PI / 3);
      const p = new THREE.Vector3(cx + R * Math.cos(a), cy + R * Math.sin(a), 0);
      let found = atoms.findIndex((q) => q.distanceTo(p) < 0.05);
      if (found < 0) {
        atoms.push(p);
        found = atoms.length - 1;
      }
      idx.push(found);
    }
    for (let k = 0; k < 6; k++) {
      const a = idx[k];
      const b = idx[(k + 1) % 6];
      if (!hasBond(a, b)) bonds.push([a, b]);
    }
  };

  const centers: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  addRing(0, 0);
  const step = 2 * R * Math.cos(Math.PI / 6);
  let guard = 0;
  while (centers.length < rings && guard++ < 60) {
    const base = centers[Math.floor(rnd() * centers.length)];
    const d = ((Math.floor(rnd() * 6) * 60 + 30) * Math.PI) / 180;
    const c = new THREE.Vector2(base.x + step * Math.cos(d), base.y + step * Math.sin(d));
    if (centers.some((q) => q.distanceTo(c) < 0.1)) continue;
    centers.push(c);
    addRing(c.x, c.y);
  }

  // Substituent chains on ring atoms that only have two bonds.
  const degree = new Map<number, number>();
  bonds.forEach(([a, b]) => {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  });
  const candidates = atoms
    .map((_, i) => i)
    .filter((i) => (degree.get(i) ?? 0) === 2);
  const chains = Math.min(6, candidates.length);
  for (let n = 0; n < chains; n++) {
    const start = candidates[Math.floor(rnd() * candidates.length)];
    const p = atoms[start];
    // direction away from the nearest ring center
    let nearest = centers[0];
    for (const c of centers) {
      if (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(nearest.x - p.x, nearest.y - p.y)) nearest = c;
    }
    let dir = Math.atan2(p.y - nearest.y, p.x - nearest.x);
    let prev = start;
    const len = 1 + Math.floor(rnd() * 3);
    let cur = p.clone();
    for (let k = 0; k < len; k++) {
      dir += (rnd() - 0.5) * 1.2;
      cur = cur
        .clone()
        .add(new THREE.Vector3(Math.cos(dir) * R, Math.sin(dir) * R, (rnd() - 0.5) * 0.8));
      atoms.push(cur);
      const id = atoms.length - 1;
      bonds.push([prev, id]);
      prev = id;
    }
  }

  // Slight out-of-plane bend so it reads as 3-D.
  for (const a of atoms) {
    a.z += Math.sin(a.x * 0.7) * 0.35 + Math.cos(a.y * 0.9) * 0.25;
  }
  const center = atoms.reduce((acc, a) => acc.add(a), new THREE.Vector3()).multiplyScalar(1 / atoms.length);
  atoms.forEach((a) => a.sub(center));
  return { atoms, bonds };
}
