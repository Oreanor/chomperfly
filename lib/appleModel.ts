import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R0, appleNormal, appleShapeR, setAppleTable } from './apple';

/**
 * geometry/map: a smooth fruit rebuilt from the model (bumps smoothed out, texture re-baked
 * into a spherical layout). stem: the parts of the original model that stick out (the stem).
 */
export type AppleModel = {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  stem: { geometry: THREE.BufferGeometry; map: THREE.Texture | null } | null;
};

// radius / color grid over directions: columns = longitude, rows = polar angle (cell centers)
const TW = 2048;
const TH = 1024;
// smooth display mesh resolution
const MW = 384; // smooth enough at any zoom, half the triangles of 512×256
const MH = 192;
// smoothing: bumps smaller than ~this many cells are removed (cell ≈ 0.026 units at R0 = 8.3)
const BLUR_CELLS = 8;
const STEM_MARGIN = 0.2; // original triangles this far outside the smooth surface are the stem

/** Copy an attribute into plain floats (the GLB packs normals/uvs into small ints). */
function toFloat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  return new THREE.BufferAttribute(out, attr.itemSize);
}

/** upsideDown: the model is made stem-down (turn it over so the stem is on top, as it hangs). */
export async function loadAppleModel(url: string, upsideDown = false): Promise<AppleModel> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  let map: THREE.Texture | null = null;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.geometry;
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = src.getAttribute(name);
      if (a) g.setAttribute(name, toFloat(a));
    }
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(m.matrixWorld);
    geos.push(g);
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    if (!map && mat.map) map = mat.map;
  });
  if (!geos.length) throw new Error('fruit model has no mesh');
  const src = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;
  if (!src.getAttribute('normal')) src.computeVertexNormals();
  if (upsideDown) src.rotateX(Math.PI); // stem up

  // Center, then scale so the widest horizontal slice is R0.
  // An apple's widest slice is its equator. A pear's mid-height is the neck,
  // and sizing by that belt would blow the fruit up.
  src.computeBoundingBox();
  const bb = src.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  src.translate(-c.x, -c.y, -c.z);
  const pos = src.getAttribute('position');
  let widest = 0;
  for (let i = 0; i < pos.count; i++) {
    widest = Math.max(widest, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  const s = R0 / (widest || 1);
  src.scale(s, s, s);
  src.computeBoundingSphere();

  const { radius, color } = castGrid(src, map);
  smoothRadius(radius);
  setAppleTable(radius, TW, TH);

  const baked = color ? bakedTexture(color) : null;
  return { geometry: smoothMesh(), map: baked ?? map, stem: extractStem(src, map) };
}

// ---------------------------------------------------------------------------

function cellDir(i: number, j: number) {
  const th = ((j + 0.5) / TH) * Math.PI;
  const ph = ((i + 0.5) / TW) * Math.PI * 2 - Math.PI;
  return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
}

/** Reads the model texture into memory so colors can be re-baked. */
function readPixels(map: THREE.Texture | null) {
  const img = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!map || !img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  map.updateMatrix(); // KHR_texture_transform → offset/repeat
  return { data: ctx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height, m: map.matrix.elements, flipY: map.flipY };
}

/**
 * Casts a ray from the center through every grid cell and keeps the nearest hit:
 * distance → radius table, hit texture color → re-baked color grid.
 */
function castGrid(geometry: THREE.BufferGeometry, map: THREE.Texture | null) {
  const P = geometry.getAttribute('position').array as Float32Array;
  const UV = geometry.getAttribute('uv')?.array as Float32Array | undefined;
  const index = geometry.index ? geometry.index.array : null;
  const triCount = index ? index.length / 3 : P.length / 9;
  const radius = new Float32Array(TW * TH).fill(Infinity);
  const hitTri = new Int32Array(TW * TH).fill(-1);
  const hitU = new Float32Array(TW * TH);
  const hitV = new Float32Array(TW * TH);
  // also the farthest hit: a model with insides (a pomegranate's arils, an inner wall) has its skin last
  const far = new Float32Array(TW * TH).fill(-Infinity);
  const farTri = new Int32Array(TW * TH).fill(-1);
  const farU = new Float32Array(TW * TH);
  const farV = new Float32Array(TW * TH);

  const dx = new Float32Array(TW * TH);
  const dy = new Float32Array(TW * TH);
  const dz = new Float32Array(TW * TH);
  for (let j = 0; j < TH; j++) {
    for (let i = 0; i < TW; i++) {
      const [x, y, z] = cellDir(i, j);
      const k = j * TW + i;
      dx[k] = x;
      dy[k] = y;
      dz[k] = z;
    }
  }

  const vi = [0, 0, 0];
  const th3 = [0, 0, 0];
  const ph3 = [0, 0, 0];
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) vi[e] = index ? index[t * 3 + e] : t * 3 + e;
    const ax = P[vi[0] * 3], ay = P[vi[0] * 3 + 1], az = P[vi[0] * 3 + 2];
    const bx = P[vi[1] * 3], by = P[vi[1] * 3 + 1], bz = P[vi[1] * 3 + 2];
    const cx = P[vi[2] * 3], cy = P[vi[2] * 3 + 1], cz = P[vi[2] * 3 + 2];
    let nearPole = false;
    for (let e = 0; e < 3; e++) {
      const x = P[vi[e] * 3], y = P[vi[e] * 3 + 1], z = P[vi[e] * 3 + 2];
      const l = Math.hypot(x, y, z) || 1e-9;
      th3[e] = Math.acos(Math.max(-1, Math.min(1, y / l)));
      ph3[e] = Math.atan2(z, x);
      if (Math.sin(th3[e]) < 0.08) nearPole = true;
    }
    const j0 = Math.max(0, Math.floor((Math.min(...th3) / Math.PI) * TH - 0.5) - 1);
    const j1 = Math.min(TH - 1, Math.ceil((Math.max(...th3) / Math.PI) * TH - 0.5) + 1);
    let i0 = 0;
    let i1 = TW - 1;
    if (!nearPole) {
      let pmin = Math.min(...ph3);
      let pmax = Math.max(...ph3);
      if (pmax - pmin > Math.PI) {
        const shifted = ph3.map((p) => (p < 0 ? p + Math.PI * 2 : p));
        pmin = Math.min(...shifted);
        pmax = Math.max(...shifted);
      }
      i0 = Math.floor(((pmin + Math.PI) / (Math.PI * 2)) * TW - 0.5) - 1;
      i1 = Math.ceil(((pmax + Math.PI) / (Math.PI * 2)) * TW - 0.5) + 1;
    }
    // Möller–Trumbore from the origin
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const tx = -ax, ty = -ay, tz = -az;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    for (let j = j0; j <= j1; j++) {
      for (let ii = i0; ii <= i1; ii++) {
        const i = ((ii % TW) + TW) % TW;
        const k = j * TW + i;
        const Dx = dx[k], Dy = dy[k], Dz = dz[k];
        const px = Dy * e2z - Dz * e2y, py = Dz * e2x - Dx * e2z, pz = Dx * e2y - Dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-5 || u > 1 + 1e-5) continue;
        const v = (Dx * qx + Dy * qy + Dz * qz) * inv;
        if (v < -1e-5 || u + v > 1 + 1e-5) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > 0 && dist < radius[k]) {
          radius[k] = dist;
          hitTri[k] = t;
          hitU[k] = u;
          hitV[k] = v;
        }
        if (dist > 0 && dist > far[k]) {
          far[k] = dist;
          farTri[k] = t;
          farU[k] = u;
          farV[k] = v;
        }
      }
    }
  }

  // the skin is the farthest hit, except where something sticks out of it (a stem): there the
  // farthest hit is well beyond its neighbourhood, and the nearest one is the skin
  const W = 4;
  const win: number[] = [];
  for (let j = 0; j < TH; j++) {
    for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      if (farTri[k] < 0 || far[k] <= radius[k] * 1.02) continue;
      win.length = 0;
      for (let dj = -W; dj <= W; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= TH) continue;
        for (let di = -W; di <= W; di++) {
          const v = far[jj * TW + (((i + di) % TW) + TW) % TW];
          if (v > 0) win.push(v);
        }
      }
      win.sort((a, b) => a - b);
      const median = win[win.length >> 1] ?? far[k];
      if (far[k] > median * 1.08) continue; // a stem: keep the nearest hit
      radius[k] = far[k];
      hitTri[k] = farTri[k];
      hitU[k] = farU[k];
      hitV[k] = farV[k];
    }
  }

  // colors from the hit points
  let color: Uint8Array<ArrayBuffer> | null = null;
  const px = UV ? readPixels(map) : null;
  if (px && UV) {
    color = new Uint8Array(TW * TH * 4);
    const m = px.m;
    for (let k = 0; k < TW * TH; k++) {
      const t = hitTri[k];
      if (t < 0) continue;
      const a = index ? index[t * 3] : t * 3;
      const b = index ? index[t * 3 + 1] : t * 3 + 1;
      const cc = index ? index[t * 3 + 2] : t * 3 + 2;
      const u = hitU[k], v = hitV[k], w = 1 - u - v;
      const su = w * UV[a * 2] + u * UV[b * 2] + v * UV[cc * 2];
      const sv = w * UV[a * 2 + 1] + u * UV[b * 2 + 1] + v * UV[cc * 2 + 1];
      // texture transform (column-major 3x3)
      let tu = m[0] * su + m[3] * sv + m[6];
      let tv = m[1] * su + m[4] * sv + m[7];
      tu -= Math.floor(tu);
      tv -= Math.floor(tv);
      const x = Math.min(px.w - 1, Math.floor(tu * px.w));
      const y = Math.min(px.h - 1, Math.floor((px.flipY ? 1 - tv : tv) * px.h));
      const o = (y * px.w + x) * 4;
      color[k * 4] = px.data[o];
      color[k * 4 + 1] = px.data[o + 1];
      color[k * 4 + 2] = px.data[o + 2];
      color[k * 4 + 3] = 255;
    }
  }

  fillMissing(radius, color);
  return { radius, color };
}

/** Cells whose ray missed (small holes in the mesh) take the average of their neighbours. */
function fillMissing(radius: Float32Array, color: Uint8Array | null) {
  for (let pass = 0; pass < 60; pass++) {
    let missing = 0;
    const next = radius.slice();
    const nextC = color ? color.slice() : null;
    for (let j = 0; j < TH; j++) {
      for (let i = 0; i < TW; i++) {
        const k = j * TW + i;
        if (Number.isFinite(radius[k])) continue;
        let sum = 0, n = 0, r = 0, g = 0, b = 0;
        for (const [a, bb] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jj = j + bb;
          if (jj < 0 || jj >= TH) continue;
          const kk = jj * TW + ((i + a + TW) % TW);
          if (!Number.isFinite(radius[kk])) continue;
          sum += radius[kk];
          if (color) {
            r += color[kk * 4];
            g += color[kk * 4 + 1];
            b += color[kk * 4 + 2];
          }
          n++;
        }
        if (n) {
          next[k] = sum / n;
          if (nextC && color) {
            nextC[k * 4] = r / n;
            nextC[k * 4 + 1] = g / n;
            nextC[k * 4 + 2] = b / n;
            nextC[k * 4 + 3] = 255;
          }
        } else missing++;
      }
    }
    radius.set(next);
    if (color && nextC) color.set(nextC);
    if (!missing) break;
  }
}

/** Removes small bumps: separable box blur ×3 (≈ gaussian), wider in longitude near the poles. */
function smoothRadius(radius: Float32Array) {
  const tmp = new Float32Array(TW);
  for (let pass = 0; pass < 3; pass++) {
    // along longitude (wraps around)
    for (let j = 0; j < TH; j++) {
      const sth = Math.max(0.02, Math.sin(((j + 0.5) / TH) * Math.PI));
      const rad = Math.min(TW / 4, Math.round(BLUR_CELLS / sth));
      const row = j * TW;
      let acc = 0;
      for (let d = -rad; d <= rad; d++) acc += radius[row + ((d % TW) + TW) % TW];
      for (let i = 0; i < TW; i++) {
        tmp[i] = acc / (2 * rad + 1);
        acc += radius[row + ((i + rad + 1) % TW)] - radius[row + ((i - rad) % TW + TW) % TW];
      }
      radius.set(tmp, row);
    }
    // along the polar angle (clamped at the poles)
    const col = new Float32Array(TH);
    for (let i = 0; i < TW; i++) {
      for (let j = 0; j < TH; j++) {
        let acc = 0;
        let n = 0;
        for (let d = -BLUR_CELLS; d <= BLUR_CELLS; d++) {
          const jj = j + d;
          if (jj < 0 || jj >= TH) continue;
          acc += radius[jj * TW + i];
          n++;
        }
        col[j] = acc / n;
      }
      for (let j = 0; j < TH; j++) radius[j * TW + i] = col[j];
    }
  }
}

function bakedTexture(color: Uint8Array<ArrayBuffer>) {
  const tex = new THREE.DataTexture(color, TW, TH, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Smooth fruit surface from the (smoothed) radius table; uv matches the baked texture grid. */
function smoothMesh() {
  const cols = MW + 1;
  const rows = MH + 1;
  const pos = new Float32Array(cols * rows * 3);
  const nor = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    const th = (j / MH) * Math.PI;
    for (let i = 0; i < cols; i++) {
      const ph = (i / MW) * Math.PI * 2 - Math.PI;
      v.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      v.multiplyScalar(appleShapeR(v.x, v.y, v.z));
      appleNormal(v, n);
      const k = j * cols + i;
      pos.set([v.x, v.y, v.z], k * 3);
      nor.set([n.x, n.y, n.z], k * 3);
      uv.set([i / MW, j / MH], k * 2);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < MH; j++) {
    for (let i = 0; i < MW; i++) {
      const a = j * cols + i;
      const b = a + cols;
      // Outward winding: the material uses front faces for skin and back faces for flesh.
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Triangles of the original model that stick out of the smooth surface (the stem, a leaf…). */
function extractStem(src: THREE.BufferGeometry, map: THREE.Texture | null) {
  const geo = src.index ? src.toNonIndexed() : src;
  const P = geo.getAttribute('position');
  const T = P.count / 3;
  // how far each corner sticks out of the smooth surface
  const outBy = new Float32Array(P.count);
  for (let v = 0; v < P.count; v++) {
    const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
    outBy[v] = Math.hypot(x, y, z) - appleShapeR(x, y, z);
  }
  // corners shared between triangles (the copy has no index: match by position)
  const byPos = new Map<string, number[]>();
  const posKey = (v: number) => `${P.getX(v).toFixed(4)},${P.getY(v).toFixed(4)},${P.getZ(v).toFixed(4)}`;
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const k = posKey(t * 3 + e);
    const list = byPos.get(k);
    if (list) list.push(t);
    else byPos.set(k, [t]);
  }
  // cores: triangles wholly out (a stem, a crown; not a ridge the smoothing shaved a little)…
  const inStem = new Uint8Array(T);
  let ring: number[] = [];
  for (let t = 0; t < T; t++) {
    if (outBy[t * 3] > STEM_MARGIN && outBy[t * 3 + 1] > STEM_MARGIN && outBy[t * 3 + 2] > STEM_MARGIN) {
      inStem[t] = 1;
      ring.push(t);
    }
  }
  // …grown over the neighbours that still stick out a bit, so it joins the fruit without gaps
  for (let step = 0; step < 6 && ring.length; step++) {
    const next: number[] = [];
    for (const t of ring) for (let e = 0; e < 3; e++) {
      for (const n of byPos.get(posKey(t * 3 + e)) ?? []) {
        if (inStem[n]) continue;
        if (Math.max(outBy[n * 3], outBy[n * 3 + 1], outBy[n * 3 + 2]) < 0.02) continue;
        inStem[n] = 1;
        next.push(n);
      }
    }
    ring = next;
  }
  const keep: number[] = [];
  for (let t = 0; t < T; t++) if (inStem[t]) keep.push(t);
  if (!keep.length) return null;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(keep.length * 3 * a.itemSize);
    let o = 0;
    for (const t of keep) {
      for (let e = 0; e < 3; e++) for (let c = 0; c < a.itemSize; c++) arr[o++] = a.getComponent(t * 3 + e, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.computeBoundingSphere();
  return { geometry: out, map };
}

/** A pit model (`<fruit>-core.glb`): centred in the fruit, about half its height. */
export async function loadPitModel(url: string, fruit: THREE.BufferGeometry) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const obj = gltf.scene;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  fruit.computeBoundingBox();
  const fruitHeight = fruit.boundingBox!.max.y - fruit.boundingBox!.min.y;
  const s = (0.5 * fruitHeight) / (size.y || 1);
  const holder = new THREE.Group();
  obj.position.sub(center);
  holder.add(obj);
  holder.scale.setScalar(s);
  holder.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m) m.fog = false;
  });
  return { object: holder, radii: size.multiplyScalar(s / 2) };
}
