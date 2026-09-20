import * as THREE from 'three'
import { WELL_DEPTH_GLSL } from './sheet.ts'
import { onFairway } from '../game/physics.ts'
import type { Level } from '../game/types.ts'
import {
  COLOR_AIM_HIGH,
  COLOR_AIM_LOW,
  COLOR_AIM_MID,
  COLOR_BUMPER_A,
  COLOR_BUMPER_B,
  COLOR_CUP_RING,
  COLOR_FAIRWAY_DEEP,
  COLOR_FAIRWAY_HIGH,
  COLOR_FAIRWAY_LOW,
  COLOR_FLAG,
  COLOR_GRID_DEEP,
  COLOR_GRID_FLAT,
  COLOR_GRID_MID,
  COLOR_PORTAL,
  COLOR_RING_A,
  COLOR_RING_B,
  COLOR_SKY_A,
  COLOR_SKY_B,
  COLOR_SKY_MAGENTA,
  COLOR_SKY_TEAL,
} from './palette.ts'

/**
 * GLSL helpers and factory functions for every custom material in the engine. Kept separate from
 * Engine.ts so the maths-heavy shader strings do not drown out the scene-graph logic.
 */

/** Cheap value noise + fbm, shared by the nebula, planet bands and accretion disc shaders. */
const NOISE_GLSL = `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * valueNoise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return sum;
  }
  vec2 warp(vec2 p) {
    return vec2(fbm(p + vec2(1.7, 9.2)), fbm(p + vec2(8.3, 2.8)));
  }
`

/** Maximum number of massive bodies the gravity-well sheet shader accepts. */
export const MAX_WELL_BODIES = 12

/** Deep-space background: large BackSide sphere, indigo/violet base with magenta + teal nebula accents. */
export function createNebulaSphere(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(900, 24, 16)
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform float uTime;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec2 uv = d.xy * 2.0 + d.z * 1.2;
        vec2 w = warp(uv * 0.8 + uTime * 0.002);
        float n = fbm(uv + w * 1.5);
        float n2 = fbm(d.yz * 1.6 - uTime * 0.0015 + w * 0.8);
        vec3 base = mix(${glslColor(COLOR_SKY_A)}, ${glslColor(COLOR_SKY_B)}, smoothstep(0.2, 0.9, n));
        vec3 magenta = ${glslColor(COLOR_SKY_MAGENTA)};
        vec3 teal = ${glslColor(COLOR_SKY_TEAL)};
        vec3 col = mix(base, magenta, smoothstep(0.45, 0.9, n) * 0.55);
        col = mix(col, teal, smoothstep(0.4, 0.85, n2) * 0.45);
        // Keep the sky dark so the bright green fairway and neon bumpers read as the focal point.
        gl_FragColor = vec4(col * 0.8, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = -10
  return mesh
}

/** ~2500 twinkling background stars with colour-temperature variety on a large shell. */
export function createStarfield(): THREE.Points {
  const count = 2500
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const brightness = new Float32Array(count)
  const temperature = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    // Uniform points on a sphere shell.
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    const radius = 700 + Math.random() * 150
    positions[i * 3] = r * Math.cos(theta) * radius
    positions[i * 3 + 1] = u * radius
    positions[i * 3 + 2] = r * Math.sin(theta) * radius
    sizes[i] = 1.0 + Math.random() * 2.5
    brightness[i] = 0.4 + Math.random() * 0.6
    temperature[i] = Math.random()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
  geometry.setAttribute('aBrightness', new THREE.Float32BufferAttribute(brightness, 1))
  geometry.setAttribute('aTemp', new THREE.Float32BufferAttribute(temperature, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aSize;
      attribute float aBrightness;
      attribute float aTemp;
      varying float vBrightness;
      varying float vTemp;
      uniform float uTime;
      void main() {
        vBrightness = aBrightness * (0.75 + 0.25 * sin(uTime * 1.5 + aSize * 12.0));
        vTemp = aTemp;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize;
      }
    `,
    fragmentShader: `
      varying float vBrightness;
      varying float vTemp;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        vec3 cool = vec3(0.75, 0.85, 1.0);
        vec3 warm = vec3(1.0, 0.88, 0.72);
        vec3 col = mix(cool, warm, vTemp);
        gl_FragColor = vec4(col * vBrightness, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.renderOrder = -9
  return points
}

/** A bright disc + soft additive glow standing in for the sun, placed far away in the light direction. */
export function createSunSprite(glowTexture: THREE.Texture): THREE.Group {
  const group = new THREE.Group()
  const discGeometry = new THREE.CircleGeometry(9, 32)
  const discMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6e0, transparent: true, depthWrite: false })
  const disc = new THREE.Mesh(discGeometry, discMaterial)
  disc.renderOrder = -8
  group.add(disc)

  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffe9b0,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.9,
  })
  const glow = new THREE.Sprite(glowMaterial)
  glow.scale.set(70, 70, 70)
  glow.renderOrder = -8
  group.add(glow)
  return group
}

/** Procedurally banded planet surface: vivid palette colours, drifting cloud layers, day/night terminator. */
export function createPlanetMaterial(palette: [string, string]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(palette[0]) },
      uColorB: { value: new THREE.Color(palette[1]) },
      uSunDir: { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vObjPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vObjPos = position;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vObjPos;
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uSunDir;
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormal);
        // Bands follow latitude plus a slow-drifting fbm warp so they read as alien terrain, not stripes.
        float lat = vObjPos.y * 1.4;
        float warpA = fbm(vObjPos.xz * 1.6 + uTime * 0.02) * 1.2;
        float bands = fbm(vec2(lat + warpA, vObjPos.x * 0.8 + vObjPos.z * 0.8));
        vec3 base = mix(uColorA, uColorB, smoothstep(0.25, 0.75, bands));

        // Two cloud layers drifting at different speeds/scales.
        float clouds1 = fbm(vec2(lat * 1.3 + warpA, vObjPos.x * 1.1 + vObjPos.z * 1.1) + uTime * 0.012);
        float clouds2 = fbm(vec2(lat * 0.85 - warpA * 0.6, vObjPos.x * 1.7 - vObjPos.z * 1.7) - uTime * 0.02);
        float cloudMix = smoothstep(0.58, 0.86, clouds1) * 0.45 + smoothstep(0.62, 0.9, clouds2) * 0.3;
        vec3 cloudColor = mix(base, vec3(0.96, 0.97, 1.0), 0.65);
        base = mix(base, cloudColor, clamp(cloudMix, 0.0, 0.85));

        vec3 sunDir = normalize(uSunDir);
        float ndl = dot(n, sunDir);
        // Crisp day/night terminator; night side stays lifted so the vivid palette still reads.
        float term = smoothstep(-0.12, 0.12, ndl);
        vec3 nightSide = base * 0.12;
        vec3 dayLit = base * (0.3 + 0.72 * max(ndl, 0.0));
        vec3 lit = mix(nightSide, dayLit, term);

        // Warm rim on the lit limb.
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
        lit += rim * mix(uColorA, uColorB, 0.5) * 0.55 * (0.3 + 0.7 * term);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  })
}

/** Cratered grey moon surface: noise-based darker spots, same terminator treatment as planets. */
export function createMoonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vObjPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vObjPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vObjPos;
      uniform vec3 uSunDir;
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormal);
        float base = fbm(vObjPos.xz * 3.0 + vObjPos.y * 3.0);
        float craters = smoothstep(0.55, 0.62, fbm(vObjPos.xy * 6.0)) * 0.35;
        vec3 grey = mix(vec3(0.62, 0.62, 0.66), vec3(0.38, 0.38, 0.42), base);
        grey *= (1.0 - craters);
        float ndl = max(dot(n, normalize(uSunDir)), 0.0);
        vec3 lit = grey * (0.14 + 0.86 * ndl);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  })
}

/** Thin additive atmosphere shell, brighter scattering on the sun-facing side. */
export function createAtmosphereMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uSunDir: { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      uniform vec3 uColor;
      uniform vec3 uSunDir;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        // The shell draws back faces, whose normals point away from the camera: use |n.v| so the
        // glow hugs the limb instead of covering the whole disc at full strength.
        float fresnel = pow(1.0 - abs(dot(n, viewDir)), 3.0);
        float sunSide = 0.4 + 0.6 * max(dot(n, normalize(uSunDir)), 0.0);
        gl_FragColor = vec4(uColor, fresnel * 0.9 * sunSide);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
}

/** Pastel banded ring system (RingGeometry) for large planets, with a gap and a brighter lit side. */
export function createRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
      uColorA: { value: new THREE.Color(COLOR_RING_A) },
      uColorB: { value: new THREE.Color(COLOR_RING_B) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      uniform vec3 uSunDir;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      float hash1(float x) { return fract(sin(x * 91.34) * 47453.5); }
      void main() {
        float r = vUv.y;
        float bands = hash1(floor(r * 26.0));
        float gap = smoothstep(0.44, 0.46, r) * (1.0 - smoothstep(0.52, 0.54, r));
        vec3 col = mix(uColorA, uColorB, bands);
        float lit = 0.5 + 0.5 * max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
        float alpha = (0.14 + 0.3 * bands) * (1.0 - gap);
        gl_FragColor = vec4(col * (0.5 + 0.7 * lit), alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

/**
 * Rasterises `level.course` minus `level.islands` into a black/white CanvasTexture, white inside
 * the fairway, with a softly blurred edge. `halfExtent`/`center` must match the well mesh's own
 * plane geometry exactly (see buildWellMesh in Engine.ts) so the sampled mask lines up pixel-for-
 * pixel with the sheet: row 0 (top) is the -Y edge, column 0 (left) is the -X edge, matching the
 * `maskUv` computed in createWellMaterial's fragment shader.
 */
export function createCourseMaskTexture(level: Level, halfExtent: THREE.Vector2, center: { x: number; y: number }): THREE.CanvasTexture {
  const aspect = halfExtent.x / halfExtent.y
  const long = 1024
  const w = Math.max(2, Math.round(aspect >= 1 ? long : long * aspect))
  const h = Math.max(2, Math.round(aspect >= 1 ? long / aspect : long))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const img = ctx.createImageData(w, h)
    for (let j = 0; j < h; j++) {
      const v = j / (h - 1)
      const gy = (1 - v * 2) * halfExtent.y
      const py = center.y - gy
      for (let i = 0; i < w; i++) {
        const u = i / (w - 1)
        const gx = (u * 2 - 1) * halfExtent.x
        const px = center.x + gx
        const inside = onFairway(level, { x: px, y: py })
        const idx = (j * w + i) * 4
        const val = inside ? 255 : 0
        img.data[idx] = val
        img.data[idx + 1] = val
        img.data[idx + 2] = val
        img.data[idx + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }
  // Soften the edge with a small blur pass so the fairway boundary isn't a hard pixel step.
  const blurred = document.createElement('canvas')
  blurred.width = w
  blurred.height = h
  const bctx = blurred.getContext('2d')
  if (bctx) {
    bctx.filter = 'blur(3px)'
    bctx.drawImage(canvas, 0, 0)
  }
  const texture = new THREE.CanvasTexture(bctx ? blurred : canvas)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * The fairway: shaped to the level's course polygon minus its islands via a rasterised mask
 * texture (see createCourseMaskTexture), pushed down into gravity funnels via wellDepth().
 */
export function createWellMaterial(maskTexture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      // xz = body position, y = mu.
      uBodies: { value: new Array(MAX_WELL_BODIES).fill(0).map(() => new THREE.Vector3()) },
      uSoft: { value: new Float32Array(MAX_WELL_BODIES) },
      uCount: { value: 0 },
      uHalfExtent: { value: new THREE.Vector2(50, 50) },
      uMask: { value: maskTexture },
      uCameraPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    },
    vertexShader: `
      #define MAX_BODIES ${MAX_WELL_BODIES}
      uniform vec3 uBodies[MAX_BODIES];
      uniform float uSoft[MAX_BODIES];
      uniform int uCount;
      varying vec2 vGridXZ;
      varying float vDepth;
      ${WELL_DEPTH_GLSL}
      void main() {
        vGridXZ = position.xy; // plane geometry is authored in XY before rotation
        float depth = wellDepth(position.xy);
        vDepth = depth;
        vec3 displaced = vec3(position.x, position.y, -depth);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      #define MAX_BODIES ${MAX_WELL_BODIES}
      varying vec2 vGridXZ;
      varying float vDepth;
      uniform vec2 uHalfExtent;
      uniform sampler2D uMask;
      uniform vec3 uCameraPos;
      uniform float uTime;
      uniform vec3 uBodies[MAX_BODIES];
      uniform float uSoft[MAX_BODIES];
      uniform int uCount;

      ${WELL_DEPTH_GLSL}

      void main() {
        // uMask is rasterised from the course polygon (minus islands) over exactly this plane's
        // extent (see createCourseMaskTexture) - white inside the fairway, black outside.
        vec2 maskUv = vec2((vGridXZ.x + uHalfExtent.x) / (2.0 * uHalfExtent.x), (uHalfExtent.y + vGridXZ.y) / (2.0 * uHalfExtent.y)); // CanvasTexture uploads flipped, so +y here
        float mask = texture2D(uMask, maskUv).r;
        if (mask <= 0.02) discard;

        vec2 g = abs(fract(vGridXZ - 0.5) - 0.5);
        vec2 fw = fwidth(vGridXZ);
        vec2 lineAA = smoothstep(vec2(0.0), fw * 1.5, g);
        float mainLine = 1.0 - min(lineAA.x, lineAA.y);

        // Sub-grid (0.25 unit) only where the sheet is meaningfully deformed.
        vec2 subG = abs(fract(vGridXZ * 4.0 - 0.5) - 0.5);
        vec2 subFw = fwidth(vGridXZ * 4.0);
        vec2 subAA = smoothstep(vec2(0.0), subFw * 1.5, subG);
        float subLine = (1.0 - min(subAA.x, subAA.y)) * smoothstep(0.7, 1.5, vDepth) * 0.3;
        float line = max(mainLine, subLine);

        // Analytic slope of the well: how steeply the sheet bends here, used to brighten grid lines
        // on steep funnel walls and to tint the far wall so the 3D shape reads from a low camera.
        float eps = 0.18;
        float dDdx = wellDepth(vGridXZ + vec2(eps, 0.0)) - wellDepth(vGridXZ - vec2(eps, 0.0));
        float dDdy = wellDepth(vGridXZ + vec2(0.0, eps)) - wellDepth(vGridXZ - vec2(0.0, eps));
        vec2 gradient = vec2(dDdx, dDdy) / (2.0 * eps);
        float slope = length(gradient);
        float slopeBoost = smoothstep(0.15, 1.4, slope);
        // The far wall is where the depth gradient (uphill direction, into the well) points away
        // from the camera: that face falls into shadow, which sells the funnel's depth.
        vec2 toFrag = normalize(vGridXZ - uCameraPos.xz + vec2(0.0001));
        float farWall = smoothstep(0.05, 0.6, dot(normalize(gradient + vec2(0.0001)), toFrag)) * smoothstep(0.1, 1.0, slope);

        // Hills (negative depth) are tinted like wells of the same size.
        float depthN = clamp(abs(vDepth) / 2.4, 0.0, 1.0);

        // Turf fill: emerald/teal on the flats, mowing stripes every 2 units along x, darkening to indigo.
        vec3 low = ${glslColor(COLOR_FAIRWAY_LOW)};
        vec3 high = ${glslColor(COLOR_FAIRWAY_HIGH)};
        vec3 deep = ${glslColor(COLOR_FAIRWAY_DEEP)};
        float stripe = step(1.0, mod(floor(vGridXZ.x / 2.0), 2.0)) * 0.08;
        vec3 turf = mix(low, high, 0.5) + stripe;
        turf = mix(turf, deep, depthN);
        // Shadowed far wall: darken and cool the turf so the funnel's far side reads as receding.
        turf = mix(turf, turf * 0.35, farWall * 0.7);

        // Grid line colour: mint on the flats, through hot pink, to orange in deep wells.
        vec3 mint = ${glslColor(COLOR_GRID_FLAT)};
        vec3 pink = ${glslColor(COLOR_GRID_MID)};
        vec3 orange = ${glslColor(COLOR_GRID_DEEP)};
        vec3 lineColor = mix(mint, pink, smoothstep(0.0, 0.6, depthN));
        lineColor = mix(lineColor, orange, smoothstep(0.6, 1.0, depthN));

        // Slow radial brightness pulse travelling outward from each body.
        float pulse = 0.0;
        for (int i = 0; i < MAX_BODIES; i++) {
          if (i >= uCount) break;
          float r = length(vGridXZ - uBodies[i].xz);
          float wave = sin(r * 1.6 - uTime * 1.8) * 0.5 + 0.5;
          pulse += wave * exp(-r * 0.12);
        }
        pulse = clamp(pulse, 0.0, 1.0);

        float camFade = 1.0 - smoothstep(40.0, 90.0, length(uCameraPos.xz - vGridXZ));
        // Nearly opaque turf: background scenery must never show through the fairway.
        float fillAlpha = 0.93 * mask;
        float lineAlpha = line * mask * (0.35 + 0.55 * depthN + 0.3 * pulse + 0.6 * slopeBoost) * camFade;
        lineColor = mix(lineColor, vec3(1.0), slopeBoost * 0.35);

        vec3 color = mix(turf, lineColor, lineAlpha);
        float alpha = max(fillAlpha, lineAlpha);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Neon putt-putt bumper: a tube following the level bounds, alternating cyan/magenta with a chase. */
export function createBumperMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(COLOR_BUMPER_A) },
      uColorB: { value: new THREE.Color(COLOR_BUMPER_B) },
      // A single shared material covers every wall segment, so one bounce flash lights up
      // whichever wall it happened near: uFlashAge counts up from 0 at the moment of a hit.
      uFlashPos: { value: new THREE.Vector3(1e6, 1e6, 1e6) },
      uFlashAge: { value: 999 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vStripe;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        // Distance along the wall in world units, so stripes stay one size and run unbroken
        // across the short pieces a wall is built from.
        vStripe = dot(world.xyz, normalize(modelMatrix[0].xyz));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vStripe;
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uFlashPos;
      uniform float uFlashAge;
      void main() {
        float seg = step(0.5, fract(vStripe * 0.5 - uTime * 0.35));
        vec3 col = mix(uColorA, uColorB, seg);
        float shade = 0.6 + 0.4 * sin(vUv.y * 3.14159);
        vec3 lit = col * shade * 1.3;
        float flash = exp(-uFlashAge * 6.0) * smoothstep(1.6, 0.0, distance(vWorldPos, uFlashPos));
        lit += flash * vec3(1.0, 1.0, 1.0) * 1.5;
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  })
}

/** Swirling orange/white accretion disc with a Doppler-brighter, bluer approaching side. */
export function createAccretionDiscMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      uniform float uTime;
      ${NOISE_GLSL}
      void main() {
        float r = length(vPos.xy);
        float a = atan(vPos.y, vPos.x);
        float swirl = fbm(vec2(a * 2.2 - uTime * 1.4, r * 1.5 + uTime * 0.2));
        float bands = fbm(vec2(r * 4.0 - uTime * 0.6, a * 1.2));
        vec3 hot = vec3(1.0, 0.95, 0.85);
        vec3 mid = vec3(1.0, 0.55, 0.12);
        vec3 cool = vec3(0.5, 0.12, 0.05);
        vec3 col = mix(cool, mid, smoothstep(0.2, 0.7, swirl));
        col = mix(col, hot, smoothstep(0.55, 0.95, bands) * 0.8);
        // Doppler beaming: one side brighter and bluer (approaching), the other dimmer and redder.
        float doppler = 0.55 + 0.45 * cos(a - 0.7);
        vec3 blueShift = vec3(0.65, 0.8, 1.0);
        col = mix(col * 0.75, col * blueShift * 1.35, smoothstep(0.5, 1.0, doppler));
        float fade = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
        gl_FragColor = vec4(col * (0.7 + 0.5 * doppler), fade * 0.9);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Thin bright photon ring hugging a black hole's event horizon. */
export function createPhotonRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        float pulse = 0.85 + 0.15 * sin(uTime * 4.0);
        vec3 col = vec3(1.0, 0.9, 0.75) * pulse;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Camera-facing lensed halo billboard around a black hole: a thin bright ring plus faint arcs. */
export function createLensedHaloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = atan(c.y, c.x);
        float ring = smoothstep(0.02, 0.0, abs(r - 0.72)) * 1.4;
        float arcs = smoothstep(0.06, 0.0, abs(r - 0.88)) * (0.5 + 0.5 * sin(a * 3.0 + uTime * 0.6)) * 0.5;
        float alpha = clamp(ring + arcs, 0.0, 1.0) * smoothstep(1.0, 0.5, r);
        vec3 col = vec3(1.0, 0.92, 0.8);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Pulsing energy-ring material for the standing portal torus; speeds up as uProximity rises. */
export function createGateRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uProximity: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uFlash;
      uniform float uProximity;
      void main() {
        float freq = mix(2.5, 8.0, uProximity);
        float pulse = 0.65 + 0.35 * sin(uTime * freq);
        vec3 base = ${glslColor(COLOR_PORTAL)};
        vec3 col = mix(base, vec3(1.0), uFlash);
        gl_FragColor = vec4(col * (pulse + uFlash * 2.0), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Swirling emerald/mint energy disc inside the portal ring. */
export function createGateDiscMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      ${NOISE_GLSL}
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = atan(c.y, c.x);
        float swirl = fbm(vec2(a * 1.6 - uTime * 1.2, r * 3.0 + uTime * 0.4));
        float d = (1.0 - smoothstep(0.0, 1.0, r)) * (0.35 + 0.5 * swirl);
        vec3 col = ${glslColor(COLOR_PORTAL)};
        gl_FragColor = vec4(col, d);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Ground capture ring: reads like a golf cup - white rim, dark centre. */
export function createCupRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        float pulse = 0.75 + 0.25 * sin(uTime * 2.2);
        gl_FragColor = vec4(${glslColor(COLOR_CUP_RING)} * pulse, 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Dark, near-flat cup interior disc. */
export function createCupDiscMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x0a0a12, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
}

/** Vertex-waving triangular golf flag. */
export function createFlagMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      varying float vX;
      void main() {
        vX = position.x;
        vec3 p = position;
        p.z += sin(p.x * 6.0 + uTime * 6.0) * 0.03 * p.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying float vX;
      void main() {
        gl_FragColor = vec4(${glslColor(COLOR_FLAG)}, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  })
}

/** Soft vertical light beam over the target gate, fading upward and outward. */
export function createBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        float fade = (1.0 - vUv.y) * 0.5 + 0.06 * sin(uTime * 3.0 + vUv.y * 10.0);
        vec3 col = ${glslColor(COLOR_PORTAL)};
        gl_FragColor = vec4(col, clamp(fade, 0.0, 1.0) * 0.35);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Flat aim ribbon: animated forward-flowing chevrons, coloured mint -> yellow -> hot pink with power. */
export function createAimRibbonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0.5 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uPower;
      void main() {
        vec3 low = ${glslColor(COLOR_AIM_LOW)};
        vec3 mid = ${glslColor(COLOR_AIM_MID)};
        vec3 high = ${glslColor(COLOR_AIM_HIGH)};
        vec3 col = mix(low, mid, smoothstep(0.0, 0.4, uPower));
        col = mix(col, high, smoothstep(0.4, 0.75, uPower));
        float chevron = fract(vUv.x * 6.0 - uTime * 2.5);
        float shape = smoothstep(0.0, 0.15, chevron) * (1.0 - smoothstep(0.35, 0.5, chevron));
        float edge = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
        float alpha = edge * (0.35 + 0.65 * shape);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Smooth tapered glowing curve under the prediction dots, brightest near the tee and fading out. */
export function createPredictionCurveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vec3 col = ${glslColor(COLOR_AIM_MID)};
        float edge = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float flow = 0.6 + 0.4 * sin(vUv.x * 18.0 - uTime * 3.0);
        float fade = 1.0 - smoothstep(0.55, 1.0, vUv.x);
        gl_FragColor = vec4(col, edge * fade * flow * 0.55);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Soft glowing prediction dots that shrink along the path (per-vertex aSize attribute). */
export function createPredictionDotsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float aSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (260.0 / max(-mv.z, 0.001));
      }
    `,
    fragmentShader: `
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.9, 0.98, 1.0), a * 0.7);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

/** Radial-gradient CanvasTexture used for glow sprites (probe, sun, tee). */
export function createGlowTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(220, 250, 255, 1.0)')
    gradient.addColorStop(0.35, 'rgba(140, 220, 255, 0.55)')
    gradient.addColorStop(1, 'rgba(120, 200, 255, 0.0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Final post-process pass: gentle vignette, slight chromatic aberration toward the edges, film grain. */
export function createPostFxShader(): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  return {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      varying vec2 vUv;
      float grainHash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 60.0) * 43758.5453);
      }
      void main() {
        vec2 c = vUv - 0.5;
        float d = length(c);
        float ca = d * 0.0025;
        vec2 dir = normalize(c + 1e-6);
        float r = texture2D(tDiffuse, vUv - dir * ca).r;
        float g = texture2D(tDiffuse, vUv).g;
        float b = texture2D(tDiffuse, vUv + dir * ca).b;
        vec3 col = vec3(r, g, b);
        float vignette = smoothstep(0.9, 0.35, d);
        col *= mix(0.72, 1.0, vignette);
        float grain = (grainHash(vUv * vec2(1024.0, 1024.0)) - 0.5) * 0.012;
        col += grain;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }
}

/** Converts a CSS hex colour into a GLSL `vec3(...)` literal for baking constant palette colours into shaders. */
function glslColor(hex: string): string {
  const c = new THREE.Color(hex)
  return `vec3(${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)})`
}
