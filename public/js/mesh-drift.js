// Mesh Drift Shader (21st.dev Style - WebGL Fluid Gradient Background)
(function () {
  const canvas = document.getElementById('meshDriftCanvas');
  if (!canvas) return;

  const gl = canvas.getContext('webgl', {
    powerPreference: 'low-power',
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false
  });

  if (!gl) {
    console.warn('WebGL not supported for Mesh Drift Shader');
    return;
  }

  const vsSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fsSource = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_mouse;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187,
                          0.366025403784439,
                         -0.577350269189626,
                          0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
            + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m;
      m = m * m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / u_resolution.y;
      vec2 p = uv;
      p.x *= aspect;

      // Subtle mouse spotlight interaction
      vec2 mousePos = u_mouse / u_resolution.xy;
      mousePos.x *= aspect;
      float mouseDist = length(p - mousePos);
      float mouseFactor = exp(-mouseDist * 2.8) * 0.18;

      float t = u_time * 0.12;

      // Multi-layer domain warping for organic mesh drift
      float n1 = snoise(p * 1.1 + vec2(t * 0.5, t * 0.35));
      float n2 = snoise(p * 1.7 - vec2(t * 0.38, t * 0.6) + vec2(n1, -n1) * 0.45);
      float n3 = snoise(p * 2.3 + vec2(n2, n1) * 0.35 + vec2(t * 0.28, -t * 0.22));

      // 21st.dev Palette: Deep Midnight Navy, Electric Blue, Subtle Cyan & Deep Violet
      vec3 c0 = vec3(0.035, 0.045, 0.075);  // Deep canvas darkness
      vec3 c1 = vec3(0.07, 0.22, 0.48);     // Electric sapphire
      vec3 c2 = vec3(0.05, 0.42, 0.46);     // Oceanic cyan/teal
      vec3 c3 = vec3(0.25, 0.10, 0.48);     // Nebula violet

      float w1 = smoothstep(-0.6, 0.8, n1 + mouseFactor);
      float w2 = smoothstep(-0.4, 0.9, n2);
      float w3 = smoothstep(-0.25, 0.95, n3);

      vec3 color = mix(c0, c1, w1);
      color = mix(color, c2, w2 * 0.85);
      color = mix(color, c3, w3 * 0.65);

      // Subtle noise dithering prevents gradient banding
      float grain = fract(sin(dot(uv, vec2(12.9898, 78.233) + u_time * 0.01)) * 43758.5453);
      color += (grain - 0.5) * 0.022;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Program link failed:', gl.getProgramInfoLog(program));
    return;
  }
  gl.useProgram(program);

  // Screen quad geometry
  const posBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]),
    gl.STATIC_DRAW
  );

  const aPos = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, 'u_resolution');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uMouse = gl.getUniformLocation(program, 'u_mouse');

  let mouseX = window.innerWidth * 0.5;
  let mouseY = window.innerHeight * 0.5;
  let targetMouseX = mouseX;
  let targetMouseY = mouseY;

  window.addEventListener('mousemove', (e) => {
    targetMouseX = e.clientX;
    targetMouseY = window.innerHeight - e.clientY;
  }, { passive: true });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.floor(window.innerWidth * dpr * 0.65);
    const height = Math.floor(window.innerHeight * dpr * 0.65);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();

  let startTime = performance.now();
  let animationFrameId = null;

  function render(now) {
    if (document.hidden || document.body.classList.contains('is-watching')) {
      // Pause loop to save 100% battery & GPU during fullscreen watching
      animationFrameId = requestAnimationFrame(render);
      return;
    }

    // Smooth lerp mouse towards target
    mouseX += (targetMouseX - mouseX) * 0.05;
    mouseY += (targetMouseY - mouseY) * 0.05;

    const elapsed = (now - startTime) * 0.001;

    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, elapsed);
    gl.uniform2f(uMouse, mouseX * (canvas.width / window.innerWidth), mouseY * (canvas.height / window.innerHeight));

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    animationFrameId = requestAnimationFrame(render);
  }

  animationFrameId = requestAnimationFrame(render);
})();
