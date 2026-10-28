import * as THREE from 'three';

/** Loads /sky/<fruit>.jpg (or .png). Calls onLoad only if a panorama exists. */
export async function loadFruitSky(fruit: string, onLoad: (tex: THREE.Texture) => void) {
  // the fruit's own panorama, else the apple orchard
  for (const file of [`${fruit}.jpg`, `${fruit}.png`, 'apple.jpg']) {
    let res: Response;
    try {
      res = await fetch(`/sky/${file}`);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const blobUrl = URL.createObjectURL(await res.blob());
    new THREE.TextureLoader().load(blobUrl, (tex) => {
      URL.revokeObjectURL(blobUrl);
      onLoad(tex);
    });
    return;
  }
}

/** Brightest spot of an equirectangular sky, as a unit direction (three's equirectUv, flipY). */
export function sunDirFromPanorama(tex: THREE.Texture): THREE.Vector3 | null {
  const img = tex.image as CanvasImageSource & { width?: number; height?: number };
  if (!img?.width || !img.height) return null;
  const w = 240;
  const h = 120;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  let best = 0;
  for (let i = 0; i < data.length; i += 4) best = Math.max(best, lum(i));
  const cut = Math.max(248, best - 6);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (lum((y * w + x) * 4) < cut) continue;
      sx += x + 0.5;
      sy += y + 0.5;
      n++;
    }
  }
  if (!n) return null;
  const u = sx / n / w;
  const v = 1 - sy / n / h;
  const phi = (u - 0.5) * Math.PI * 2;
  const elev = (v - 0.5) * Math.PI;
  const cosE = Math.cos(elev);
  return new THREE.Vector3(Math.cos(phi) * cosE, Math.sin(elev), Math.sin(phi) * cosE);
}


/**
 * The panorama on a dome at a finite distance round the fruit (not at infinity):
 * flying round the fruit the trees shift a little, so it feels like a snug glade.
 * Blur = sampling a coarser mip level (macro depth of field).
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private radius: number;

  constructor(scene: THREE.Scene, radius: number) {
    this.radius = radius;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uLod: { value: 2 }, uIntensity: { value: 0.9 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uLod;
        uniform float uIntensity;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          // a few taps round the point at a coarse mip: soft, not blocky
          // the photo's left and right edges don't quite match: blur more along that seam
          float seam = 1.0 - smoothstep(0.0, 0.035, min(uv.x, 1.0 - uv.x));
          float lod = uLod + seam * 4.5;
          vec2 px = exp2(lod) / vec2(textureSize(uMap, 0));
          vec3 c = textureLod(uMap, uv, lod).rgb * 0.2;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398 + 0.39;
            c += textureLod(uMap, uv + vec2(cos(a), sin(a)) * px * 1.1, lod).rgb * 0.1;
          }
          // the poles: the whole panorama squeezes into a point (a "star"); fade to the ring's average colour
          float pole = smoothstep(0.7, 0.97, abs(d.y));
          if (pole > 0.0) {
            float v = d.y > 0.0 ? 0.93 : 0.07;
            vec3 ring = vec3(0.0);
            for (int i = 0; i < 12; i++) ring += textureLod(uMap, vec2((float(i) + 0.5) / 12.0, v), 6.0).rgb;
            ring /= 12.0;
            vec3 soft = textureLod(uMap, uv, uLod + 3.0).rgb;
            c = mix(c, mix(soft, ring, smoothstep(0.85, 0.99, abs(d.y))), pole);
          }
          gl_FragColor = vec4(c * uIntensity, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), this.mat);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setMap(tex: THREE.Texture) {
    tex.mapping = THREE.UVMapping;
    tex.wrapS = THREE.RepeatWrapping; // round the back the image wraps, so blur crosses the seam
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    this.mat.uniforms.uMap.value = tex;
    this.mesh.visible = true;
  }

  /** blur 0…0.5 like scene.backgroundBlurriness; the dome grows if the camera backs out of it. */
  update(blur: number, camPos: THREE.Vector3) {
    this.mat.uniforms.uLod.value = 0.5 + blur * 9;
    this.mesh.scale.setScalar(Math.max(1, camPos.length() / (0.8 * this.radius)));
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
