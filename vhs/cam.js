/* gualo.site/vhs — the VHS camera, live in the browser.
 *
 * The picture is the AnalogDamage engine from the SYCSTEM VHS plugin (analog-damage/src/AnalogDamageEngine.h),
 * ported to one WebGL2 shader with the same pipeline order, the same hash32 / value-noise / fbm, the same seeds
 * and the same resolution scaling:
 *   1 gate weave · 2 VHS chroma misalignment · 3 tape tracking errors · 4 tape dropouts · 5 scan lines · 6 film burns
 * Per-frame values that the plugin computes once per frame (drift, bumps, band position, dropout events, burn slots,
 * flicker) are computed here on the CPU with the same math and handed to the shader as uniforms.
 * The plugin's sliders become three tape speeds: SP (clean), LP (worn), EP (chewed).
 */
(function () {
  'use strict';
  var SEED = 1234; // the plugin's default Global Seed

  // ── presets (plugin units: sliders / 100, except chroma shift & blur which are raw) ──
  var SPEEDS = {
    SP: { weaveAmount: .12, weaveSpeed: 1, weaveXBias: .5, weaveRotation: .2, weaveBumpFreq: .15,
          chromaShift: 4, chromaBlur: 3, chromaDriftSpeed: .3, chromaDriftAmount: .25,
          trackingAmount: .12, trackingBandPos: 0, trackingBandWidth: .1, trackingSpeed: .5, trackingTear: .12,
          dropoutAmount: .08, dropoutLength: .3, dropoutSmear: .5, dropoutDuration: .3,
          scanlineStrength: .22, scanlineWidth: 1, scanlineLumaReact: .5, scanlineInterlace: 3, scanlineFlicker: .2,
          burnIntensity: 0, burnSpeed: 1, burnWarmth: .7, burnFrequency: .3, burnScale: .8 },
    LP: { weaveAmount: .28, weaveSpeed: 1, weaveXBias: .5, weaveRotation: .3, weaveBumpFreq: .3,
          chromaShift: 8, chromaBlur: 6, chromaDriftSpeed: .4, chromaDriftAmount: .5,
          trackingAmount: .35, trackingBandPos: 0, trackingBandWidth: .14, trackingSpeed: .6, trackingTear: .35,
          dropoutAmount: .25, dropoutLength: .35, dropoutSmear: .6, dropoutDuration: .35,
          scanlineStrength: .32, scanlineWidth: 1, scanlineLumaReact: .5, scanlineInterlace: 3, scanlineFlicker: .3,
          burnIntensity: 0, burnSpeed: 1, burnWarmth: .7, burnFrequency: .3, burnScale: .8 },
    EP: { weaveAmount: .5, weaveSpeed: 1.2, weaveXBias: .5, weaveRotation: .4, weaveBumpFreq: .5,
          chromaShift: 13, chromaBlur: 10, chromaDriftSpeed: .6, chromaDriftAmount: .8,
          trackingAmount: .7, trackingBandPos: 0, trackingBandWidth: .2, trackingSpeed: .8, trackingTear: .6,
          dropoutAmount: .55, dropoutLength: .4, dropoutSmear: .7, dropoutDuration: .5,
          scanlineStrength: .42, scanlineWidth: 1.1, scanlineLumaReact: .5, scanlineInterlace: 3, scanlineFlicker: .4,
          burnIntensity: .25, burnSpeed: 1, burnWarmth: .7, burnFrequency: .2, burnScale: .8 }
  };

  // ── the engine's hash + noise, bit-for-bit (uint32 math via Math.imul) ──
  function hash32(x) {
    x >>>= 0;
    x = Math.imul((x >>> 16) ^ x, 0x45d9f3b) >>> 0;
    x = Math.imul((x >>> 16) ^ x, 0x45d9f3b) >>> 0;
    return ((x >>> 16) ^ x) >>> 0;
  }
  function hf(s) { return (hash32(s) & 0x7fffffff) / 0x7fffffff; }
  function hf2(a, b) { return hf((Math.imul(a, 1597334677) + Math.imul(b, 3812015801 | 0)) >>> 0); }
  function vn1(t, seed) {
    var i = Math.floor(t), f = t - i; f = f * f * (3 - 2 * f);
    var a = hf2(i, seed), b = hf2(i + 1, seed);
    return (a + (b - a) * f) * 2 - 1;
  }
  function fbm1(t, seed, oct) {
    var v = 0, amp = 1, fr = 1, tot = 0;
    for (var i = 0; i < oct; i++) { v += amp * vn1(t * fr, (seed + i * 7919) >>> 0); tot += amp; amp *= .5; fr *= 2; }
    return v / tot;
  }
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  // ── the shader ──
  var VS = '#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var FS = [
    '#version 300 es',
    'precision highp float; precision highp int;',
    'uniform sampler2D uTex; uniform vec2 uRes; uniform vec4 uCrop;',
    'uniform vec3 uWeave; uniform vec3 uChroma;',            // shift px, blur sigma px, on
    'uniform vec4 uTrack; uniform vec2 uTrackK;',            // amount, bandCenter, bandHalf, tear | resScale, octaves
    'uniform float uTime; uniform uint uSeed; uniform uint uFrame;',
    'uniform int uDropN; uniform vec4 uDrop[32]; uniform vec4 uDropB[32]; uniform uint uDropS[32];',
    'uniform vec4 uScan; uniform float uLuma;',              // strength, spacing, interlace offset, flicker
    'uniform int uBurnN; uniform vec4 uBurn[4]; uniform uint uBurnS[4]; uniform vec4 uBurnP; uniform vec3 uBurnC;',
    'out vec4 o;',
    'uint h32(uint x){x=((x>>16u)^x)*0x45d9f3bu;x=((x>>16u)^x)*0x45d9f3bu;return (x>>16u)^x;}',
    'float hf(uint s){return float(h32(s)&0x7FFFFFFFu)/2147483647.;}',
    'float hf2(uint a,uint b){return hf(a*1597334677u+b*3812015801u);}',
    'float hf3(uint a,uint b,uint c){return hf(a*1597334677u+b*3812015801u+c*2798796415u);}',
    'float vn1(float t,uint s){float fi=floor(t);int i=int(fi);float f=t-fi;f=f*f*(3.-2.*f);return mix(hf2(uint(i),s),hf2(uint(i+1),s),f)*2.-1.;}',
    'float fbm1(float t,uint s,int oc){float v=0.,a=1.,fr=1.,tt=0.;for(int i=0;i<5;i++){if(i>=oc)break;v+=a*vn1(t*fr,s+uint(i)*7919u);tt+=a;a*=.5;fr*=2.;}return v/tt;}',
    'float vn2(float x,float y,uint s){float fx0=floor(x),fy0=floor(y);int ix=int(fx0),iy=int(fy0);float fx=x-fx0,fy=y-fy0;fx=fx*fx*(3.-2.*fx);fy=fy*fy*(3.-2.*fy);',
    '  float a=hf3(uint(ix),uint(iy),s),b=hf3(uint(ix+1),uint(iy),s),c=hf3(uint(ix),uint(iy+1),s),d=hf3(uint(ix+1),uint(iy+1),s);return mix(mix(a,b,fx),mix(c,d,fx),fy)*2.-1.;}',
    'float fbm2(float x,float y,uint s,int oc){float v=0.,a=1.,fr=1.,tt=0.;for(int i=0;i<4;i++){if(i>=oc)break;v+=a*vn2(x*fr,y*fr,s+uint(i)*4177u);tt+=a;a*=.5;fr*=2.;}return v/tt;}',
    // 1 · gate weave: the source sampled through the drifted, rotated gate (bilinear, edges clamped)
    'vec3 src(vec2 p){vec2 c=uRes*.5,d=p-c;float cr=cos(uWeave.z),sr=sin(uWeave.z);',
    '  vec2 s=vec2(cr*d.x+sr*d.y,-sr*d.x+cr*d.y)+c-uWeave.xy;s=clamp(s,vec2(0.),uRes-1.);',
    '  return texture(uTex,uCrop.xy+((s+.5)/uRes)*uCrop.zw).rgb;}',
    'vec2 cc(vec3 c){return vec2(dot(c,vec3(-.169,-.331,.5)),dot(c,vec3(.5,-.419,-.081)));}',
    // 2 · VHS chroma: luma stays sharp; Cb/Cr blurred (3-pass box ≈ gaussian) and shifted right with slow drift
    'vec3 stage2(vec2 q){vec3 b=src(q);if(uChroma.z<.5)return b;float Y=dot(b,vec3(.299,.587,.114));',
    '  float x=q.x-uChroma.x;vec2 k;',
    '  if(uChroma.y<.5){k=cc(src(vec2(x,q.y)));}else{',
    '    float w[5]=float[](.2270270,.1945946,.1216216,.0540540,.0162162);k=cc(src(vec2(x,q.y)))*w[0];',
    '    for(int i=1;i<5;i++){float off=float(i)*uChroma.y*.5;k+=(cc(src(vec2(x+off,q.y)))+cc(src(vec2(x-off,q.y))))*w[i];}}',
    '  return clamp(vec3(Y+1.402*k.y,Y-.344136*k.x-.714136*k.y,Y+1.772*k.x),0.,1.);}',
    // 3 · tracking: a rolling band that tears rows sideways, jitters them vertically and adds hash noise
    'vec3 stage3(vec2 p){if(uTrack.x<=.005)return stage2(p);',
    '  float bm=1.-smoothstep(0.,uTrack.z,abs(p.y-uTrack.y));',
    '  float rn=fbm1(p.y*.05+uTime*3.,uSeed+7000u,int(uTrackK.y));',
    '  float dsp=bm*(uTrack.w+rn*uTrack.x*20.*uTrackK.x);',
    '  float sy=clamp(float(int(p.y+bm*rn*uTrack.x*3.)),0.,uRes.y-1.);',
    '  vec3 c=stage2(vec2(p.x-dsp,sy));',
    '  if(bm>.1){float n=hf3(uint(p.x),uint(p.y),uSeed+uFrame*31u);c=clamp(c+(n*2.-1.)*bm*.15*uTrack.x,0.,1.);}',
    '  return c;}',
    'void main(){vec2 p=vec2(floor(gl_FragCoord.x),uRes.y-1.-floor(gl_FragCoord.y));',
    '  vec3 c=stage3(p);',
    // 4 · dropouts: short horizontal signal losses — a white flash, then a smear of the last good pixel
    '  for(int i=0;i<32;i++){if(i>=uDropN)break;vec4 e=uDrop[i],b=uDropB[i];',
    '    if(p.y<e.x||p.y>=e.x+b.x||p.x<e.y||p.x>e.z)continue;',
    '    vec3 hold=stage3(vec2(max(e.y-1.,0.),p.y));float d=p.x-e.y;',
    '    if(d<e.w){float n=hf3(uint(p.x),uint(p.y),uDropS[i]+5u);c=mix(c,mix(hold,vec3(.7+n*.3),.4),b.y);}',
    '    else{c=mix(c,hold,clamp(1.-(d-e.w)/(b.z+1e-6),0.,1.)*b.y);}}',
    // 5 · scan lines: luma-reactive, interlaced, flickering
    '  if(uScan.x>.005){float lp=fract((p.y+uScan.z)/uScan.y);float sd=.5+.5*cos(lp*6.2831853);sd=1.-(1.-sd)*uScan.x*uScan.w;',
    '    float lum=dot(c,vec3(.2126,.7152,.0722));float lf=uLuma>.01?clamp(1.-lum*uLuma,.2,1.):1.;c*=mix(1.,sd,lf);}',
    // 6 · film burns: warm fractal light leaks near the edges
    '  for(int i=0;i<4;i++){if(i>=uBurnN)break;vec4 B=uBurn[i];vec2 n=p/uRes;',
    '    float dx=(n.x-B.x)/uBurnP.y,dy=(n.y-B.y)/(uBurnP.y*.7);',
    '    float fr=fbm2(n.x*3.+uBurnP.z*.2,n.y*3.+uBurnP.z*.15,uBurnS[i]+3u,int(uBurnP.w));',
    '    float sh=clamp(1.-sqrt(dx*dx+dy*dy)*(1.5-fr*.5),0.,1.);sh*=sh;float it=sh*B.z*uBurnP.x;',
    '    if(it>.001){c=clamp(c+it*uBurnC,0.,1.);if(it>.3){float l=dot(c,vec3(.2126,.7152,.0722));c=mix(c,vec3(l),clamp((it-.3)*.7,0.,.8));}}}',
    '  o=vec4(c,1.);}'
  ].join('\n');

  // ── state ──
  var $ = function (id) { return document.getElementById(id); };
  var root, canvas, gl, prog, U = {}, tex, video, stream = null, facing = 'environment', speed = 'SP', mode = 'photo';
  var raf = 0, t0 = 0, rec = null, recChunks = [], recStart = 0, lastBlob = null, lastKind = '', W = 0, H = 0, hasMany = false;

  function msg(text) { var m = $('cMsg'); m.textContent = text || ''; m.hidden = !text; }

  function initGL() {
    gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) return false;
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uTex', 'uRes', 'uCrop', 'uWeave', 'uChroma', 'uTrack', 'uTrackK', 'uTime', 'uSeed', 'uFrame', 'uDropN', 'uDrop', 'uDropB', 'uDropS',
     'uScan', 'uLuma', 'uBurnN', 'uBurn', 'uBurnS', 'uBurnP', 'uBurnC'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n) || gl.getUniformLocation(prog, n + '[0]'); });
    tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.uTex, 0);
    return true;
  }

  // canvas = the screen's shape at a tape-ish 540 lines on the short side (VHS was ~240–480)
  function size() {
    if (rec) return;
    var a = innerWidth / innerHeight, S = 540;
    W = a >= 1 ? Math.round(S * a) : S; H = a >= 1 ? S : Math.round(S / a);
    canvas.width = W; canvas.height = H; if (gl) gl.viewport(0, 0, W, H);
  }

  // ── the per-frame values the plugin computes once per frame ──
  function frameParams(P, time, frame) {
    var rs = Math.min(W, H) / 1080, out = {};
    // 1 gate weave
    var dx = 0, dy = 0, rot = 0;
    if (P.weaveAmount > .005) {
      var t = time * P.weaveSpeed, s = SEED + 100;
      dx = fbm1(t * .7, s, 5) * P.weaveAmount * 4 * rs; dy = fbm1(t * .5, s + 1000, 5) * P.weaveAmount * 3 * rs;
      dx *= .5 + P.weaveXBias * .5; dy *= 1 - P.weaveXBias * .5;
      rot = fbm1(t * .3, s + 2000, 5) * P.weaveRotation * .003;
      if (P.weaveBumpFreq > .01) {
        var ph = t * P.weaveBumpFreq * 2, bi = Math.floor(ph), bf = ph - bi;
        if (hf2(bi, s + 3000) > .6) {
          var env = Math.exp(-bf * 5);
          dx += (hf2(bi, s + 3001) * 2 - 1) * env * P.weaveAmount * 8 * rs;
          dy += (hf2(bi, s + 3002) * 2 - 1) * env * P.weaveAmount * 4 * rs;
        }
      }
    }
    out.weave = [dx, dy, rot];
    // 2 chroma
    var cOn = !(P.chromaShift < .1 && P.chromaBlur < .1 && P.chromaDriftAmount < .01);
    var r = Math.floor(P.chromaBlur * 3 * rs), sigma = r > 0 ? Math.sqrt(r * (r + 1)) : 0;
    var drift = P.chromaDriftAmount > .01 ? fbm1(time * P.chromaDriftSpeed * .3, SEED + 5000, 3) * P.chromaDriftAmount * 6 * rs : 0;
    var shift = P.chromaShift * rs + drift; if (Math.abs(shift) <= .1) shift = 0;
    out.chroma = [shift, sigma, cOn ? 1 : 0];
    // 3 tracking
    var band = P.trackingBandPos > .01 ? P.trackingBandPos * H : (function (x) { return x - Math.floor(x); })(time * P.trackingSpeed * .1) * H * 1.4 - H * .2;
    out.track = [P.trackingAmount, band, P.trackingBandWidth * H * .5, P.trackingTear * 40 * rs];
    out.trackK = [rs, 3];
    // 4 dropouts
    var drops = [], dropsB = [], dropsS = [];
    if (P.dropoutAmount > .005) {
      var maxE = clamp(Math.floor(P.dropoutAmount * 30), 1, 60), persist = Math.max(1, Math.floor(P.dropoutDuration * 8));
      for (var f = 0; f < persist && drops.length < 32; f++) {
        var es = (SEED + Math.imul(frame - f, 97) + 8000) >>> 0, n = Math.floor(hf(es) * maxE), fade = 1 - f / persist; fade *= fade;
        for (var e = 0; e < n && drops.length < 32; e++) {
          var s2 = (es + Math.imul(e, 7919)) >>> 0;
          var ey = hf(s2 + 1) * H, ex = hf(s2 + 2) * W, len = (hf(s2 + 3) * .5 + .5) * P.dropoutLength * W * .3, smear = len * P.dropoutSmear * 2;
          var thick = 1 + Math.floor(hf(s2 + 4) * 2), sx = Math.max(0, Math.floor(ex)), exx = Math.min(W - 1, Math.floor(ex + len + smear));
          drops.push(Math.floor(ey), sx, exx, len); dropsB.push(thick, fade, smear, 0); dropsS.push(s2);
        }
      }
    }
    out.drops = drops; out.dropsB = dropsB; out.dropsS = dropsS;
    // 5 scan lines
    var spacing = Math.max(1, P.scanlineWidth * 4 * rs);
    var flick = P.scanlineFlicker > .01 ? 1 - fbm1(time * 8, SEED + 9000, 2) * P.scanlineFlicker * .3 : 1;
    var field = P.scanlineInterlace === 3 ? frame & 1 : P.scanlineInterlace === 1 ? frame & 1 : P.scanlineInterlace === 2 ? (frame + 1) & 1 : 0;
    out.scan = [P.scanlineStrength, spacing, field * spacing * .5, flick];
    // 6 burns
    var burns = [], burnsS = [];
    if (P.burnIntensity > .005) {
      var bt = time * P.burnSpeed, bs = SEED + 11000, iv = 1 / (P.burnFrequency * .3 + .01), cur = Math.floor(bt / iv);
      for (var k = -2; k <= 1; k++) {
        var slot = cur + k; if (slot < 0) continue;
        var ss = (bs + Math.imul(slot, 13397)) >>> 0;
        if (hf(ss) > P.burnFrequency) continue;
        var age = (bt - slot * iv) / iv; if (age < 0 || age > 1.5) continue;
        var en = age < .15 ? age / .15 : age < .5 ? 1 : 1 - (age - .5); en = clamp(en, 0, 1); en *= en;
        var cx = hf(ss + 1), cy = hf(ss + 2);
        cx = cx < .5 ? cx * .3 : 1 - (1 - cx) * .3; cy = cy < .5 ? cy * .4 : 1 - (1 - cy) * .4;
        burns.push(cx, cy, en, 0); burnsS.push(ss);
      }
      out.burnP = [P.burnIntensity, P.burnScale * .5 + .3, bt, 4];
    } else out.burnP = [0, 1, 0, 2];
    var w = P.burnWarmth; out.burnC = [1, .95 + (.65 - .95) * w, .85 + (.25 - .85) * w];
    out.burns = burns; out.burnsS = burnsS;
    return out;
  }

  function draw(now) {
    raf = requestAnimationFrame(draw);
    if (!video.videoWidth || video.readyState < 2) return;
    var time = (now - t0) / 1000, frame = Math.floor(time * 29.97), P = SPEEDS[speed], F = frameParams(P, time, frame);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    // cover-crop the camera into the frame (and mirror the selfie camera, like a mirror)
    var va = video.videoWidth / video.videoHeight, ca = W / H, sx = 1, sy = 1;
    if (va > ca) sx = ca / va; else sy = va / ca;
    var ox = (1 - sx) / 2, oy = (1 - sy) / 2;
    if (facing === 'user') gl.uniform4f(U.uCrop, 1 - ox, oy, -sx, sy); else gl.uniform4f(U.uCrop, ox, oy, sx, sy);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform3fv(U.uWeave, F.weave); gl.uniform3fv(U.uChroma, F.chroma);
    gl.uniform4fv(U.uTrack, F.track); gl.uniform2fv(U.uTrackK, F.trackK);
    gl.uniform1f(U.uTime, time); gl.uniform1ui(U.uSeed, SEED); gl.uniform1ui(U.uFrame, frame >>> 0);
    var nd = F.drops.length / 4; gl.uniform1i(U.uDropN, nd);
    if (nd) { gl.uniform4fv(U.uDrop, F.drops); gl.uniform4fv(U.uDropB, F.dropsB); gl.uniform1uiv(U.uDropS, new Uint32Array(F.dropsS)); }
    gl.uniform4fv(U.uScan, F.scan); gl.uniform1f(U.uLuma, P.scanlineLumaReact);
    var nb = F.burns.length / 4; gl.uniform1i(U.uBurnN, nb);
    if (nb) { gl.uniform4fv(U.uBurn, F.burns); gl.uniform1uiv(U.uBurnS, new Uint32Array(F.burnsS)); }
    gl.uniform4fv(U.uBurnP, F.burnP); gl.uniform3fv(U.uBurnC, F.burnC);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (rec) {
      var s = Math.floor((Date.now() - recStart) / 1000), p2 = function (v) { return String(v).padStart(2, '0'); };
      $('cTc').textContent = Math.floor(s / 3600) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60);
    }
  }

  // ── camera ──
  function startCamera() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    var want = { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true };
    return navigator.mediaDevices.getUserMedia(want).catch(function () { want.audio = false; return navigator.mediaDevices.getUserMedia(want); })
      .then(function (s) {
        stream = s; video.srcObject = s; video.muted = true;
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        msg('');
        return navigator.mediaDevices.enumerateDevices ? navigator.mediaDevices.enumerateDevices() : [];
      })
      .then(function (devs) {
        hasMany = (devs || []).filter(function (d) { return d.kind === 'videoinput'; }).length > 1;
        $('cFlip').hidden = !hasMany;
      });
  }

  function open() {
    root = $('cam'); canvas = $('view'); video = $('cVid');
    root.hidden = false; document.body.classList.add('camming');
    if (location.hash !== '#camera') history.replaceState(null, '', '#camera');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg('this browser can’t open the camera.'); return; }
    try { if (!gl && !initGL()) { msg('this browser can’t run the tape (WebGL2).'); return; } }
    catch (e) { msg('the tape couldn’t load: ' + String(e.message || e).slice(0, 80)); return; }
    size(); t0 = performance.now();
    msg('…');
    startCamera().then(function () { if (!raf) raf = requestAnimationFrame(draw); })
      .catch(function (e) {
        msg(e && e.name === 'NotAllowedError' ? 'camera blocked — allow it for gualo.site in your browser settings.' : 'no camera found.');
      });
  }

  function close() {
    if (rec) stopRec();
    cancelAnimationFrame(raf); raf = 0;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null;
    root.hidden = true; document.body.classList.remove('camming');
    if (location.hash === '#camera') history.replaceState(null, '', location.pathname + location.search);
  }

  // ── shooting ──
  function stamp() { var d = new Date(), p = function (v) { return String(v).padStart(2, '0'); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
  function photo() {
    canvas.toBlob(function (b) { if (b) keep(b, 'photo'); }, 'image/jpeg', .92);
    root.classList.remove('flash'); void root.offsetWidth; root.classList.add('flash');
  }
  function pickType() {
    var types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < types.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }
  function startRec() {
    if (!window.MediaRecorder || !canvas.captureStream) { msg('this browser can’t record video — photos still work.'); return; }
    var out = canvas.captureStream(30);
    if (stream) stream.getAudioTracks().forEach(function (t) { out.addTrack(t); });
    var type = pickType();
    try { rec = new MediaRecorder(out, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : { videoBitsPerSecond: 6e6 }); }
    catch (e) { rec = null; msg('recording isn’t available here.'); return; }
    recChunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
    rec.onstop = function () {
      var b = new Blob(recChunks, { type: (rec && rec.mimeType) || type || 'video/webm' });
      rec = null; root.classList.remove('recording'); $('cRec').textContent = 'STBY'; $('cTc').textContent = '0:00:00';
      if (b.size) keep(b, 'video');
    };
    rec.start(1000); recStart = Date.now();
    root.classList.add('recording'); $('cRec').textContent = 'REC';
  }
  function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); }

  function keep(blob, kind) {
    lastBlob = blob; lastKind = kind;
    var url = URL.createObjectURL(blob), th = $('cThumb');
    if (th.dataset.url) URL.revokeObjectURL(th.dataset.url);
    th.dataset.url = url; th.hidden = false;
    th.innerHTML = kind === 'photo' ? '<img alt="" src="' + url + '">' : '<video muted playsinline src="' + url + '#t=0.1"></video>';
  }
  function review() {
    if (!lastBlob) return;
    var url = $('cThumb').dataset.url, box = $('cShow');
    box.innerHTML = lastKind === 'photo' ? '<img alt="" src="' + url + '">' : '<video controls playsinline loop autoplay src="' + url + '"></video>';
    $('cReview').hidden = false;
  }
  function save() {
    if (!lastBlob) return;
    var ext = lastKind === 'photo' ? 'jpg' : (/mp4/.test(lastBlob.type) ? 'mp4' : 'webm');
    var name = 'VHS-' + stamp() + '.' + ext;
    var file = null; try { file = new File([lastBlob], name, { type: lastBlob.type }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(function () {});   // iPhone: "Save Image / Save Video" lives here
      return;
    }
    var a = document.createElement('a'); a.href = $('cThumb').dataset.url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── wiring ──
  function wire() {
    $('cClose').addEventListener('click', close);
    $('cShoot').addEventListener('click', function () { if (mode === 'photo') photo(); else if (rec) stopRec(); else startRec(); });
    $('cFlip').addEventListener('click', function () { if (rec) return; facing = facing === 'user' ? 'environment' : 'user'; startCamera().catch(function () {}); });
    $('cSpeed').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; speed = b.getAttribute('data-s');
      [].forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
    });
    $('cMode').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || rec) return; mode = b.getAttribute('data-m');
      [].forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
      root.classList.toggle('video', mode === 'video');
    });
    $('cThumb').addEventListener('click', review);
    $('cBack').addEventListener('click', function () { $('cReview').hidden = true; $('cShow').innerHTML = ''; });
    $('cSave').addEventListener('click', save);
    addEventListener('resize', function () { if (!root.hidden) size(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !root.hidden) { if (!$('cReview').hidden) $('cBack').click(); else close(); } });
  }

  window.VHSCam = { open: open, close: close, _wired: false };
  window.VHSCam.init = function () { if (!window.VHSCam._wired) { wire(); window.VHSCam._wired = true; } };
  // for tests: the engine math
  window.VHSCam._math = { hash32: hash32, hf: hf, hf2: hf2, fbm1: fbm1, frameParams: function (s, t, f, w, h) { W = w; H = h; return frameParams(SPEEDS[s], t, f); } };
})();
