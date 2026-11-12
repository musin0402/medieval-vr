// Funciones puras del mundo: altura, ríos, montañas, bosques. Sin Three.js.
import { makeNoise } from './noise.js';

export const WATER_LEVEL = 0;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function createHeightfield(seed = 1337) {
  const nBase = makeNoise(seed);
  const nRoll = makeNoise(seed + 11);
  const nMask = makeNoise(seed + 23);
  const nRidge = makeNoise(seed + 37);
  const nRiver = makeNoise(seed + 51);
  const nWarp = makeNoise(seed + 67);
  const nForest = makeNoise(seed + 83);
  const nMoist = makeNoise(seed + 97);

  const fbm = (n, x, z, oct) => {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += n(x * f, z * f) * a;
      norm += a; a *= 0.5; f *= 2;
    }
    return sum / norm;
  };

  function mountainMask(x, z) {
    return smoothstep(0.02, 0.32, fbm(nMask, x * 0.0014 + 100, z * 0.0014 - 40, 2));
  }

  function riverValue(x, z) {
    // línea de río = donde este valor cruza 0; se deforma para que serpentee
    const wx = x + nWarp(x * 0.004, z * 0.004) * 60;
    const wz = z + nWarp(x * 0.004 + 50, z * 0.004 + 50) * 60;
    return nRiver(wx * 0.0021, wz * 0.0021);
  }

  function height(x, z) {
    const base = fbm(nBase, x * 0.0035, z * 0.0035, 4);
    const roll = fbm(nRoll, x * 0.013, z * 0.013, 3);
    const m = mountainMask(x, z);
    let ridge = 1 - Math.abs(fbm(nRidge, x * 0.0045, z * 0.0045, 4) * 1.6);
    ridge = Math.max(0, ridge);
    let h = 5 + base * 12 + roll * 3.2 + m * (ridge * ridge * 85 + 8);
    // ríos (menos en las montañas altas)
    const d = Math.abs(riverValue(x, z));
    const w = (1 - smoothstep(0.0, 0.075, d)) * (1 - smoothstep(0.35, 0.8, m));
    const bed = -2.6 + smoothstep(0.0, 0.05, d) * 3.2;
    h = h * (1 - w) + bed * w;
    return h;
  }

  function slope(x, z, e = 2) {
    const dx = height(x + e, z) - height(x - e, z);
    const dz = height(x, z + e) - height(x, z - e);
    return Math.sqrt(dx * dx + dz * dz) / (2 * e);
  }

  // 0..1 densidad de bosque
  function forest(x, z) {
    const f = fbm(nForest, x * 0.007 + 300, z * 0.007 + 300, 3);
    return smoothstep(-0.12, 0.22, f);
  }
  // -1..1 (positivo = pino/frío, negativo = roble)
  function moisture(x, z) {
    return fbm(nMoist, x * 0.005 - 80, z * 0.005 + 80, 2) * 2;
  }

  function findSpawn() {
    for (let r = 0; r < 600; r += 12) {
      for (let a = 0; a < 16; a++) {
        const x = Math.cos(a * 0.3927) * r, z = Math.sin(a * 0.3927) * r;
        const h = height(x, z);
        if (h > 2.2 && h < 12 && slope(x, z) < 0.18 && mountainMask(x, z) < 0.2 && forest(x, z) < 0.6) {
          return { x, z, y: h };
        }
      }
    }
    return { x: 0, z: 0, y: Math.max(height(0, 0), 1) };
  }

  return { height, slope, forest, moisture, mountainMask, riverValue, findSpawn };
}
