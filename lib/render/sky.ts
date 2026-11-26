import * as THREE from 'three';
import { withBase } from '@/lib/paths';

/** Loads /sky/<fruit>.jpg (or .png). Calls onLoad only if a panorama exists. */
export async function loadFruitSky(fruit: string, onLoad: (tex: THREE.Texture) => void) {
  // the fruit's own panorama, else the apple orchard
  for (const file of [`${fruit}.jpg`, `${fruit}.png`, 'apple.jpg']) {
    let res: Response;
    try {
      res = await fetch(withBase(`/sky/${file}`));
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
      uniforms: {
        uMap: { value: null },
        uLod: { value: 2 },
        uIntensity: { value: 0.9 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uMoon: { value: 0 },
        uNorth: { value: new THREE.Color() },
        uSouth: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          // Keep the dome's parallax and test depth as a background at the far plane.
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uLod;
        uniform float uIntensity;
        uniform vec3 uTint;
        uniform float uMoon;
        uniform vec3 uNorth;
        uniform vec3 uSouth;
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
            vec3 ring = d.y > 0.0 ? uNorth : uSouth;
            vec3 soft = textureLod(uMap, uv, uLod + 3.0).rgb;
            c = mix(c, mix(soft, ring, smoothstep(0.85, 0.99, abs(d.y))), pole);
          }
          vec3 graded = c * uTint;
          // the daylight photo is too bright to tint: crush it into a dark blue night, and keep
          // white only for the sun's core, which then reads as the moon. Clouds stay dim, not snow.
          if (uMoon > 0.0) {
            float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
            float L = pow(clamp(luma, 0.0, 1.0), 1.45);
            // a night glade, not a black sky: trees stay dim blue, and only the sun's core is the moon
            float hot = smoothstep(0.95, 0.995, luma);
            vec3 moon = mix(vec3(0.03, 0.05, 0.13), vec3(0.08, 0.14, 0.30), smoothstep(0.05, 0.45, L));
            moon = mix(moon, vec3(0.15, 0.24, 0.42), smoothstep(0.42, 0.78, L));
            moon = mix(moon, vec3(0.70, 0.82, 1.0), hot);
            graded = mix(graded, moon, uMoon);
          }
          gl_FragColor = vec4(graded * uIntensity, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), this.mat);
    this.mesh.renderOrder = Infinity; // after opaque geometry, before transparent objects
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
    this.updatePoleColors(tex);
    this.mesh.visible = true;
  }

  private updatePoleColors(tex: THREE.Texture) {
    const img = tex.image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx || !img.width || !img.height) return;
    ctx.imageSmoothingQuality = 'high';
    const bandHeight = Math.min(64, Math.floor(img.height * 0.14) || 1);
    const sample = new THREE.Color();
    const poles = [this.mat.uniforms.uNorth.value, this.mat.uniforms.uSouth.value] as THREE.Color[];
    for (const [index, color] of poles.entries()) {
      const v = index === 0 ? 0.07 : 0.93; // canvas Y is flipped relative to texture V
      ctx.clearRect(0, 0, canvas.width, 1);
      ctx.drawImage(img, 0, Math.max(0, v * img.height - bandHeight / 2), img.width, bandHeight, 0, 0, canvas.width, 1);
      const pixels = ctx.getImageData(0, 0, canvas.width, 1).data;
      color.setRGB(0, 0, 0);
      for (let i = 0; i < pixels.length; i += 4) {
        sample.setRGB(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255, THREE.SRGBColorSpace);
        color.add(sample);
      }
      color.multiplyScalar(1 / canvas.width);
    }
  }

  /** The time of day: the panorama tinted and dimmed; moon 1 turns it into a moonlit night. */
  setTint(tint: [number, number, number], intensity: number, moon = 0) {
    this.mat.uniforms.uTint.value.set(...tint);
    this.mat.uniforms.uIntensity.value = intensity;
    this.mat.uniforms.uMoon.value = moon;
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
