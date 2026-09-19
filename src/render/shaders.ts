import * as THREE from 'three'

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
`

/** Maximum number of massive bodies the gravity-well sheet shader accepts. */
export const MAX_WELL_BODIES = 12

/** Deep-space background: large BackSide sphere with a soft procedural nebula gradient. */
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
        float n = fbm(d.xy * 2.2 + d.z * 1.3 + uTime * 0.003);
        float n2 = fbm(d.yz * 1.6 - uTime * 0.002);
        vec3 deep = vec3(0.015, 0.02, 0.05);
        vec3 blue = vec3(0.09, 0.12, 0.32);
        vec3 purple = vec3(0.18, 0.08, 0.28);
        vec3 col = mix(deep, blue, smoothstep(0.3, 0.85, n));
        col = mix(col, purple, smoothstep(0.4, 0.9, n2) * 0.6);
        // Values are linear; keep the sky dark so trails and the grid read clearly.
        gl_FragColor = vec4(col * 0.32, 1.0);
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

/** ~2500 twinkling background stars on a large shell. */
export function createStarfield(): THREE.Points {
  const count = 2500
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const brightness = new Float32Array(count)
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
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
  geometry.setAttribute('aBrightness', new THREE.Float32BufferAttribute(brightness, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aSize;
      attribute float aBrightness;
      varying float vBrightness;
      uniform float uTime;
      void main() {
        vBrightness = aBrightness * (0.75 + 0.25 * sin(uTime * 1.5 + aSize * 12.0));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize;
      }
    `,
    fragmentShader: `
      varying float vBrightness;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.98, 0.95) * vBrightness, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.renderOrder = -9
  return points
}

/** Procedurally banded planet/moon surface: fbm bands between two palette colours + fresnel rim. */
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
        float warp = fbm(vObjPos.xz * 1.6 + uTime * 0.02) * 1.2;
        float bands = fbm(vec2(lat + warp, vObjPos.x * 0.8 + vObjPos.z * 0.8));
        vec3 base = mix(uColorA, uColorB, smoothstep(0.25, 0.75, bands));
        float ndl = max(dot(n, normalize(uSunDir)), 0.0);
        vec3 lit = base * (0.18 + 0.82 * ndl);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
        vec3 col = lit + fresnel * mix(uColorA, uColorB, 0.5) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

/** Thin additive atmosphere shell drawn just outside a planet, BackSide so it glows at the limb. */
export function createAtmosphereMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
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
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 3.0);
        gl_FragColor = vec4(uColor, fresnel * 0.9);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
}

/**
 * The gravity-well ground sheet. Displaces a flat XZ grid downward by the combined potential of up
 * to MAX_WELL_BODIES massive bodies, and draws a glowing cyan grid on top, brighter where deeper.
 */
export function createWellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      // xz = body position, y = mu.
      uBodies: { value: new Array(MAX_WELL_BODIES).fill(0).map(() => new THREE.Vector3()) },
      uSoft: { value: new Float32Array(MAX_WELL_BODIES) },
      uCount: { value: 0 },
      uHalfExtent: { value: new THREE.Vector2(50, 50) },
    },
    vertexShader: `
      #define MAX_BODIES ${MAX_WELL_BODIES}
      uniform vec3 uBodies[MAX_BODIES];
      uniform float uSoft[MAX_BODIES];
      uniform int uCount;
      varying vec2 vGridXZ;
      varying float vDepth;
      // K chosen so mu=20, soft(radius)=1.2 gives roughly a 2 unit deep well.
      const float K = 0.12;
      float wellDepth(vec2 p) {
        float depth = 0.0;
        for (int i = 0; i < MAX_BODIES; i++) {
          if (i >= uCount) break;
          vec2 d = p - uBodies[i].xz;
          float r2 = dot(d, d);
          float s = uSoft[i];
          depth += uBodies[i].y / sqrt(r2 + s * s);
        }
        return depth * K;
      }
      void main() {
        vGridXZ = position.xy; // plane geometry is authored in XY before rotation
        float depth = wellDepth(position.xy);
        vDepth = clamp(depth, 0.0, 3.5);
        vec3 displaced = vec3(position.x, position.y, -vDepth);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vGridXZ;
      varying float vDepth;
      uniform vec2 uHalfExtent;
      void main() {
        vec2 g = abs(fract(vGridXZ - 0.5) - 0.5);
        vec2 fw = fwidth(vGridXZ);
        vec2 lineAA = smoothstep(vec2(0.0), fw * 1.5, g);
        float line = 1.0 - min(lineAA.x, lineAA.y);
        float edge = 1.0 - smoothstep(0.75, 1.0, length(vGridXZ / uHalfExtent));
        vec3 color = mix(vec3(0.05, 0.6, 0.85), vec3(0.4, 0.9, 1.0), clamp(vDepth / 3.0, 0.0, 1.0));
        float alpha = line * edge * (0.16 + 0.6 * clamp(vDepth / 2.0, 0.0, 1.0));
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Swirling orange/white accretion disc for a black hole, additive so it feeds the bloom pass. */
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
        float fade = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
        gl_FragColor = vec4(col * 0.95, fade * 0.9);
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

/** Pulsing emerald target-gate ring, additive so it blooms. */
export function createGateRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
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
      void main() {
        float pulse = 0.65 + 0.35 * sin(uTime * 2.5);
        vec3 base = vec3(0.20, 0.83, 0.60);
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

/** Faint inner disc of the target gate. */
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
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.0, 1.0, d)) * (0.12 + 0.05 * sin(uTime * 2.5));
        gl_FragColor = vec4(vec3(0.2, 0.83, 0.6), a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
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
        vec3 col = vec3(0.25, 0.9, 0.65);
        gl_FragColor = vec4(col, clamp(fade, 0.0, 1.0) * 0.35);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Radial-gradient CanvasTexture used for the probe's glow sprite. */
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
