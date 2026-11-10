/* VYDE WEB 1.0.0 — the VYDE camcorder in a browser (Gualo Hawes · SYCSTEM UI 7 ink).
   One WebGL picture = preview = recording: camera → tape look (2 passes) → canvas → captureStream + mic → MediaRecorder.
   No network after load, no libraries. */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var FPS = 30, FD = 1000 / FPS;

  // ---------- looks (VYDE engine keys; SP = VYDE's own defaults) ----------
  var LOOKS = {
    SP: { smear: 0.5, noise: 0.05, snow: 0.00025, head: 8, track: 0, chroma: 0.0, pre: 1.0, phase: 0.0, grain: 0.0, wave: 0.6, bleed: 2.0, note: 'SP · VYDE look' },
    LP: { smear: 0.8, noise: 0.11, snow: 0.0012, head: 11, track: 0, chroma: 0.35, pre: 1.3, phase: 0.18, grain: 0.06, wave: 1.4, bleed: 3.0, note: 'LP · worn tape' },
    EP: { smear: 1.1, noise: 0.19, snow: 0.0035, head: 15, track: 28, chroma: 0.7, pre: 1.6, phase: 0.35, grain: 0.12, wave: 2.6, bleed: 4.0, note: 'EP · chewed tape' }
  };
  var TUBE = { gy: 0.18, sp: 0.14, warm: 0.4, amt: 0.85 }; // VYDE iOS TUBE defaults

  // ---------- settings (per phone) ----------
  var S = { tape: 'SP', amt: 1, tube: false, sound: true, tapeSnd: false, hud: 'STD', front: false };
  try { var saved = JSON.parse(localStorage.getItem('vyde.web') || '{}'); for (var k in saved) if (k in S) S[k] = saved[k]; } catch (e) {}
  if (!LOOKS[S.tape]) S.tape = 'SP';
  function store() { try { localStorage.setItem('vyde.web', JSON.stringify(S)); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var body = document.body, view = $('view'), vid = $('src');

  // gear icon (InkIcon.gear: 8 teeth, ro 9, ri 6.9)
  (function () {
    var n = 8, ro = 9, ri = 6.9, st = 2 * Math.PI / n, wo = st * 0.17, wi = st * 0.27, s = '';
    function P(r, a) { return (12 + r * Math.cos(a)).toFixed(2) + ' ' + (12 + r * Math.sin(a)).toFixed(2); }
    for (var k = 0; k < n; k++) {
      var t = k * st - Math.PI / 2;
      s += (k ? 'L' : 'M') + P(ri, t - wi) + 'L' + P(ro, t - wo) + 'A' + ro + ' ' + ro + ' 0 0 1 ' + P(ro, t + wo) + 'L' + P(ri, t + wi) + 'A' + ri + ' ' + ri + ' 0 0 1 ' + P(ri, t + st - wi);
    }
    $('gearp').setAttribute('d', s + 'Z');
  })();
  $('ver').textContent = VERSION;

  // ---------- WebGL ----------
  var gl = view.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var HEAD = 'precision highp float;' +
    'float h1(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}' +
    'float h2(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}' +
    'float vn(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(h1(i),h1(i+1.),f);}';
  // pass 1: camera → crop/zoom/mirror → line timing (edge wave, head switching, tracking) → YIQ
  var FS1 = HEAD +
    'uniform sampler2D uV;uniform vec2 uRes,uCrop;uniform float uMir,uF,uHead,uTrack,uTrackY,uWave;uniform vec4 uR;' +
    'void main(){vec2 px=gl_FragCoord.xy;float L=(uRes.y-px.y)*480./uRes.y;float Li=floor(L);float sx=0.;' +
    'sx+=(vn(L*.07+uF*.9)-.5)*2.*uWave;' +
    'float fb=480.-L;if(fb<uHead){float k=1.-fb/uHead;sx+=k*k*(28.+22.*h1(Li+uR.x));}' +
    'float d=L-uTrackY;if(uTrack>0.&&d>=0.&&d<uTrack){float k=sin(3.14159*d/uTrack);sx+=k*(h1(Li*1.7+uR.y)-.5)*26.;}' +
    'sx*=uRes.x/640.;' +
    'vec2 uv=vec2((px.x-sx)/uRes.x,1.-px.y/uRes.y);uv=.5+(uv-.5)*uCrop;if(uMir>.5)uv.x=1.-uv.x;' +
    'vec3 c=texture2D(uV,clamp(uv,0.,1.)).rgb;if(uv.x<0.||uv.x>1.)c=vec3(0.);' +
    'float y=dot(c,vec3(.299,.587,.114));float i=dot(c,vec3(.596,-.274,-.322));float q=dot(c,vec3(.211,-.523,.312));' +
    'gl_FragColor=vec4(y,i*.5+.5,q*.5+.5,1.);}';
  // pass 2: luma smear + pre-emphasis ringing, chroma bandwidth + delay + line comb, noise, snow, head switch, tube drift
  var FS2 = HEAD +
    'uniform sampler2D uT;uniform vec2 uRes;uniform float uF,uSmear,uNoise,uSnow,uHead,uTrack,uTrackY,uChroma,uPre,uPhase,uGrain,uBleed;uniform vec4 uR;' +
    'uniform vec4 uTube;uniform float uTubeOn;' +
    'vec3 T(vec2 p){return texture2D(uT,p/uRes).rgb;}' +
    'void main(){vec2 px=gl_FragCoord.xy;float s=uRes.x/640.;float L=(uRes.y-px.y)*480./uRes.y;float Li=floor(L);' +
    'float sp=(.6+uSmear*1.6)*s;' +
    'float yb=T(px+vec2(-3.*sp,0.)).r*.08+T(px+vec2(-2.*sp,0.)).r*.15+T(px+vec2(-sp,0.)).r*.25+T(px).r*.37+T(px+vec2(sp,0.)).r*.15;' +
    'float yw=(T(px+vec2(-6.*sp,0.)).r+T(px+vec2(-3.*sp,0.)).r+yb+T(px+vec2(3.*sp,0.)).r+T(px+vec2(6.*sp,0.)).r)*.2;' +
    'float y=yb+uPre*.38*(yb-yw);' +
    'vec2 c=vec2(0.);float cx=px.x-uBleed*s;' +
    'for(int k=0;k<8;k++){float o=(float(k)-3.5)*1.7*s;c+=T(vec2(cx+o,px.y)).gb+T(vec2(cx+o,px.y+1.)).gb;}' +
    'c=(c/16.-.5)*2.;' +
    'float lh=h1(Li*3.7+uR.x);c*=1.-uChroma*.3;if(lh<uChroma*.22)c*=.12;' +
    'float a=(h1(Li+uR.y)-.5)*uPhase*1.1+(vn(L*.02+uF*.3)-.5)*uPhase;float ca=cos(a),sa=sin(a);c=vec2(c.x*ca-c.y*sa,c.x*sa+c.y*ca);' +
    'float off=h1(Li*1.31+uR.z)*997.;float n=vn(px.x*.55/s+off)-.5;y+=n*uNoise*.9;' +
    'c+=vec2(vn(px.x*.18/s+off*1.3)-.5,vn(px.x*.18/s+off*.7)-.5)*uNoise*.7;' +
    'y+=(h2(px+uR.xy)-.5)*uGrain*.5;' +
    'float seg=floor(px.x/(5.*s));if(h2(vec2(seg,Li)+uR.zw)<uSnow*.8){y+=(1.-fract(px.x/(5.*s)))*.75;}' +
    'float fb=480.-L;if(fb<uHead){y+=(h2(px*.7+uR.wx)-.5)*.28+.04;c*=.5;}' +
    'float d=L-uTrackY;if(uTrack>0.&&d>=0.&&d<uTrack){float k=sin(3.14159*d/uTrack);float r=h2(vec2(floor(px.x/(3.*s)),Li)+uR.yz);if(r>1.-k*.35)y=mix(y,.9,.8);y+=(r-.5)*k*.2;}' +
    'vec3 rgb=vec3(y+.956*c.x+.621*c.y,y-.272*c.x-.647*c.y,y-1.106*c.x+1.703*c.y);rgb=clamp(rgb,0.,1.);' +
    'if(uTubeOn>.5){vec3 q=rgb;float g=clamp(q.g-max(q.r,q.b),0.,1.);q.r+=g*uTube.x;float b=clamp(q.b-max(q.r,q.g),0.,1.);' +
    'q.r+=b*uTube.y*.8;q.g-=b*uTube.y*.3;q.r+=uTube.z*.04;q.b-=uTube.z*.025;rgb=mix(rgb,clamp(q,0.,1.),uTube.w);}' +
    'gl_FragColor=vec4(rgb,1.);}';

  var P1, P2, U1 = {}, U2 = {}, vtex, ftex, fbo, glOK = !!gl;
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function prog(fs, names, U) {
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    names.forEach(function (n) { U[n] = gl.getUniformLocation(p, n); }); return p;
  }
  function tex() { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  if (glOK) {
    try {
      P1 = prog(FS1, ['uV', 'uRes', 'uCrop', 'uMir', 'uF', 'uHead', 'uTrack', 'uTrackY', 'uWave', 'uR'], U1);
      P2 = prog(FS2, ['uT', 'uRes', 'uF', 'uSmear', 'uNoise', 'uSnow', 'uHead', 'uTrack', 'uTrackY', 'uChroma', 'uPre', 'uPhase', 'uGrain', 'uBleed', 'uTube', 'uTubeOn', 'uR'], U2);
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      vtex = tex(); ftex = tex(); fbo = gl.createFramebuffer();
    } catch (e) { glOK = false; console.warn('VYDE GL', e); }
  }
  var W = 0, H = 0;
  function size(w, h) {
    if (w === W && h === H) return; W = w; H = h; view.width = w; view.height = h;
    if (!glOK) return;
    gl.bindTexture(gl.TEXTURE_2D, ftex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ftex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  var frameN = 0, zoom = 1, hasFrame = false;
  function draw() {
    if (!glOK || vid.readyState < 2 || !vid.videoWidth) return false;
    var a = S.amt, L = LOOKS[S.tape], f = frameN % 4096;
    var head = Math.round(L.head * a), track = Math.round(L.track * a);
    var trackY = track > 0 ? ((frameN * 1.6) % (480 + track * 2)) - track : -999;
    gl.bindTexture(gl.TEXTURE_2D, vtex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, vid); } catch (e) { return false; }
    var V = vid.videoWidth / vid.videoHeight, A = W / H, cx = 1, cy = 1;
    if (V > A) cx = A / V; else cy = V / A;
    // pass 1
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H); gl.useProgram(P1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vtex); gl.uniform1i(U1.uV, 0);
    gl.uniform2f(U1.uRes, W, H); gl.uniform2f(U1.uCrop, cx / zoom, cy / zoom); gl.uniform1f(U1.uMir, S.front ? 1 : 0);
    gl.uniform1f(U1.uF, f); gl.uniform1f(U1.uHead, head); gl.uniform1f(U1.uTrack, track); gl.uniform1f(U1.uTrackY, trackY);
    gl.uniform1f(U1.uWave, L.wave * a);
    var r0 = Math.random() * 512, r1 = Math.random() * 512, r2 = Math.random() * 512, r3 = Math.random() * 512;
    gl.uniform4f(U1.uR, r0, r1, r2, r3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // pass 2
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(P2);
    gl.bindTexture(gl.TEXTURE_2D, ftex); gl.uniform1i(U2.uT, 0);
    gl.uniform2f(U2.uRes, W, H); gl.uniform1f(U2.uF, f);
    gl.uniform1f(U2.uSmear, L.smear * a); gl.uniform1f(U2.uNoise, L.noise * a); gl.uniform1f(U2.uSnow, L.snow * a);
    gl.uniform1f(U2.uHead, head); gl.uniform1f(U2.uTrack, track); gl.uniform1f(U2.uTrackY, trackY);
    gl.uniform1f(U2.uChroma, Math.min(1, L.chroma * a)); gl.uniform1f(U2.uPre, L.pre); gl.uniform1f(U2.uPhase, L.phase * a);
    gl.uniform1f(U2.uGrain, L.grain * a); gl.uniform1f(U2.uBleed, L.bleed * Math.min(1, a));
    gl.uniform4f(U2.uTube, TUBE.gy, TUBE.sp, TUBE.warm, TUBE.amt); gl.uniform1f(U2.uTubeOn, S.tube ? 1 : 0); gl.uniform4f(U2.uR, r0, r1, r2, r3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frameN++; hasFrame = true; return true;
  }

  // ---------- layout ----------
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  body.appendChild(probe);
  var land = false;
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight, cs = getComputedStyle(probe);
    var st = parseFloat(cs.paddingTop) || 0, sr = parseFloat(cs.paddingRight) || 0, sb = parseFloat(cs.paddingBottom) || 0, sl = parseFloat(cs.paddingLeft) || 0;
    land = vw > vh;
    body.classList.toggle('land', land); body.classList.toggle('port', !land);
    if (!recording) size(land ? 640 : 480, land ? 480 : 640);
    var ar = W / H, x0, y0, x1, y1, stat = $('status'), snd = $('sound');
    if (land) {
      var railL = vw - sr - 10 - 80 - 8, colR = sl + 12 + 150;
      x0 = colR; x1 = railL; y0 = st + 8; y1 = vh - sb - 8;
      if ((x1 - x0) < (y1 - y0) * ar * 0.82) x0 = sl + 8; // narrow screen: the picture comes first, the readouts float over it
      stat.style.left = (sl + 12) + 'px'; stat.style.top = (st + 12) + 'px'; stat.style.right = 'auto';
      snd.style.left = (sl + 12) + 'px'; snd.style.bottom = (sb + 14) + 'px'; snd.style.top = 'auto'; snd.style.right = 'auto';
    } else {
      x0 = sl; x1 = vw - sr; y0 = st + 10 + 64 + 8; y1 = vh - sb - 14 - 84 - 10;
      stat.style.left = (sl + 14) + 'px'; stat.style.top = (st + 12) + 'px'; stat.style.right = 'auto';
      snd.style.right = (sr + 14) + 'px'; snd.style.top = (st + 14) + 'px'; snd.style.left = 'auto'; snd.style.bottom = 'auto';
    }
    var aw = Math.max(40, x1 - x0), ah = Math.max(40, y1 - y0), w = aw, h = w / ar;
    if (h > ah) { h = ah; w = h * ar; }
    w = Math.floor(w); h = Math.floor(h);
    var l = Math.round(x0 + (aw - w) / 2), t = Math.round(y0 + (ah - h) / 2);
    [view, $('frame')].forEach(function (el) { el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px'; });
    $('note').style.top = (t + 14) + 'px';
    $('note').style.left = (l + w / 2) + 'px';
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });

  // ---------- camera + mic ----------
  var vstream = null, vtrack = null, astream = null, atrack = null, wake = null;
  function vcons() { return { facingMode: S.front ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }; }
  var ACONS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
  function failText(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError')
      return 'The camera is blocked for this page. On iPhone: tap “aA” in the address bar › Website Settings › Camera and Microphone › Allow, then reload. Or Settings › Safari › Camera › Allow.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
    if (n === 'NotReadableError' || n === 'AbortError') return 'Another app is using the camera. Close it, then tap Start again.';
    return 'The camera could not start (' + (n || 'unknown') + '). Reload and try again.';
  }
  function gum(c) { return navigator.mediaDevices.getUserMedia(c); }
  function attach(stream) {
    vstream = stream; vtrack = stream.getVideoTracks()[0];
    vid.srcObject = stream; vid.muted = true; vid.setAttribute('playsinline', '');
    vtrack.addEventListener('ended', function () { if (!document.hidden) reopen(); });
    var caps = vtrack.getCapabilities ? vtrack.getCapabilities() : {};
    $('klight').hidden = !(caps && caps.torch); torch = false; $('klight').classList.remove('on');
    return vid.play().catch(function () {});
  }
  function openAll() {
    if (!window.isSecureContext) return Promise.reject({ name: 'Insecure', message: 'needs https' });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject({ name: 'Unsupported' });
    return gum({ video: vcons(), audio: ACONS }).catch(function (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
        return gum({ video: vcons(), audio: false }).then(function (s) { note('No microphone: takes will be silent'); return s; });
      }
      throw e;
    }).then(function (s) {
      var at = s.getAudioTracks()[0];
      if (at) { astream = new MediaStream([at]); atrack = at; setupAudio(); }
      return attach(new MediaStream(s.getVideoTracks()));
    });
  }
  function reopen() {
    if (vtrack) try { vtrack.stop(); } catch (e) {}
    return gum({ video: vcons(), audio: false }).then(attach).catch(function (e) { showGate(failText(e)); });
  }
  function keepAwake() {
    if (!('wakeLock' in navigator) || wake) return;
    navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }).catch(function () {});
  }

  // ---------- sound: meter + optional tape sound (WebAudio) ----------
  var actx = null, an = null, dest = null, lp = null, hissG = null, wowG = null, flutG = null, abuf = null, ok2 = false;
  function setupAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; actx = new AC();
      var src = actx.createMediaStreamSource(astream);
      lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
      var dl = actx.createDelay(0.05); dl.delayTime.value = 0.004;
      var wow = actx.createOscillator(); wow.frequency.value = 0.55; wowG = actx.createGain();
      var flut = actx.createOscillator(); flut.frequency.value = 9; flutG = actx.createGain();
      wow.connect(wowG); wowG.connect(dl.delayTime); flut.connect(flutG); flutG.connect(dl.delayTime); wow.start(); flut.start();
      var nb = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate), d = nb.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var ns = actx.createBufferSource(); ns.buffer = nb; ns.loop = true; hissG = actx.createGain(); ns.connect(hissG); ns.start();
      var mix = actx.createGain();
      src.connect(lp); lp.connect(dl); dl.connect(mix); hissG.connect(mix);
      an = actx.createAnalyser(); an.fftSize = 1024; abuf = new Float32Array(an.fftSize);
      mix.connect(an); dest = actx.createMediaStreamDestination(); an.connect(dest);
      var mute = actx.createGain(); mute.gain.value = 0; an.connect(mute); mute.connect(actx.destination); // keeps the graph pulled; silent
      tapeSound();
      if (actx.state !== 'running') actx.resume().catch(function () {});
      ok2 = true;
    } catch (e) { console.warn('VYDE audio', e); actx = null; }
  }
  function tapeSound() {
    if (!actx) return;
    var on = S.tapeSnd, t = actx.currentTime;
    lp.frequency.setValueAtTime(on ? 10000 : Math.min(20000, actx.sampleRate / 2 - 100), t);
    hissG.gain.setValueAtTime(on ? 0.012 : 0, t);
    wowG.gain.setValueAtTime(on ? 0.0012 : 0, t); flutG.gain.setValueAtTime(on ? 0.00012 : 0, t);
  }
  var held = -Infinity, heldT = 0, lvl = 0;
  function meter(now) {
    var db = -Infinity;
    if (an && S.sound) {
      an.getFloatTimeDomainData(abuf); var p = 0;
      for (var i = 0; i < abuf.length; i++) { var v = Math.abs(abuf[i]); if (v > p) p = v; }
      db = p > 0 ? 20 * Math.log(p) / Math.LN10 : -Infinity;
    }
    var target = isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
    lvl = target > lvl ? target : lvl + (target - lvl) * 0.18;
    if (db > held || now - heldT > 1500) { held = db; heldT = now; }
    var dash = (lvl * 100).toFixed(1) + ' 100';
    $('aL').setAttribute('stroke-dasharray', dash); $('aR').setAttribute('stroke-dasharray', dash);
    var hot = held >= -1;
    $('aL').classList.toggle('hot', hot); $('aR').classList.toggle('hot', hot);
    $('db').textContent = !S.sound ? 'SOUND OFF' : (isFinite(held) ? (held < 0 ? '−' : '') + Math.abs(held).toFixed(1) + ' dBFS' : '−∞ dBFS');
    $('sst').textContent = !S.sound || !an ? (an ? 'MUTED' : 'NO MIC') : held >= -0.1 ? 'CLIPPED' : held >= -1 ? 'PEAKING' : held >= -6 ? 'HOT' : held < -50 ? 'QUIET' : 'OK';
  }

  // ---------- recording ----------
  var rec = null, recording = false, recT0 = 0, chunks = [], vcap = null, mime = '', take = null, lastBase = '', sameMin = 0;
  var TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  function pickType() {
    if (!window.MediaRecorder) return null;
    if (!MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < TYPES.length; i++) if (MediaRecorder.isTypeSupported(TYPES[i])) return TYPES[i];
    return '';
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fname(d, ext) {
    // VYDE_2026-11-10_1432.mp4; a second take in the same minute gets -2, -3 …
    var b = 'VYDE_' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes());
    sameMin = (b === lastBase) ? sameMin + 1 : 1; lastBase = b;
    return (sameMin > 1 ? b + '-' + sameMin : b) + '.' + ext;
  }
  function recStart() {
    if (recording || !hasFrame) return;
    var t = pickType();
    if (t === null || !view.captureStream) { note('This browser can’t record video'); return; }
    vcap = view.captureStream(FPS);
    var tracks = [vcap.getVideoTracks()[0]];
    if (S.sound) {
      var at = (S.tapeSnd && dest) ? dest.stream.getAudioTracks()[0] : atrack;
      if (at && at.readyState === 'live') tracks.push(at);
    }
    if (actx && actx.state !== 'running') actx.resume().catch(function () {});
    var ms = new MediaStream(tracks), opts = { videoBitsPerSecond: 5000000, audioBitsPerSecond: 128000 };
    if (t) opts.mimeType = t;
    try { rec = new MediaRecorder(ms, opts); } catch (e) { try { rec = new MediaRecorder(ms); } catch (e2) { note('Recording could not start'); return; } }
    mime = rec.mimeType || t || 'video/webm';
    chunks = []; take = null;
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = finish;
    rec.onerror = function (e) { console.warn('VYDE rec', e); };
    recStartedAt = new Date();
    rec.start();
    recording = true; recT0 = performance.now(); frameAtRec = frameN;
    setRecUI();
  }
  var recStartedAt = null, frameAtRec = 0, recDur = 0;
  function recStop() {
    if (!recording) return;
    recording = false; recDur = (performance.now() - recT0) / 1000;
    try { rec.stop(); } catch (e) { finish(); }
    setRecUI();
  }
  function finish() {
    if (vcap) vcap.getTracks().forEach(function (t) { t.stop(); }); vcap = null;
    var type = (mime || 'video/webm').split(';')[0];
    var blob = new Blob(chunks, { type: type }); chunks = [];
    if (!blob.size) { note('The take came out empty. Try again.'); layout(); return; }
    var ext = /mp4/.test(type) ? 'mp4' : 'webm', name = fname(recStartedAt || new Date(), ext);
    take = { blob: blob, name: name, type: type, dur: recDur, w: W, h: H, saved: false, url: URL.createObjectURL(blob) };
    window.VYDE.lastTake = take;
    layout();
    openTake();
  }

  // ---------- UI ----------
  var noteT = 0;
  function note(t) { var n = $('note'); n.textContent = t; n.classList.add('show'); clearTimeout(noteT); noteT = setTimeout(function () { n.classList.remove('show'); }, 2200); }
  function tcText(sec) { var fr = Math.floor(sec * FPS), ff = fr % FPS, s = Math.floor(fr / FPS); return p2(Math.floor(s / 3600)) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60) + ':' + p2(ff); }
  function setRecUI() {
    $('tally').classList.toggle('rec', recording); $('tl').textContent = recording ? 'REC' : 'STBY';
    $('recb').classList.toggle('on', recording); $('recb').setAttribute('aria-label', recording ? 'Stop' : 'Record');
    $('kflip').disabled = recording;
    if (!recording) { $('tc').textContent = '00:00:00:00'; $('dot').classList.remove('dim'); }
  }
  function setUI() {
    $('tapev').textContent = S.tape;
    $('ktube').classList.toggle('on', S.tube); $('ktube').setAttribute('aria-pressed', S.tube ? 'true' : 'false');
    $('ttube').classList.toggle('on', S.tube); $('tsnd').classList.toggle('on', S.sound); $('ttape').classList.toggle('on', S.tapeSnd);
    $('ttape').disabled = !S.sound; $('ttape').style.opacity = S.sound ? 1 : 0.45;
    [].forEach.call($('tapekeys').children, function (b) { b.classList.toggle('on', b.dataset.v === S.tape); });
    [].forEach.call($('hudkeys').children, function (b) { b.classList.toggle('on', b.dataset.v === S.hud); });
    $('amt').value = Math.round(S.amt * 100); $('amtv').textContent = Math.round(S.amt * 100) + '%';
    $('mode').textContent = S.tape + ' · 30 · ' + (S.front ? 'FRONT' : 'REAR');
    body.classList.toggle('clean', S.hud === 'OFF');
    $('zoomv').textContent = zoom + '×';
  }
  function sheet(id, open) {
    var el = $(id); el.classList.toggle('open', open); el.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  function anyOpen() { return $('set').classList.contains('open') || $('take').classList.contains('open'); }

  $('recb').addEventListener('click', function () { if (take && !take.saved && $('take').classList.contains('open')) return; recording ? recStop() : recStart(); });
  $('kset').addEventListener('click', function () { sheet('set', true); });
  [].forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', function () { sheet('set', false); }); });
  $('ktube').addEventListener('click', function () { S.tube = !S.tube; store(); setUI(); note(S.tube ? 'Tube filter on' : 'Tube filter off'); });
  $('ttube').addEventListener('click', function () { S.tube = !S.tube; store(); setUI(); });
  $('tsnd').addEventListener('click', function () { if (recording) { note('Stop the take first'); return; } S.sound = !S.sound; store(); setUI(); });
  $('ttape').addEventListener('click', function () { if (recording) { note('Stop the take first'); return; } S.tapeSnd = !S.tapeSnd; store(); tapeSound(); setUI(); });
  $('ktape').addEventListener('click', function () { var o = ['SP', 'LP', 'EP']; S.tape = o[(o.indexOf(S.tape) + 1) % 3]; store(); setUI(); note(LOOKS[S.tape].note); });
  [].forEach.call($('tapekeys').children, function (b) { b.addEventListener('click', function () { S.tape = b.dataset.v; store(); setUI(); }); });
  [].forEach.call($('hudkeys').children, function (b) { b.addEventListener('click', function () { S.hud = b.dataset.v; store(); setUI(); }); });
  $('amt').addEventListener('input', function () { S.amt = (+this.value) / 100; setUI(); });
  $('amt').addEventListener('change', store);
  $('kzoom').addEventListener('click', function () { zoom = zoom === 1 ? 2 : 1; setUI(); });
  $('kflip').addEventListener('click', function () {
    if (recording) return; S.front = !S.front; store(); setUI(); $('kflip').disabled = true;
    reopen().then(function () { $('kflip').disabled = false; });
  });
  var torch = false;
  $('klight').addEventListener('click', function () {
    torch = !torch; var k = this;
    vtrack.applyConstraints({ advanced: [{ torch: torch }] }).then(function () { k.classList.toggle('on', torch); }).catch(function () { torch = false; note('The light is not available'); });
  });
  $('view').addEventListener('click', function () { if ($('set').classList.contains('open')) sheet('set', false); });

  // take sheet
  var discardArm = 0;
  function openTake() {
    discardArm = 0;
    var tv = $('tv'); tv.src = take.url; tv.load();
    info(take.dur);
    tv.onloadedmetadata = function () { if (take && isFinite(tv.duration) && tv.duration > 0) info(tv.duration); };
    var dl = $('dl'); dl.href = take.url; dl.download = take.name;
    $('save').textContent = 'SAVE TO PHONE'; $('save').disabled = false;
    sheet('set', false); sheet('take', true);
  }
  function info(dur) {
    var mb = take.blob.size / 1048576, t = Math.floor(dur), m = Math.floor(t / 60), s = t % 60;
    $('tinfo').textContent = m + ':' + p2(s) + ' · ' + mb.toFixed(1) + ' MB · ' + take.name.split('.').pop().toUpperCase() + ' · ' + take.w + '×' + take.h;
  }
  function closeTake() {
    var tv = $('tv'); try { tv.pause(); } catch (e) {} tv.removeAttribute('src'); tv.load();
    if (take) { var u = take.url; setTimeout(function () { URL.revokeObjectURL(u); }, 60000); }
    take = null; sheet('take', false);
  }
  function leaveTake() {
    if (take && !take.saved && Date.now() - discardArm > 3000) { discardArm = Date.now(); note('Not saved yet · tap again to discard'); return; }
    closeTake();
  }
  $('again').addEventListener('click', leaveTake);
  $('tclose').addEventListener('click', leaveTake);
  function saved() { take.saved = true; $('save').textContent = 'SAVED'; note('Saved'); }
  function download() {
    var a = document.createElement('a'); a.href = take.url; a.download = take.name; document.body.appendChild(a); a.click(); a.remove();
    take.saved = true; $('save').textContent = 'DOWNLOADED';
  }
  $('save').addEventListener('click', function () {
    if (!take) return;
    var file;
    try { file = new File([take.blob], take.name, { type: take.type }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).then(saved).catch(function (e) { if (!e || e.name !== 'AbortError') download(); });
    } else download();
  });
  $('dl').addEventListener('click', function () { if (take) take.saved = true; });

  // gate
  function showGate(msg) {
    $('gate').hidden = false; $('gmsg').textContent = msg || ''; $('go').disabled = false;
    $('go').textContent = msg ? 'TRY AGAIN' : 'START CAMERA';
  }
  $('go').addEventListener('click', function () {
    $('go').disabled = true; $('gmsg').textContent = '';
    if (!glOK) { showGate('This browser can’t draw the picture (WebGL is off).'); return; }
    var p = vstream && vtrack && vtrack.readyState === 'live' ? Promise.resolve() : (vstream ? reopen() : openAll());
    p.then(function () { if (!vtrack || vtrack.readyState !== 'live') return; $('gate').hidden = true; layout(); keepAwake(); if (actx) actx.resume().catch(function () {}); })
     .catch(function (e) { showGate(e && e.name === 'Insecure' ? 'Open this page over https.' : e && e.name === 'Unsupported' ? 'This browser can’t open the camera. On iPhone, open the link in Safari.' : failText(e)); });
  });

  // background: close the take cleanly (kept), the camera wakes on return
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (recording) recStop(); }
    else {
      if (actx) actx.resume().catch(function () {});
      if ($('gate').hidden && vtrack && vtrack.readyState !== 'live') reopen();
      if ($('gate').hidden) keepAwake();
    }
  });
  window.addEventListener('pagehide', function () { if (recording) recStop(); });

  // ---------- loop: a steady 30 fps clock ----------
  var last = 0, stats = { draws: 0, t0: 0 };
  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    if (now - last < FD - 4) return;
    last += FD; if (now - last > FD) last = now;
    if (draw()) stats.draws++;
    if (recording) {
      var sec = (performance.now() - recT0) / 1000, ff = Math.floor(sec * FPS) % FPS;
      $('tc').textContent = tcText(sec); $('dot').classList.toggle('dim', ff >= 15);
    }
    meter(now);
  }
  requestAnimationFrame(loop);

  setUI(); layout();
  window.VYDE = { version: VERSION, S: S, LOOKS: LOOKS, stats: stats, rec: function () { return recording; }, start: recStart, stop: recStop,
    lastTake: null, audio: function () { return actx ? actx.state : 'none'; }, mime: function () { return mime; }, pickType: pickType, set: function (o) { for (var k in o) S[k] = o[k]; setUI(); tapeSound(); } };
})();
