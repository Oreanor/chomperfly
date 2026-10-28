import * as THREE from 'three';
import { HOLE_R0 } from '@/lib/worm/constants';

// ---------- fruit skin + flesh ----------

export type FruitUniforms = {
  uWorm: THREE.IUniform<THREE.Vector3>; // worm head: the skin around it is cut away when inside
  uCut: THREE.IUniform<number>;
  uCutR: THREE.IUniform<number>;
  uXray: THREE.IUniform<number>; // see-through skin (near side), on whenever inside
  uXrayKey: THREE.IUniform<number>; // the X key: the far side too (otherwise it hides the world while inside)
  uInside: THREE.IUniform<number>; // milkier flesh while the worm is inside
  uFlesh: THREE.IUniform<THREE.Color>; // the flesh colour of this fruit
};


export function makeFruitUniforms(): FruitUniforms {
  return {
    uWorm: { value: new THREE.Vector3() },
    uCut: { value: 0 },
    uCutR: { value: 0.75 },
    uXray: { value: 0 },
    uXrayKey: { value: 0 },
    uInside: { value: 0 },
    uFlesh: { value: new THREE.Color(0.97, 0.95, 0.86) },
  };
}

const NOISE_GLSL = /* glsl */ `
varying vec3 vWPos;
varying vec3 vOPos;
uniform vec3 uWorm;
uniform float uCut;
uniform float uXray;
uniform float uXrayKey;
uniform float uInside;
uniform float uCutR;
uniform vec3 uFlesh;
float hash3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i+vec3(0,0,0)),hash3(i+vec3(1,0,0)),f.x), mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x), mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }
// three flips gl.frontFace in the back-side pass of double-sided transparent materials
bool isOuterSide(){
  bool o = gl_FrontFacing;
  #ifdef FLIP_SIDED
    o = !o;
  #endif
  return o;
}
`;

/** Skin outside (model texture or a procedural apple), white flesh inside, cut-away and x-ray. */
/**
 * backdrop: an opaque copy drawn first that keeps only the far wall's flesh (beyond the worm) while
 * gnawing inside: the near skin goes see-through, the far one hides the world. Off with the X-ray key.
 */
export function makeFruitMaterial(uniforms: FruitUniforms, map: THREE.Texture | null, backdrop = false) {
  const mat = backdrop
    ? new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, side: THREE.BackSide, map })
    : new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, side: THREE.DoubleSide, transparent: true, map });
  if (backdrop) mat.defines = { FRUIT_BACKDROP: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vOPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvOPos = transformed;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 dir = normalize(vOPos);
        vec3 c;
        if (isOuterSide()) {
        #ifdef USE_MAP
          // model texture + a little close-up detail
          c = diffuseColor.rgb * (0.93 + 0.14*vnoise(vOPos*1.3));
          c = mix(c, vec3(0.9, 0.78, 0.45), smoothstep(0.9, 0.93, vnoise(vOPos*11.0))*0.3);
        #else
          float streak = vnoise(vec3(dir.x*24.0, dir.y*3.0, dir.z*24.0));
          c = mix(vec3(0.55, 0.035, 0.04), vec3(0.28, 0.012, 0.03), smoothstep(0.35, 0.85, streak));
          float blush = smoothstep(0.5, 0.8, fbm(vOPos*0.12)) * (0.65 - 0.35*dir.y);
          c = mix(c, vec3(0.78, 0.52, 0.08), blush*0.8);
          c = mix(c, vec3(0.42, 0.45, 0.08), smoothstep(0.9, 0.99, dir.y)*0.7);
          c = mix(c, vec3(0.35, 0.3, 0.06), smoothstep(0.93, 0.99, -dir.y)*0.7);
          float dots = vnoise(vOPos*5.0);
          c = mix(c, vec3(0.9, 0.78, 0.45), smoothstep(0.86, 0.9, dots)*0.55);
          c *= 0.92 + 0.16*vnoise(vOPos*1.3);
        #endif
        } else {
          c = uFlesh * (0.94 + 0.06*vnoise(vOPos*3.0));
          totalEmissiveRadiance += c * 0.45; // flesh stays white, not tinted by the sky light
        }
        diffuseColor.rgb = c;`,
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `#include <dithering_fragment>
        vec3 ab = uWorm - cameraPosition;
        float tt = dot(vWPos - cameraPosition, ab) / max(dot(ab, ab), 1e-5);
        vec3 cp = cameraPosition + ab*clamp(tt, 0.0, 1.0);
        float rr = length(vWPos - cp);
        float hole = (1.0 - smoothstep(uCutR*0.55, uCutR, rr)) * (1.0 - smoothstep(0.85, 1.0, tt));
        float a = 1.0 - uCut*hole;
        // the near wall (seen from outside) goes see-through; the far wall (its flesh side) stays
        // and hides the world, unless it's the X-ray key
        a = min(a, mix(1.0, isOuterSide() ? mix(0.22, 0.32, uInside) : mix(0.0, 0.45, uInside), uXray));
        #ifdef FRUIT_BACKDROP
          // only the flesh of the far wall, beyond the worm, only while inside without the X-ray key
          if (uXray * (1.0 - uXrayKey) < 0.5 || isOuterSide() || tt < 0.9) discard;
          a = 1.0;
        #endif
        if (a < 0.02) discard;
        gl_FragColor.a *= a;`,
      );
  };
  return mat;
}

/**
 * The same see-through cut round the line from the camera to the worm, for things inside the fruit
 * (a pomegranate's membranes and arils): they don't wall off the view of the worm.
 */
export function addCutaway(mat: THREE.Material, uniforms: FruitUniforms) {
  mat.transparent = true; // to fade
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uWorm = uniforms.uWorm;
    sh.uniforms.uCut = uniforms.uCut;
    sh.uniforms.uCutR = uniforms.uCutR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cutP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutP = instanceMatrix * cutP;
        #endif
        vCutPos = (modelMatrix * cutP).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutPos;\nuniform vec3 uWorm;\nuniform float uCut;\nuniform float uCutR;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        vec3 cab = uWorm - cameraPosition;
        float ct = dot(vCutPos - cameraPosition, cab) / max(dot(cab, cab), 1e-5);
        float cr = length(vCutPos - (cameraPosition + cab*clamp(ct, 0.0, 1.0)));
        // only what would cover the worm itself: a narrow beam from the camera to just short of it
        float cut = uCut * (1.0 - smoothstep(uCutR*0.35, uCutR*0.75, cr)) * (1.0 - smoothstep(0.75, 0.92, ct));
        // fades to a ghost of itself, not away: you still see what's there
        gl_FragColor.a *= 1.0 - 0.75 * cut;`,
      );
  };
  mat.needsUpdate = true;
}

// ---------- tunnels: glass pipes ----------

/** Clear in the middle, dark crisp edges (fresnel), glossy; not hidden by the flesh fog. */
export function makeGlassMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xa9cbd6,
    roughness: 0.12,
    metalness: 0,
    envMapIntensity: 1.4,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `#include <dithering_fragment>
      float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.08, 0.17, 0.21), fres * 0.85);
      gl_FragColor.a = mix(0.2, 0.92, fres);`,
    );
  };
  return mat;
}

// ---------- holes in the skin: a bite mark ----------

/** Disc of bitten flesh with an uneven edge, radius HOLE_R0 (scaled per hole). */
export function makeBiteGeometry() {
  const geo = new THREE.CircleGeometry(HOLE_R0, 64);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  // browned (oxidised) flesh: lighter in the middle, darker towards the bitten edge
  const flesh = new THREE.Color(0x9a6a3c);
  const bitten = new THREE.Color(0x5a3418);
  flesh.toArray(colors, 0);
  for (let i = 1; i < pos.count; i++) {
    const angle = ((i - 1) / 64) * Math.PI * 2;
    const uneven = 1 + 0.055 * Math.sin(angle * 5 + 0.7) + 0.035 * Math.sin(angle * 9 - 0.4);
    pos.setXY(i, Math.cos(angle) * HOLE_R0 * uneven, Math.sin(angle) * HOLE_R0 * uneven);
    flesh.clone().lerp(bitten, 0.55 + 0.2 * Math.sin(angle * 3 + 0.5)).toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

export function makeBiteMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
}
