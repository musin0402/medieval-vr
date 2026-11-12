// Mundo procedural por chunks: terreno suave + props (árboles, rocas, ruinas) en mallas de color por vértice.
import * as THREE from 'three';
import { makeRng, hash2 } from './noise.js';
import { WATER_LEVEL, smoothstep } from './heightfield.js';

export const CHUNK = 80;       // metros por chunk
const SEG = 32;                // segmentos del terreno por lado (2.5 m)
const TERRAIN_RADIUS = 3;      // chunks de terreno alrededor del jugador
const PROP_RADIUS = 2;         // chunks con árboles/ruinas
const UNLOAD_RADIUS = 4;

const C = (hex) => new THREE.Color(hex);
const PAL = {
  seabed: C(0x6d6a50), sand: C(0xcfc08a), grassA: C(0x5f9b3a), grassB: C(0x86a94a),
  forest: C(0x3f7a30), rock: C(0x7f7b74), rockDark: C(0x5d5a56), snow: C(0xf1f5f9), dirt: C(0x8a6b45),
  trunk: C(0x5a3d26), pine: C(0x2a6a3a), pine2: C(0x1f5530), oak: C(0x5f9a2c), oak2: C(0x7bb03a),
  stone: C(0x9a968c), stone2: C(0x817d74), moss: C(0x5d7a45),
};
const tmp = new THREE.Color();

// ---------- constructor de geometría con colores por vértice ----------
class Builder {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, col) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  cone(x, y, z, r, h, sides, col, rot = 0) {
    const top = [x, y + h, z];
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2;
      this.tri([x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], top, [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], col);
    }
  }
  bipyramid(x, y, z, r, h, sides, col, rot = 0, squash = 0.5) {
    const top = [x, y + h, z], bot = [x, y - h * squash, z];
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      this.tri(p0, top, p1, col);
      this.tri(p1, bot, p0, col);
    }
  }
  prism(x, y, z, rb, rt, h, sides, col) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const b0 = [x + Math.cos(a0) * rb, y, z + Math.sin(a0) * rb], b1 = [x + Math.cos(a1) * rb, y, z + Math.sin(a1) * rb];
      const t0 = [x + Math.cos(a0) * rt, y + h, z + Math.sin(a0) * rt], t1 = [x + Math.cos(a1) * rt, y + h, z + Math.sin(a1) * rt];
      this.tri(b0, t0, b1, col);
      this.tri(b1, t0, t1, col);
    }
  }
  box(cx, cy, cz, sx, sy, sz, rotY, col, col2) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const P = new Array(8);
    // vértices en el orden 0:(-,-,-) 1:(+,-,-) 2:(+,+,-) 3:(-,+,-) 4:(-,-,+) 5:(+,-,+) 6:(+,+,+) 7:(-,+,+)
    const sg = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    for (let i = 0; i < 8; i++) {
      const lx = sg[i][0] * hx, lz = sg[i][2] * hz;
      P[i] = [cx + lx * c + lz * s, cy + sg[i][1] * hy, cz - lx * s + lz * c];
    }
    this.quad(P[4], P[5], P[6], P[7], col);
    this.quad(P[1], P[0], P[3], P[2], col);
    this.quad(P[5], P[1], P[2], P[6], col);
    this.quad(P[0], P[4], P[7], P[3], col);
    this.quad(P[7], P[6], P[2], P[3], col2 || col);
    this.quad(P[0], P[1], P[5], P[4], col);
  }
  toGeometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // no indexada -> sombreado plano estilo low-poly
    g.computeBoundingSphere();
    return g;
  }
}
function variant(base, rng, amt) {
  const k = 1 + (rng() - 0.5) * amt;
  return tmp.copy(base).multiplyScalar(k).clone();
}

export class World {
  constructor(scene, hf) {
    this.scene = scene;
    this.hf = hf;
    this.chunks = new Map();
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.group = new THREE.Group();
    scene.add(this.group);

    // Agua: un único plano grande que sigue al jugador
    const wg = new THREE.PlaneGeometry(1400, 1400, 1, 1);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({
      color: 0x2e86b0, transparent: true, opacity: 0.78, depthWrite: false,
      emissive: 0x0a2a3a,
    }));
    this.water.position.y = WATER_LEVEL;
    this.water.renderOrder = 2;
    scene.add(this.water);
  }

  key(cx, cz) { return cx + ',' + cz; }

  // --------- terreno ---------
  buildTerrain(cx, cz) {
    const hf = this.hf;
    const step = CHUNK / SEG, x0 = cx * CHUNK, z0 = cz * CHUNK;
    const W = SEG + 3;
    const hs = new Float32Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) hs[j * W + i] = hf.height(x0 + (i - 1) * step, z0 + (j - 1) * step);

    const V = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3);
    const idx = new Uint16Array(SEG * SEG * 6);
    const rng = makeRng(hash2(cx, cz, 7));
    let k = 0;
    const c = new THREE.Color();
    for (let j = 0; j <= SEG; j++) {
      for (let i = 0; i <= SEG; i++, k++) {
        const gi = i + 1, gj = j + 1, h = hs[gj * W + gi];
        const wx = x0 + i * step, wz = z0 + j * step;
        pos[k * 3] = wx - x0; pos[k * 3 + 1] = h; pos[k * 3 + 2] = wz - z0;
        let nx = hs[gj * W + gi - 1] - hs[gj * W + gi + 1], ny = 2 * step, nz = hs[(gj - 1) * W + gi] - hs[(gj + 1) * W + gi];
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;

        // color por bioma
        const f = hf.forest(wx, wz), m = hf.moisture(wx, wz);
        c.copy(PAL.grassA).lerp(PAL.grassB, smoothstep(-0.5, 0.6, m));
        c.lerp(PAL.forest, f * 0.65);
        c.lerp(PAL.dirt, smoothstep(0.35, 0.6, ny < 0.9 ? 1 - ny : 0) * 0.5 * (1 - smoothstep(30, 45, h)));
        c.lerp(PAL.sand, 1 - smoothstep(0.6, 1.9, h));
        c.lerp(PAL.seabed, 1 - smoothstep(-0.9, -0.1, h));
        const rockiness = Math.max(smoothstep(0.22, 0.42, 1 - ny), smoothstep(32, 52, h));
        c.lerp(h > 45 ? PAL.rock : PAL.rockDark, rockiness);
        c.lerp(PAL.snow, smoothstep(58, 70, h + (ny - 0.8) * 25));
        const v = 1 + (rng() - 0.5) * 0.08;
        col[k * 3] = c.r * v; col[k * 3 + 1] = c.g * v; col[k * 3 + 2] = c.b * v;
      }
    }
    let t = 0;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i, b = a + 1, cc = a + SEG + 1, d = cc + 1;
      idx[t++] = a; idx[t++] = cc; idx[t++] = b; idx[t++] = b; idx[t++] = cc; idx[t++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, 30, CHUNK / 2), CHUNK * 1.1 + 60);
    const mesh = new THREE.Mesh(g, this.terrainMat);
    mesh.position.set(x0, 0, z0);
    this.group.add(mesh);
    return mesh;
  }

  // --------- props: árboles, rocas, ruinas ---------
  buildProps(chunk) {
    const { cx, cz } = chunk, hf = this.hf;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const rng = makeRng(hash2(cx, cz, 99));
    const B = new Builder();
    const colliders = [];
    const ruins = [];

    // Ruinas medievales
    const spawn = this.spawn;
    const forced = spawn && Math.floor(spawn.x / CHUNK) === cx && Math.floor(spawn.z / CHUNK) === cz;
    if (forced || rng() < 0.16) {
      for (let tries = 0; tries < 8; tries++) {
        const rx = x0 + 14 + rng() * (CHUNK - 28), rz = z0 + 14 + rng() * (CHUNK - 28);
        if (forced && spawn && Math.hypot(rx - spawn.x, rz - spawn.z) < 14) continue;
        const h = hf.height(rx, rz);
        if (h > 1.5 && h < 38 && hf.slope(rx, rz, 4) < 0.22) {
          this.addRuin(B, colliders, rng, rx, rz);
          ruins.push([rx, rz, 11]);
          break;
        }
      }
    }

    // Árboles
    const CELL = 7;
    for (let gz = 0; gz < CHUNK; gz += CELL) {
      for (let gx = 0; gx < CHUNK; gx += CELL) {
        const x = x0 + gx + rng() * CELL, z = z0 + gz + rng() * CELL;
        const f = hf.forest(x, z);
        if (rng() > f * 0.8 + 0.025) continue;
        const h = hf.height(x, z);
        if (h < 1.4 || h > 50) continue;
        if (hf.slope(x, z, 1.5) > 0.55) continue;
        let blocked = false;
        for (const r of ruins) if (Math.hypot(x - r[0], z - r[1]) < r[2]) { blocked = true; break; }
        if (blocked) continue;
        const cold = hf.moisture(x, z) + (h - 20) * 0.03;
        const s = 0.8 + rng() * 0.8;
        if (cold > -0.1 || h > 30) this.addPine(B, rng, x, h, z, s);
        else this.addOak(B, rng, x, h, z, s);
        colliders.push(x, z, 0.45 * s);
      }
    }

    // Rocas
    const nRocks = 4 + Math.floor(rng() * 6);
    for (let i = 0; i < nRocks; i++) {
      const x = x0 + rng() * CHUNK, z = z0 + rng() * CHUNK, h = hf.height(x, z);
      if (h < 0.8) continue;
      const hi = h > 30 || hf.slope(x, z, 2) > 0.4;
      if (!hi && rng() > 0.35) continue;
      const s = 0.5 + rng() * (hi ? 2.2 : 1.1);
      B.bipyramid(x, h + s * 0.1, z, s, s * 0.9, 5 + Math.floor(rng() * 2), variant(rng() > 0.5 ? PAL.rock : PAL.rockDark, rng, 0.25), rng() * 6, 0.9);
      colliders.push(x, z, s * 0.8);
    }

    const geo = B.toGeometry();
    if (geo) {
      const mesh = new THREE.Mesh(geo, this.propMat);
      mesh.frustumCulled = true;
      this.group.add(mesh);
      chunk.props = mesh;
    }
    chunk.colliders = new Float32Array(colliders);
    chunk.hasProps = true;
  }

  addPine(B, rng, x, h, z, s) {
    const tr = variant(PAL.trunk, rng, 0.3);
    B.prism(x, h - 0.2, z, 0.28 * s, 0.18 * s, 2.2 * s, 4, tr);
    const g1 = variant(PAL.pine, rng, 0.35), g2 = variant(PAL.pine2, rng, 0.35);
    const rot = rng() * 6;
    B.cone(x, h + 1.0 * s, z, 1.7 * s, 3.0 * s, 6, g1, rot);
    B.cone(x, h + 2.4 * s, z, 1.3 * s, 2.7 * s, 6, g2, rot + 0.5);
    B.cone(x, h + 3.7 * s, z, 0.85 * s, 2.3 * s, 5, g1, rot + 1);
  }

  addOak(B, rng, x, h, z, s) {
    B.prism(x, h - 0.2, z, 0.3 * s, 0.22 * s, 2.4 * s, 5, variant(PAL.trunk, rng, 0.3));
    const g = variant(rng() > 0.5 ? PAL.oak : PAL.oak2, rng, 0.3);
    B.bipyramid(x, h + 3.2 * s, z, 1.9 * s, 1.5 * s, 6, g, rng() * 6, 1.1);
    B.bipyramid(x + (rng() - 0.5) * s, h + 4.3 * s, z + (rng() - 0.5) * s, 1.2 * s, 1.0 * s, 5, variant(PAL.oak2, rng, 0.3), rng() * 6, 0.9);
  }

  addRuin(B, colliders, rng, x, z) {
    const hf = this.hf;
    const type = rng();
    // altura base: el mínimo del terreno bajo la ruina, para que los muros "entierren" la pendiente
    let base = 1e9;
    for (let a = 0; a < 8; a++) base = Math.min(base, hf.height(x + Math.cos(a * 0.785) * 7, z + Math.sin(a * 0.785) * 7));
    base = Math.min(base, hf.height(x, z)) - 1.2;
    const st = () => variant(rng() > 0.5 ? PAL.stone : PAL.stone2, rng, 0.2);
    const wall = (wx, wz, len, top, rot) => {
      const hgt = top - base;
      B.box(wx, base + hgt / 2, wz, len, hgt, 1.0, rot, st(), variant(PAL.moss, rng, 0.2));
      // almenas rotas
      if (top > 3 && rng() > 0.4) B.box(wx + Math.cos(rot) * len * 0.25, top + 0.4, wz - Math.sin(rot) * len * 0.25, len * 0.3, 0.8, 1.0, rot, st(), variant(PAL.moss, rng, 0.2));
      const n = Math.max(1, Math.round(len / 2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        colliders.push(wx + Math.cos(rot) * len * t, wz - Math.sin(rot) * len * t, 0.95);
      }
    };
    if (type < 0.55) {
      // torre circular en ruinas
      const R = 5 + rng() * 1.5, N = 10, seg = (2 * Math.PI * R) / N;
      const missing = Math.floor(rng() * N);
      for (let i = 0; i < N; i++) {
        if (i === missing || i === (missing + 1) % N) continue; // puerta
        const a = (i / N) * Math.PI * 2;
        const top = base + 1.8 + rng() * 5.5 + (i % 3 === 0 ? 2.5 : 0);
        wall(x + Math.cos(a) * R, z + Math.sin(a) * R, seg * 1.05, top, -a + Math.PI / 2);
      }
      for (let i = 0; i < 2; i++) { // escombros y pilar
        const a = rng() * 6.28, d = rng() * 2.5;
        B.box(x + Math.cos(a) * d, base + 1.3, z + Math.sin(a) * d, 0.9 + rng(), 0.9, 0.9 + rng(), rng() * 3, st());
      }
    } else if (type < 0.85) {
      // pórtico con columnas y muros laterales
      const rot = rng() * Math.PI;
      const dx = Math.cos(rot), dz = -Math.sin(rot);
      for (let i = -2; i <= 2; i++) {
        if (i === 0 && rng() > 0.3) continue;
        const top = base + 2 + rng() * 5;
        wall(x + dx * i * 3.2, z + dz * i * 3.2, 2.6, top, rot);
      }
      B.box(x, base + 6.3, z, 7, 0.9, 1.1, rot, st());
      B.box(x + dx * -3.2, base + 3.1, z + dz * -3.2, 1.2, 6.2, 1.2, rot, st());
      B.box(x + dx * 3.2, base + 3.1, z + dz * 3.2, 1.2, 6.2, 1.2, rot, st());
    } else {
      // círculo de piedras / templo
      const N = 8, R = 6;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
        const top = base + 3 + rng() * 3.5;
        B.box(px, (base + top) / 2, pz, 1.1, top - base, 1.1, a, st());
        colliders.push(px, pz, 0.8);
        if (i % 2 === 0) B.box((px + x) / 2, top + 0.2, (pz + z) / 2, 1.0, 0.5, R * 0.9, -a + Math.PI / 2, st());
      }
      B.box(x, base + 1.2, z, 3.2, 1.0, 3.2, 0.3, st());
    }
  }

  // --------- gestión de chunks ---------
  update(px, pz, budgetMs = 4) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const t0 = performance.now();

    // descargar lejanos
    for (const [key, ch] of this.chunks) {
      if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) > UNLOAD_RADIUS) this.dispose(key, ch);
    }

    // generar de cerca a lejos
    const wanted = [];
    for (let dz = -TERRAIN_RADIUS; dz <= TERRAIN_RADIUS; dz++) {
      for (let dx = -TERRAIN_RADIUS; dx <= TERRAIN_RADIUS; dx++) {
        wanted.push([dx, dz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [dx, dz] of wanted) {
      if (performance.now() - t0 > budgetMs) break;
      const cx = pcx + dx, cz = pcz + dz, key = this.key(cx, cz);
      let ch = this.chunks.get(key);
      if (!ch) {
        ch = { cx, cz, terrain: this.buildTerrain(cx, cz), props: null, hasProps: false, colliders: new Float32Array(0) };
        this.chunks.set(key, ch);
        continue; // 1 chunk por llamada hasta agotar presupuesto
      }
      if (!ch.hasProps && Math.max(Math.abs(dx), Math.abs(dz)) <= PROP_RADIUS) {
        this.buildProps(ch);
      }
    }

    // el agua sigue al jugador
    this.water.position.x = Math.round(px / 50) * 50;
    this.water.position.z = Math.round(pz / 50) * 50;
  }

  dispose(key, ch) {
    for (const m of [ch.terrain, ch.props]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.chunks.delete(key);
  }

  // construye de forma síncrona los chunks iniciales (pantalla de carga)
  async prewarm(px, pz, onProgress) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const list = [];
    for (let dz = -PROP_RADIUS; dz <= PROP_RADIUS; dz++) for (let dx = -PROP_RADIUS; dx <= PROP_RADIUS; dx++) list.push([dx, dz, dx * dx + dz * dz]);
    list.sort((a, b) => a[2] - b[2]);
    let n = 0;
    for (const [dx, dz] of list) {
      const cx = pcx + dx, cz = pcz + dz;
      const ch = { cx, cz, terrain: this.buildTerrain(cx, cz), props: null, hasProps: false, colliders: new Float32Array(0) };
      this.chunks.set(this.key(cx, cz), ch);
      this.buildProps(ch);
      n++;
      onProgress && onProgress(n / list.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // empuja (x,z) fuera de los colisionadores cercanos (árboles, muros, rocas)
  collide(x, z, radius = 0.35) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ch = this.chunks.get(this.key(pcx + dx, pcz + dz));
      if (!ch) continue;
      const c = ch.colliders;
      for (let i = 0; i < c.length; i += 3) {
        const ox = x - c[i], oz = z - c[i + 1], r = c[i + 2] + radius;
        const d2 = ox * ox + oz * oz;
        if (d2 < r * r) {
          const d = Math.sqrt(d2) || 0.0001;
          x = c[i] + (ox / d) * r; z = c[i + 1] + (oz / d) * r;
        }
      }
    }
    return [x, z];
  }

  get chunkCount() { return this.chunks.size; }
}
