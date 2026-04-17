'use strict';

/* ── WLED FX ──────────────────────────────────────────────── */
const WLED_FX = [
  { id: 0,   name: 'Solid' },
  { id: 2,   name: 'Breathe' },
  { id: 3,   name: 'Wipe' },
  { id: 9,   name: 'Colorloop' },
  { id: 11,  name: 'Rainbow' },
  { id: 15,  name: 'Ripple' },
  { id: 25,  name: 'Chase' },
  { id: 28,  name: 'Comet' },
  { id: 45,  name: 'Twinkle' },
  { id: 49,  name: 'Dissolve' },
  { id: 64,  name: 'Plasmawave' },
  { id: 72,  name: 'Aurora' },
  { id: 76,  name: 'Running' },
  { id: 101, name: 'Pacifica' }
];

/* ── Settings ─────────────────────────────────────────────── */
const Settings = (() => {
  const defaults = { 
    startupMode: 'last', commMode: 'rest', mqttBroker: 'broker.hivemq.com', mqttPort: 8000, mqttTopic: 'wled/lumina/hauers2026',
    wledIp: 'http://10.36.19.212', location: 'Nabua, PH', weatherApiKey: '', 
    weatherInterval: 15, waterInterval: 60, waterDuration: 15,
    waterFx: 15, waterColor: '#0078ff', waterReturnFx: 0,
    hc35: '#df4b4b', hc28: '#da9228', hc22: '#24b65a', hc0: '#5d52f0',
    fx35: 0, fx28: 0, fx22: 0, fx0: 0
  };
  function load() {
    const s = { ...defaults };
    Object.keys(defaults).forEach(k => {
      const v = localStorage.getItem('lumina_' + k);
      if (v !== null) s[k] = (isNaN(v) || k.startsWith('hc')) ? v : Number(v);
    });
    return s;
  }
  function save(obj) { Object.entries(obj).forEach(([k, v]) => localStorage.setItem('lumina_' + k, v)); }
  return { load, save };
})();

/* ── Utilities: Log & Toast ───────────────────────────────── */
const Log = (() => {
  const f = () => document.getElementById('log-feed');
  const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false });
  function write(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `log-line ${type}`;
    el.innerHTML = `<span class="log-ts">${ts()}</span><span class="log-msg">${msg}</span>`;
    if (f()) { f().appendChild(el); f().scrollTop = f().scrollHeight; }
  }
  return { info: m=>write(m,'info'), ok: m=>write(m,'ok'), err: m=>write(m,'err'), warn: m=>write(m,'warn') };
})();

function showToast(msg) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('fade-out'); t.addEventListener('animationend', () => t.remove()); }, 2000);
}

/* ── WLED API & STATE ─────────────────────────────────────── */
const LampState = (() => {
  let cfg = { color: [99,88,255], fx: 0, bri: 100, on: false };
  function set(c, f, b, o) {
    if(c) cfg.color = c; 
    if(f!==undefined) cfg.fx = f; 
    if(b!==undefined) cfg.bri = b;
    if(o!==undefined) cfg.on = o;
  }
  function get() { return cfg; }
  return { set, get };
})();

const WledApi = (() => {
  let s = null;
  let mqttClient = null;
  let modeEpoch = 0;

  function getEpoch() {
    return modeEpoch;
  }

  function isRequestCurrent(expectedMode, expectedEpoch) {
    return !!s && expectedEpoch === modeEpoch && s.commMode === expectedMode;
  }

  function init(settings, options = {}) {
    s = settings;
    const initEpoch = ++modeEpoch;
    ConnStatus.setMode(s.commMode);
    const source = options.source || 'startup';
    if(mqttClient) { try { mqttClient.disconnect(); } catch(e){} mqttClient = null; }
    
    if (s.commMode === 'mqtt') {
      const clientId = 'LuminaWeb_' + Math.random().toString(16).substr(2, 8);
      mqttClient = new Paho.Client(s.mqttBroker, Number(s.mqttPort), clientId);
      
      mqttClient.onConnectionLost = (resp) => {
        if (!isRequestCurrent('mqtt', initEpoch)) return;
        if (resp.errorCode !== 0) Log.err('MQTT Lost: ' + resp.errorMessage);
        ConnStatus.set('err');
      };
      
      Log.info('Connecting to MQTT (' + s.mqttBroker + ')...');
      ConnStatus.set('connecting');
      mqttClient.connect({
        useSSL: s.mqttPort == 443 || s.mqttPort == 8883 || s.mqttPort == 8884 || s.mqttBroker.includes('wss://'),
        onSuccess: () => {
          if (!isRequestCurrent('mqtt', initEpoch)) return;
          Log.ok('Connected via MQTT.');
          ConnStatus.set('ok');
          if (source === 'startup') {
            JellyfishRenderer.speak('Auto-connected via MQTT.');
          } else if (source === 'manual-switch') {
            JellyfishRenderer.speak('Switched to MQTT. Connected!');
          }
        },
        onFailure: (e) => {
          if (!isRequestCurrent('mqtt', initEpoch)) return;
          Log.err('MQTT Failed: ' + e.errorMessage);
          ConnStatus.set('err');
          if (source === 'startup') {
            JellyfishRenderer.speak('MQTT auto-connect failed.');
          } else if (source === 'manual-switch') {
            JellyfishRenderer.speak('MQTT connection failed.');
          }
        }
      });
    } else {
      ping({ mode: 'rest', epoch: initEpoch }).then((ok) => {
        if (!isRequestCurrent('rest', initEpoch)) return;
        if (source === 'startup') {
          JellyfishRenderer.speak(ok ? 'Auto-connected via REST.' : 'REST auto-connect failed.');
        } else if (source === 'manual-switch') {
          JellyfishRenderer.speak(ok ? 'Switched to REST. Connected!' : 'Local node unreachable.');
        }
      });
    }
  }

  async function sendState(payload) {
    if (!s) return false;
    
    if (s.commMode === 'mqtt') {
      if (mqttClient && mqttClient.isConnected()) {
        try {
          const str = JSON.stringify(payload);
          const msg = new Paho.Message(str);
          msg.destinationName = s.mqttTopic.replace(/\/+$/, '') + '/api';
          mqttClient.send(msg);
          return true;
        } catch (e) {
          Log.err('MQTT TX Error: ' + e.message);
          return false;
        }
      } else {
        Log.warn('MQTT offline.');
        return false;
      }
    } else {
      try {
        let ip = s.wledIp.replace(/\/+$/, '');
        if (!ip.startsWith('http')) ip = 'http://' + ip;
        const res = await fetch(`${ip}/json/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(4000) });
        return res.ok;
      } catch { return false; }
    }
  }

  async function ping(options = {}) {
    if(!s) return false;
    const requestMode = options.mode || s.commMode;
    const requestEpoch = options.epoch !== undefined ? options.epoch : modeEpoch;

    if (isRequestCurrent(requestMode, requestEpoch)) ConnStatus.setMode(requestMode);

    if(requestMode === 'mqtt') {
      const ok = mqttClient && mqttClient.isConnected();
      if (isRequestCurrent(requestMode, requestEpoch)) ConnStatus.set(ok ? 'ok' : 'err');
      return ok;
    }
    try {
      if (isRequestCurrent(requestMode, requestEpoch)) ConnStatus.set('connecting');
      let ip = s.wledIp.replace(/\/+$/, '');
      if (!ip.startsWith('http')) ip = 'http://' + ip;
      const res = await fetch(`${ip}/json/state`, { signal: AbortSignal.timeout(3000) });
      if (isRequestCurrent(requestMode, requestEpoch)) ConnStatus.set(res.ok ? 'ok' : 'err');
      return res.ok;
    } catch { 
      if (isRequestCurrent(requestMode, requestEpoch)) ConnStatus.set('err');
      return false; 
    }
  }
  return { init, sendState, ping, getEpoch, isRequestCurrent };
})();

const ConnStatus = (() => {
  let activeMode = 'REST';

  function normalizeMode(mode) {
    return String(mode || '').toUpperCase() === 'MQTT' ? 'MQTT' : 'REST';
  }

  function setMode(mode) {
    if (mode) {
      activeMode = normalizeMode(mode);
      return;
    }

    const checkedMode = document.querySelector('input[name="comm-mode"]:checked')?.value;
    if (checkedMode) {
      activeMode = normalizeMode(checkedMode);
      return;
    }

    try {
      const s = Settings.load();
      if (s && s.commMode) activeMode = normalizeMode(s.commMode);
    } catch (e) {}
  }

  setMode();

  return {
    setMode,
    set: (status) => {
      const d = document.getElementById('lamp-status-dot');
      const t = document.getElementById('lamp-status-text');
      if (!d || !t) return;
      
      d.parentElement.className = `status-indicator ${status}`;

      setMode();
      const mode = activeMode;

      let stateStr = 'Connecting';
      if (status === 'ok') stateStr = 'Online';
      if (status === 'err') stateStr = 'Offline';
      if (status === 'warn') stateStr = 'Warning';
      
      if (mode === 'MQTT') {
        t.innerHTML = `<strong>MQTT:</strong> ${stateStr} <span style="opacity:0.4; margin-left:8px;">| REST: Inactive</span>`;
      } else {
        t.innerHTML = `<strong>REST:</strong> ${stateStr} <span style="opacity:0.4; margin-left:8px;">| MQTT: Inactive</span>`;
      }
    }
  };
})();

/* ── Character Renderer ───────────────────────────────────── */
const JellyfishRenderer = (() => {
  const canvas = document.getElementById('jelly-canvas');
  const ctx = canvas.getContext('2d');
  let w, h, t = 0;
  
  // Character active state
  let msgObj = { text: '', alpha: 0, timer: 0 };
  let blinkTimer = Math.random() * 200;
  let targetCyPct = 0.35; 
  let currentCyPct = 0.35; 

  let fabricPattern = null;
  function getFabricPattern() {
    if (fabricPattern) return fabricPattern;
    const patCanvas = document.createElement('canvas');
    patCanvas.width = 128;
    patCanvas.height = 128;
    const pctx = patCanvas.getContext('2d');
    
    const imgData = pctx.createImageData(128, 128);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      // Noise pattern
      const val = Math.random() > 0.5 ? 255 : 180;
      data[i] = val;
      data[i+1] = val;
      data[i+2] = val;
      data[i+3] = 100 + Math.random() * 80; // MUCH more opaque noise.
    }
    pctx.putImageData(imgData, 0, 0);
    fabricPattern = ctx.createPattern(patCanvas, 'repeat');
    return fabricPattern;
  }

  // Eye Tracking
  let mouseX = 0, mouseY = 0;
  let targetEyeOffsetX = 0;
  let targetEyeOffsetY = 0;
  let eyeOffsetX = 0;
  let eyeOffsetY = 0;
  let hasMouse = false;

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    hasMouse = true;
  });
  canvas.addEventListener('mouseleave', () => { hasMouse = false; });

  let isDrinking = false;
  function setDrinking(val) { isDrinking = val; }

  function speak(text, duration = 4000) {
    msgObj.text = text;
    msgObj.alpha = 1.0;
    msgObj.timer = duration / 16; 
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.fill();
    ctx.stroke();
  }

  // Wraps text into an array of lines
  function getWrappedLines(text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + " " + word).width;
      if (width < maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    return lines;
  }

  class LEDCompanion {
    constructor() { this.numTentacles = 7; this.segmentsPerTentacle = 25; }

    draw() {
      const { color, fx, bri, on } = LampState.get();
      const s = Math.min(w, h) / 500;
      const cx = w * 0.5;
      
      const dimAlpha = on ? 1.0 : 0.6;
      ctx.globalAlpha = dimAlpha;

      targetCyPct = on ? 0.45 : 0.65;
      currentCyPct += (targetCyPct - currentCyPct) * 0.05;

      const baseAmplitude = on ? 15 : 4; 
      const bob = Math.sin(t * (on ? 0.8 : 0.4)) * baseAmplitude * s;
      const cy = (h * currentCyPct) + bob;

      // Eye tracking calculations
      if (hasMouse && on) {
        const dx = mouseX - cx;
        const dy = mouseY - cy;
        // Limit max eye tracking offset
        targetEyeOffsetX = Math.max(-15 * s, Math.min(15 * s, dx * 0.05));
        targetEyeOffsetY = Math.max(-10 * s, Math.min(10 * s, dy * 0.05));
      } else {
        targetEyeOffsetX = 0;
        targetEyeOffsetY = 0;
      }

      // Smooth eye interpolation
      eyeOffsetX += (targetEyeOffsetX - eyeOffsetX) * 0.1;
      eyeOffsetY += (targetEyeOffsetY - eyeOffsetY) * 0.1;

      let r = Array.isArray(color) ? color[0] : 99;
      let g = Array.isArray(color) ? color[1] : 88;
      let b = Array.isArray(color) ? color[2] : 255;
      
      // Override primary colors for dynamic effects
      if (on) {
         if (fx === 9 || fx === 11) { // Rainbow / Colorloop Bell
            const hue = (t * 20) % 360;
            const C = 255;
            const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
            if(hue < 60) { r=C; g=X; b=0; }
            else if(hue < 120) { r=X; g=C; b=0; }
            else if(hue < 180) { r=0; g=C; b=X; }
            else if(hue < 240) { r=0; g=X; b=C; }
            else if(hue < 300) { r=X; g=0; b=C; }
            else { r=C; g=0; b=X; }
         } else if (fx === 101) { // Pacifica Bell
            const pct = (Math.sin(t*0.5) + 1) / 2;
            r = Math.round(62*(1-pct) + 0*pct);
            g = Math.round(229*(1-pct) + 130*pct);
            b = Math.round(153*(1-pct) + 200*pct);
         } else if (fx === 64) { // Plasmawave Bell
            const val = (Math.sin(t*0.8) + 1)/2;
            r = Math.round(255*val);
            g = 0;
            b = Math.round(255*(1-val));
         } else if (fx === 72) { // Aurora Bell
            const hue = 120 + ((Math.sin(t*0.3) + 1)/2) * 160; 
            const C = 255;
            const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
            if(hue < 180) { r=0; g=C; b=X; }
            else if(hue < 240) { r=0; g=X; b=C; }
            else if(hue < 300) { r=X; g=0; b=C; }
            else { r=C; g=0; b=X; }
         }
      }
      
      const baseBri = on ? bri : bri * 0.15;
      const brightnessFactor = (baseBri !== undefined ? baseBri : 100) / 255;
      
      let effectMultiplier = 1.0;
      let chaseOffset = -1;

      if (on) {
        if (fx === 2 || fx === 15) { 
          effectMultiplier = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.5));
        } else if (fx === 25 || fx === 28 || fx === 76 || fx === 3) {
          chaseOffset = (t * 18) % this.segmentsPerTentacle; 
        }
      } else {
        effectMultiplier = 0.6 + 0.4 * Math.sin(t * 0.6);
      }

      const alpha = 0.9 * effectMultiplier * brightnessFactor;

      const bellW = 85 * s;
      const bellH = 80 * s;
      const tentacleLength = 220 * s;

      ctx.save();
      ctx.translate(cx, cy);

      // --- Ambient Background Glow ---
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, bellW * (on ? 3.5 : 1.5));
      glow.addColorStop(0, `rgba(${r},${g},${b},${0.6 * alpha})`);
      glow.addColorStop(0.3, `rgba(${r},${g},${b},${0.2 * alpha})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(0, 5*s, bellW * 4.0, bellH * 5.0, 0, 0, Math.PI * 2);
      ctx.fill();

      // --- Unlighted Spiral & Cloth Tentacles ---
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1. Cloth tentacles (Flowing linen cloth with aquamarine hint & light purple border)
      const numClothTentacles = 4;
      for (let i = 0; i < numClothTentacles; i++) {
        const pct = i / (numClothTentacles - 1 || 1);
        const startX = (pct - 0.5) * bellW * 1.2;
        const phase = t * 1.2 + i * 2.0;

        ctx.beginPath();
        ctx.moveTo(startX, 0);
        
        let leftEdge = [];
        let rightEdge = [];
        // Add slight unique length variation per tentacle
        const thisLength = tentacleLength * (0.85 + 0.15 * Math.sin(i * 4.3));
        const widthBaseline = 8 * s;

        // Calculate path for cloth edges
        for (let j = 0; j <= 20; j++) {
            const depthPct = j / 20;
            const y = depthPct * thisLength;
            
            // Complex wave for flowing fabric look
            const waveX = Math.sin(phase - depthPct * Math.PI * 3) * 30 * depthPct * s;
            const waveWidth = (Math.sin(phase * 2 - depthPct * 10) * 0.5 + 1.0) * widthBaseline;
            
            const sway = on ? eyeOffsetX * depthPct * 1.5 : 0;
            const cx = startX + waveX + sway;

            leftEdge.push({x: cx - waveWidth, y: y});
            rightEdge.push({x: cx + waveWidth, y: y});
        }

        for(let j = 0; j < leftEdge.length; j++) ctx.lineTo(leftEdge[j].x, leftEdge[j].y);
        for(let j = rightEdge.length - 1; j >= 0; j--) ctx.lineTo(rightEdge[j].x, rightEdge[j].y);
        ctx.closePath();

        ctx.fillStyle = 'rgba(127, 255, 212, 0.4)'; // Transparent aquamarine hint
        ctx.fill();
        ctx.lineWidth = 2 * s;
        ctx.strokeStyle = 'rgba(216, 191, 216, 0.9)'; // Light purple border
        ctx.stroke();

        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = getFabricPattern();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      // 2. Spiral/Curly unlighted tentacles (Purple and light purple)
      const numCurlyTentacles = 8;
      for (let i = 0; i < numCurlyTentacles; i++) {
        const pct = i / (numCurlyTentacles - 1);
        const startX = (pct - 0.5) * bellW * 1.5;
        const phase = t * 0.8 + i * 1.5;
        const curlTightness = 8 + (i % 3) * 4; 
        const isLightPurple = i % 2 === 0;

        ctx.beginPath();
        ctx.moveTo(startX, 0);
        
        // Add slight unique length variation per tentacle
        const thisLength = tentacleLength * (0.85 + 0.15 * Math.sin(i * 5.7));

        for (let j = 0; j <= 40; j++) {
            const depthPct = j / 40;
            const y = depthPct * thisLength;
            
            // Tight spiral curling combined with gentle sway
            const spiralX = Math.sin(depthPct * Math.PI * curlTightness + phase) * 12 * s * (1 - depthPct*0.5);
            const swayX = Math.sin(t - depthPct * 2) * 15 * depthPct * s;
            const mouseSway = on ? eyeOffsetX * depthPct * 2.0 : 0;
            
            ctx.lineTo(startX + spiralX + swayX + mouseSway, y);
        }

        ctx.lineWidth = 3 * s;
        ctx.strokeStyle = isLightPurple ? 'rgba(216, 191, 216, 0.85)' : 'rgba(122, 97, 232, 0.85)'; // #7A61E8
        ctx.stroke();

        ctx.globalCompositeOperation = 'overlay';
        ctx.strokeStyle = getFabricPattern();
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }

      // --- Thick LED Tentacles ---
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < this.numTentacles; i++) {
        const pct = i / (this.numTentacles - 1); 
        const thRoot = (pct - 0.5) * bellW * 1.5;
        
        const phase = t * (on ? 1.2 : 0.3) + i * 0.8;
        const swimOffset = Math.sin(t * (on ? 1.0 : 0.5)) * (on ? 15 : 5) * s;

        let pX = thRoot;
        let pY = 0;
        const isCupArm = (i === 0);
        
        // Add slight unique length variation per tentacle
        const thisLength = tentacleLength * (0.85 + 0.15 * Math.sin(i * 8.1));

        for (let j = 0; j <= this.segmentsPerTentacle; j++) {
          const depthPct = j / this.segmentsPerTentacle; 
          
          let waveX = Math.sin(phase - depthPct * Math.PI * 2) * 22 * depthPct * s;
          
          // Apply some mouse sway to tentacles if aware
          if (on) {
             const swayFactor = Math.min(1.0, depthPct * 2.0); 
             // Fix stiffness: use the globally smoothed eyeOffsetX instead of the raw immediate mouse target
             waveX += eyeOffsetX * swayFactor * 1.5;
          }

          let currentX = thRoot + waveX + (swimOffset * depthPct);
          let currentY = depthPct * thisLength;

          if (isDrinking && isCupArm && on) {
             const cupBob = Math.sin(t * 3) * 6 * s;
             const cupTargetX = -bellW * 1.8;
             const cupTargetY = bellH * 1.2;
             
             // Smooth bezier curve for a pronounced V-shape hanging elbow bend
             const cpX = -bellW * 1.2; 
             const cpY = bellH * 3.5;
             
             const pct = depthPct;
             const invPct = 1 - pct;
             let baseX = (invPct * invPct * thRoot) + (2 * invPct * pct * cpX) + (pct * pct * cupTargetX);
             let baseY = (invPct * invPct * 0)      + (2 * invPct * pct * cpY) + (pct * pct * (cupTargetY + cupBob));
             
             // Wiggle the arm organically while holding the cup
             const wiggleMask = Math.sin(depthPct * Math.PI);
             const armWiggleX = Math.sin(t * 4 - depthPct * 5) * 15 * s * wiggleMask;
             const armWiggleY = Math.cos(t * 4 - depthPct * 5) * 10 * s * wiggleMask;

             currentX = baseX + armWiggleX;
             currentY = baseY + armWiggleY;
          }

          let ledAlpha = Math.min(1.0, alpha * 1.5);
          let ledSize = 4 * s; 

          if (on && chaseOffset >= 0) {
            let distance = j - chaseOffset;
            if (distance < 0) distance += this.segmentsPerTentacle; 
            if (distance < 2) { 
              ledAlpha = 1.0 * brightnessFactor;
              ledSize = 6 * s;
            } else if (distance < 10) { 
              ledAlpha = Math.max(0, (1.0 - (distance / 10))) * 1.0 * brightnessFactor;
            } else { 
              ledAlpha = 0.15 * brightnessFactor;
            }
          } else {
             ledAlpha = Math.min(1.0, alpha * (1 - depthPct * (on ? 0.4 : 0.8)) * 1.5);
          }

          let drawR = r, drawG = g, drawB = b;
          if (on) {
             if (fx === 9 || fx === 11) { // Colorloop / Rainbow
                const hue = (t * 50 + j * 5 + i * 15) % 360;
                const C = 255;
                const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
                if(hue < 60) { drawR=C; drawG=X; drawB=0; }
                else if(hue < 120) { drawR=X; drawG=C; drawB=0; }
                else if(hue < 180) { drawR=0; drawG=C; drawB=X; }
                else if(hue < 240) { drawR=0; drawG=X; drawB=C; }
                else if(hue < 300) { drawR=X; drawG=0; drawB=C; }
                else { drawR=C; drawG=0; drawB=X; }
             } else if (fx === 101) { // Pacifica
                const pctP = (Math.sin(t*1.5 - depthPct*3 + i) + 1) / 2; // 0 to 1
                drawR = Math.round(62*(1-pctP) + 0*pctP);
                drawG = Math.round(229*(1-pctP) + 130*pctP);
                drawB = Math.round(153*(1-pctP) + 200*pctP);
             } else if (fx === 64) { // Plasmawave
                const val = (Math.sin(t*2 - depthPct*5 + i*2) + 1)/2;
                drawR = Math.round(255*val);
                drawG = 0;
                drawB = Math.round(255*(1-val));
             } else if (fx === 72) { // Aurora
                const hue = 120 + ((Math.sin(t + depthPct*2) + 1)/2) * 160; 
                const C = 255;
                const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
                if(hue < 180) { drawR=0; drawG=C; drawB=X; }
                else if(hue < 240) { drawR=0; drawG=X; drawB=C; }
                else if(hue < 300) { drawR=X; drawG=0; drawB=C; }
                else { drawR=C; drawG=0; drawB=X; }
             } else if (fx === 45 || fx === 49) { // Twinkle / Dissolve
                const rnd = Math.sin(j * 4321 + i * 123 + (t * (fx===45?2:8))); 
                if (rnd > 0.95) {
                   drawR = 255; drawG = 255; drawB = 255;
                   ledAlpha = 1.0 * brightnessFactor;
                   ledSize = 5 * s;
                }
             } else if (fx === 3) { // Wipe
                const wipeT = (t * 2) % 2; 
                if (depthPct > wipeT) ledAlpha = 0;
             } else if (fx === 15) { // Ripple
                const rip = Math.sin(depthPct * 20 - t * 10);
                if (rip > 0.8) {
                    drawR = Math.min(255, drawR + 100);
                    drawG = Math.min(255, drawG + 100);
                    drawB = Math.min(255, drawB + 100);
                    ledSize = 5 * s;
                }
             }
          }

          if (j > 0) {
            ctx.beginPath();
            ctx.moveTo(pX, pY);
            ctx.lineTo(currentX, currentY);
            ctx.lineWidth = ledSize;
            ctx.strokeStyle = `rgba(${drawR},${drawG},${drawB},${ledAlpha})`;
            if (ledAlpha > 0.3) {
               ctx.shadowBlur = 14 * s;
               ctx.shadowColor = `rgba(${drawR},${drawG},${drawB},1)`;
            } else {
               ctx.shadowBlur = 0;
            }
            ctx.stroke();

            ctx.lineWidth = ledSize * 0.35;
            ctx.strokeStyle = `rgba(255,255,255,${ledAlpha * 0.9})`;
            ctx.shadowBlur = 0; 
            ctx.stroke();
          }

          pX = currentX;
          pY = currentY;
        }
      }

      // --- The Engineered Head (Lamp Glow & Flowing Edges) ---
      ctx.shadowBlur = 0;

      // Pastel stripe colors matching reference jellyfish lamp
      const pastelStripes = [
          'rgba(180, 150, 255, 0.9)',  // Lighter purple
          'rgba(200, 180, 255, 0.9)',  // Pastel lavender
          'rgba(50, 100, 210, 0.9)',   // Darker blue
          'rgba(180, 230, 255, 0.9)',  // Pastel cyan
          'rgba(220, 190, 255, 0.9)',  // Pastel violet
          'rgba(160, 210, 255, 0.9)',  // Pastel sky
      ];
      
      ctx.save();
      // Define dome path for clipping — slightly taller dome
      ctx.beginPath();
      ctx.moveTo(-bellW * 1.1, -bellH * 0.1);
      ctx.quadraticCurveTo(-bellW * 0.95, -bellH * 1.15, 0, -bellH * 1.2);
      ctx.quadraticCurveTo(bellW * 0.95, -bellH * 1.15, bellW * 1.1, -bellH * 0.1);
      ctx.ellipse(0, -bellH * 0.1, bellW * 1.1, bellH * 0.35, 0, 0, Math.PI, false);
      
      // Dome inner glow
      ctx.shadowBlur = on ? 35 * s : 5 * s;
      ctx.shadowColor = on ? `rgba(${r},${g},${b},0.6)` : 'rgba(200,180,255,0.05)';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.clip();

      // Contiguous wedges following the dome's vertical curve
      const numStripes = 44;
      for (let i = 0; i < numStripes; i++) {
          const angle1 = (i / numStripes) * Math.PI;
          const angle2 = ((i + 1) / numStripes) * Math.PI;
          const cosA1 = Math.cos(angle1);
          const cosA2 = Math.cos(angle2);
          
          ctx.beginPath();
          const steps = 20;
          for (let j = 0; j <= steps; j++) {
              const tPct = j / steps;
              const lat = tPct * (Math.PI / 2);
              const sinLat = Math.sin(lat);
              const cosLat = Math.cos(lat);
              
              const base_py = -bellH * 0.1 + Math.sin(angle1) * bellH * 0.35;
              const px = Math.cos(angle1) * bellW * 1.1 * sinLat;
              const py = -bellH * 1.2 + (bellH * 1.2 + base_py) * (1 - cosLat);
              
              if (j === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
          }
          for (let j = steps; j >= 0; j--) {
              const tPct = j / steps;
              const lat = tPct * (Math.PI / 2);
              const sinLat = Math.sin(lat);
              const cosLat = Math.cos(lat);
              
              const base_py = -bellH * 0.1 + Math.sin(angle2) * bellH * 0.35;
              const px = Math.cos(angle2) * bellW * 1.1 * sinLat;
              const py = -bellH * 1.2 + (bellH * 1.2 + base_py) * (1 - cosLat);
              ctx.lineTo(px, py);
          }
          ctx.closePath();
          
          const stripeColor = pastelStripes[i % pastelStripes.length];
          ctx.fillStyle = stripeColor;
          ctx.fill();
          
          ctx.lineWidth = 1.0 * s;
          ctx.strokeStyle = stripeColor;
          ctx.shadowBlur = 0;
          ctx.stroke();
      }

      // Fabric pattern overlay for the entire head dome
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = getFabricPattern();
      ctx.fillRect(-bellW * 1.5, -bellH * 1.5, bellW * 3, bellH * 2.5);
      ctx.globalCompositeOperation = 'source-over';

      ctx.restore(); // Remove clip

      // Re-draw dome outline glow (outer glow ring)
      if (on) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-bellW * 1.1, -bellH * 0.1);
        ctx.quadraticCurveTo(-bellW * 0.95, -bellH * 1.15, 0, -bellH * 1.2);
        ctx.quadraticCurveTo(bellW * 0.95, -bellH * 1.15, bellW * 1.1, -bellH * 0.1);
        ctx.lineWidth = 2 * s;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
        ctx.shadowBlur = 20 * s;
        ctx.shadowColor = `rgba(${r},${g},${b},0.5)`;
        ctx.stroke();
        ctx.restore();
      }

      // 2. Wider frill-fold edge inspired by layered fabric ripples
      const rimBaseY = -bellH * 0.028; // Pull attachment closer so frills hug the dome
      const rimWidth = bellW * 1.24;
      const curveResolution = 220;

      // Hidden backing frill to seal occasional animation gaps between moving layers
      ctx.beginPath();
      for (let i = 0; i <= curveResolution; i++) {
        const progress = i / curveResolution;
        const angle = Math.PI * (1 - progress);
        const edgeTaper = Math.pow(Math.sin(progress * Math.PI), 0.5);

        const baseX = Math.cos(angle) * rimWidth * 1.02;
        const baseY = rimBaseY + Math.sin(angle) * (bellH * 0.34) + 2.8 * s;
        const baseWave = Math.sin(progress * Math.PI * 9 + t * 0.17) * 2.0 * s;
        const sideWave = Math.cos(progress * Math.PI * 10 + t * 0.2) * 1.8 * s * edgeTaper;

        const px = baseX + sideWave;
        const py = baseY - Math.abs(baseWave) * 0.85;

        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (let i = curveResolution; i >= 0; i--) {
        const progress = i / curveResolution;
        const angle = Math.PI * (1 - progress);
        const bx = Math.cos(angle) * bellW * 1.05;
        const sideHugLift = Math.pow(Math.abs(Math.cos(angle)), 1.8) * 4.8 * s;
        const by = rimBaseY + Math.sin(angle) * (bellH * 0.33) - 4.8 * s - sideHugLift;
        ctx.lineTo(bx, by);
      }
      ctx.closePath();
      const underGrad = ctx.createLinearGradient(0, rimBaseY - 8 * s, 0, rimBaseY + 52 * s);
      underGrad.addColorStop(0, 'rgba(210, 188, 255, 0.34)');
      underGrad.addColorStop(1, 'rgba(92, 220, 236, 0.26)');
      ctx.fillStyle = underGrad;
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = getFabricPattern();
      ctx.fill();
      ctx.restore();

      // Loop 4 times (3 down to 0) to add broad overlapping fold layers
      for (let layer = 3; layer >= 0; layer--) {
        const isBackLayer = layer === 3;

        const currentLobes = isBackLayer ? 12 : 10; // Fewer lobes = wider frill folds
        const layerDrop = isBackLayer ? 6.2 * s : layer * 2.8 * s;
        const lobeSize = isBackLayer ? 27 * s : (18.8 + layer * 5.8) * s;
        const phaseOffset = t * (0.18 + layer * 0.02);
        const flutterBase = isBackLayer ? (t * -0.28 + 2.1) : (t * -0.4 + layer * 0.55);

        ctx.beginPath();
        for (let i = 0; i <= curveResolution; i++) {
          const progress = i / curveResolution;
          const angle = Math.PI * (1 - progress);

          const baseX = Math.cos(angle) * rimWidth;
          const baseY = rimBaseY + Math.sin(angle) * (bellH * 0.35) + layerDrop;

          // Fixed static folds
          const lobeAngle = progress * Math.PI * currentLobes + phaseOffset;

          // Natural flutter in place
          const flutterTime = flutterBase;

          // Broad frill folds that fan sideways and droop like cloth ruffles
          const ruffleFoldX = (Math.cos(lobeAngle) * 0.54) + Math.cos(lobeAngle + flutterTime) * 0.78;
          const ruffleFoldY = (Math.sin(lobeAngle) * 0.16) - Math.abs(Math.sin(lobeAngle - flutterTime)) * 0.66;

          // Taper to zero at ends
          const edgeTaper = Math.pow(Math.sin(progress * Math.PI), 0.5);

          const px = baseX + ruffleFoldX * lobeSize * edgeTaper;
          const py = baseY + ruffleFoldY * lobeSize * 0.76 * edgeTaper;

          if (i === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }

        // Securely attach back tightly into the head to flush the sides natively
        for (let i = curveResolution; i >= 0; i--) {
          const progress = i / curveResolution;
          const angle = Math.PI * (1 - progress);
          const attachWidth = bellW * (isBackLayer ? 1.05 : 1.09);
          const bx = Math.cos(angle) * attachWidth;
          const sideHugLift = Math.pow(Math.abs(Math.cos(angle)), 1.7) * (isBackLayer ? 3.8 : 5.1) * s;
          const attachLift = isBackLayer ? -2.2 * s : -4.9 * s;
          const by = rimBaseY + Math.sin(angle) * (bellH * 0.34) + attachLift - sideHugLift;
          ctx.lineTo(bx, by);
        }
        ctx.closePath();

        // Aquamarine soft fabric gradient with pastel-lavender edge tint
        const ruffleGrad = ctx.createLinearGradient(0, rimBaseY - 10 * s, 0, rimBaseY + lobeSize * 2.0);
        const layerAlpha = 0.52 + layer * 0.13;
        ruffleGrad.addColorStop(0, `rgba(214, 190, 255, ${layerAlpha * 0.72})`);
        ruffleGrad.addColorStop(0.42, `rgba(120, 242, 224, ${layerAlpha * 0.82})`);
        ruffleGrad.addColorStop(1, `rgba(82, 212, 238, ${layerAlpha * 0.48})`);

        ctx.fillStyle = ruffleGrad;
        ctx.fill();

        // Animated shimmer pass across the aquamarine fold body
        ctx.save();
        const shimmerShift = Math.sin(t * 0.75 + layer * 0.8) * rimWidth * 0.45;
        const shimmerGrad = ctx.createLinearGradient(-rimWidth + shimmerShift, rimBaseY - 4 * s, rimWidth + shimmerShift, rimBaseY + lobeSize * 1.6);
        shimmerGrad.addColorStop(0, `rgba(255, 255, 255, ${0.02 + layer * 0.01})`);
        shimmerGrad.addColorStop(0.48, `rgba(190, 255, 246, ${0.14 + layer * 0.03})`);
        shimmerGrad.addColorStop(1, `rgba(255, 255, 255, ${0.015 + layer * 0.01})`);
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = shimmerGrad;
        ctx.fill();
        ctx.restore();

        // Linen-like texture overlaid softly for fuzzy cloth feel
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = 0.2 + layer * 0.03;
        ctx.fillStyle = getFabricPattern();
        ctx.fill();
        ctx.restore();

        // Fuzzy halo around border to mimic soft fabric edge
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = (3.4 + layer * 0.8) * s;
        ctx.strokeStyle = `rgba(228, 212, 255, ${0.16 + layer * 0.03})`;
        ctx.shadowBlur = (7 + layer * 2.5) * s;
        ctx.shadowColor = 'rgba(208, 190, 255, 0.28)';
        ctx.stroke();
        ctx.restore();

        // Pastel-purple frill border line
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = (1.3 + layer * 0.42) * s;
        ctx.strokeStyle = `rgba(212, 166, 255, ${0.84 + layer * 0.14})`;
        ctx.stroke();

        // Extra overlapping contour line to mimic frill-fold line layering
        ctx.beginPath();
        for (let i = 0; i <= curveResolution; i++) {
          const progress = i / curveResolution;
          const angle = Math.PI * (1 - progress);

          const baseX = Math.cos(angle) * rimWidth;
          const baseY = rimBaseY + Math.sin(angle) * (bellH * 0.35) + layerDrop;

          const contourAngle = progress * Math.PI * (currentLobes + 1.75) + phaseOffset * 1.4 + layer * 0.8;
          const contourFlutter = flutterBase * 1.08 + layer * 0.28;
          const edgeTaper = Math.pow(Math.sin(progress * Math.PI), 0.5);

          const contourX = ((Math.cos(contourAngle) * 0.24) + Math.cos(contourAngle + contourFlutter) * 0.34) * lobeSize * edgeTaper;
          const contourY = ((Math.sin(contourAngle) * 0.09) - Math.abs(Math.sin(contourAngle - contourFlutter)) * 0.28) * lobeSize * edgeTaper;

          const cx = baseX + contourX;
          const cy = baseY + contourY + (1.8 + layer * 0.75) * s;

          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = (0.9 + layer * 0.3) * s;
        ctx.strokeStyle = `rgba(224, 190, 255, ${0.48 + layer * 0.1})`;
        ctx.stroke();
      }

      // 3. Central Specular Highlight on the dome
      ctx.beginPath();
      ctx.ellipse(0, -bellH * 0.95, bellW * 0.45, bellH * 0.15, 0, Math.PI, 0);
      const specLamp = ctx.createLinearGradient(0, -bellH * 1.1, 0, -bellH * 0.75);
      specLamp.addColorStop(0, `rgba(255, 255, 255, ${0.7 * alpha})`);
      specLamp.addColorStop(1, `rgba(255, 255, 255, 0)`);
      ctx.fillStyle = specLamp;
      ctx.fill();

      // --- Drawn Cup for Hydration ---
      if (isDrinking && on) {
         const cupBob = Math.sin(t * 3) * 6 * s;
         const cupX = -bellW * 1.8;
         const cupY = bellH * 1.2 + cupBob;
         
         const sloshY = Math.sin(t * 5) * 3 * s;
         
         // Cup background (water)
         ctx.fillStyle = 'rgba(0, 150, 255, 0.6)';
         ctx.beginPath();
         ctx.moveTo(cupX - 8*s, cupY - 2*s + sloshY);
         ctx.lineTo(cupX + 8*s, cupY - 2*s - sloshY);
         ctx.lineTo(cupX + 7*s, cupY + 14*s);
         ctx.lineTo(cupX - 7*s, cupY + 14*s);
         ctx.fill();

         // Cup Glass Rim/Reflections
         ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
         ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
         ctx.lineWidth = 1.5 * s;
         ctx.beginPath();
         ctx.moveTo(cupX - 12*s, cupY - 18*s);
         ctx.lineTo(cupX + 12*s, cupY - 18*s);
         ctx.lineTo(cupX + 8*s, cupY + 15*s);
         ctx.lineTo(cupX - 8*s, cupY + 15*s);
         ctx.closePath();
         ctx.fill();
         ctx.stroke();

         // Straw
         ctx.strokeStyle = '#5d52f0';
         ctx.lineWidth = 3.5 * s;
         ctx.lineCap = 'round';
         ctx.beginPath();
         ctx.moveTo(cupX - 3*s, cupY + 10*s);
         ctx.lineTo(cupX + 15*s, cupY - 25*s);
         ctx.stroke();

         // Animated Sip Bubbles
         ctx.fillStyle = 'rgba(255,255,255,0.8)';
         for(let b=0; b<3; b++) {
            let bubY = (t * 20 + b * 20) % 40;
            let bubAlpha = 1.0 - (bubY / 40);
            if (bubY > 0) {
               ctx.globalAlpha = bubAlpha;
               ctx.beginPath();
               ctx.arc(cupX + 15*s - (bubY * 0.3)*s, cupY - 25*s - bubY*s, 2*s, 0, Math.PI*2);
               ctx.fill();
            }
         }
         ctx.globalAlpha = dimAlpha;
      }

      // --- The Eyes ---
      blinkTimer--;
      let isBlinking = blinkTimer < 0 && blinkTimer > -8;
      if (blinkTimer < -8) blinkTimer = 100 + Math.random() * 200;

      // Glow logic for eyes
      const eyeR = Array.isArray(color) ? Math.min(255, r + 150) : 255;
      const eyeG = Array.isArray(color) ? Math.min(255, g + 150) : 255;
      const eyeB = Array.isArray(color) ? Math.min(255, b + 150) : 255;

      ctx.fillStyle = 'rgba(40, 30, 60, 0.95)';
      ctx.strokeStyle = 'rgba(40, 30, 60, 0.95)';
      ctx.lineWidth = 6 * s;
      ctx.lineCap = 'round';
      
      if (on) {
         ctx.shadowBlur = on ? 12 * s : 4 * s;
         ctx.shadowColor = 'rgba(255,255,255,0.85)'; // Stronger white core for maximum shine
      }

      // Eye dimensions and positions
      const eyeSpacing = bellW * 0.35;
      const eyeDrawXLeft = -eyeSpacing + eyeOffsetX;
      const eyeDrawXRight = eyeSpacing + eyeOffsetX;
      const eyeDrawY = -bellH * 0.35 + eyeOffsetY;

      if (!on) {
        // Sleepy eyes (horizontal slits closing down instead of upward curves)
        ctx.beginPath();
        ctx.moveTo(eyeDrawXLeft - 5*s, eyeDrawY);
        ctx.lineTo(eyeDrawXLeft + 5*s, eyeDrawY);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(eyeDrawXRight - 5*s, eyeDrawY);
        ctx.lineTo(eyeDrawXRight + 5*s, eyeDrawY);
        ctx.stroke();

        // Little Zzz
        ctx.shadowBlur = 0;
        ctx.font = `bold ${14 * s}px Inter`;
        ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(t*2)})`;
        ctx.fillText("z", bellW * 0.8, -bellH * 0.3 - (Math.sin(t*1.5)*5*s));
        ctx.fillText("Z", bellW * 1.1, -bellH * 0.3 - 15*s - (Math.sin(t*1.5)*10*s));
        ctx.fillText("z", bellW * 1.4, -bellH * 0.3 - 25*s - (Math.sin(t*1.5)*6*s));
        ctx.fillText("Z", bellW * 1.8, -bellH * 0.3 - 40*s - (Math.sin(t*1.5)*12*s));
      } else {
        // Expressive Eyes
        let blinkScale = 1.0;
        let emotion = 'normal';

        if (isBlinking) {
           blinkScale = 0.1; 
           emotion = 'blink';
        } else if (isDrinking) {
           emotion = 'drinking'; 
        } else if (msgObj.alpha > 0.1) {
           if(msgObj.text.includes('!')) emotion = 'excited';
           else if(msgObj.text.includes('?')) emotion = 'confused';
           else emotion = 'happy';
        }

        if (emotion === 'happy' || emotion === 'drinking') {
           const sipBob = emotion === 'drinking' ? Math.sin(t * 8) * 2 * s : 0;
           ctx.beginPath(); ctx.arc(eyeDrawXLeft, eyeDrawY + 4*s + sipBob, 6*s, Math.PI, 0, false); ctx.stroke();
           ctx.beginPath(); ctx.arc(eyeDrawXRight, eyeDrawY + 4*s + sipBob, 6*s, Math.PI, 0, false); ctx.stroke();
        } else if (emotion === 'excited') {
           ctx.beginPath(); ctx.moveTo(eyeDrawXLeft - 5*s, eyeDrawY + 5*s); ctx.lineTo(eyeDrawXLeft, eyeDrawY - 6*s); ctx.lineTo(eyeDrawXLeft + 5*s, eyeDrawY + 5*s); ctx.stroke();
           ctx.beginPath(); ctx.moveTo(eyeDrawXRight - 5*s, eyeDrawY + 5*s); ctx.lineTo(eyeDrawXRight, eyeDrawY - 6*s); ctx.lineTo(eyeDrawXRight + 5*s, eyeDrawY + 5*s); ctx.stroke();
        } else if (emotion === 'confused') {
           ctx.beginPath(); ctx.ellipse(eyeDrawXLeft, eyeDrawY, 6*s, 10*s, 0, 0, Math.PI*2); ctx.fill();
           ctx.beginPath(); ctx.ellipse(eyeDrawXRight, eyeDrawY, 4*s, 4*s, 0, 0, Math.PI*2); ctx.fill(); // one small eye
        } else {
           ctx.beginPath(); ctx.ellipse(eyeDrawXLeft, eyeDrawY, 6*s, 10*s * Math.max(blinkScale, 0.1), 0, 0, Math.PI*2); ctx.fill();
           ctx.beginPath(); ctx.ellipse(eyeDrawXRight, eyeDrawY, 6*s, 10*s * Math.max(blinkScale, 0.1), 0, 0, Math.PI*2); ctx.fill();
        }

        // Mouth / Smile — always visible for emotion expression
        ctx.shadowBlur = 12 * s;
        ctx.shadowColor = `rgba(255,255,255,0.8)`;
        if (emotion === 'excited') {
           // Big open smile (D shape)
           ctx.beginPath();
           ctx.arc(0 + eyeOffsetX, eyeDrawY + 18*s, 10*s, 0.05, Math.PI - 0.05, false);
           ctx.lineWidth = 3*s;
           ctx.stroke();
           // Lower lip fill for open mouth
           ctx.beginPath();
           ctx.arc(0 + eyeOffsetX, eyeDrawY + 18*s, 10*s, 0.05, Math.PI - 0.05, false);
           ctx.lineTo(0 + eyeOffsetX - 10*s * Math.cos(0.05), eyeDrawY + 18*s);
           ctx.fillStyle = `rgba(${Math.min(255,r+100)},${Math.min(255,g+80)},${Math.min(255,b+80)},0.4)`;
           ctx.fill();
        } else if (emotion === 'confused') {
           // Wavy confused mouth
           ctx.beginPath();
           const mouthCx = 0 + eyeOffsetX;
           const mouthCy = eyeDrawY + 18*s;
           ctx.moveTo(mouthCx - 8*s, mouthCy);
           ctx.quadraticCurveTo(mouthCx - 4*s, mouthCy + 4*s, mouthCx, mouthCy - 2*s);
           ctx.quadraticCurveTo(mouthCx + 4*s, mouthCy - 6*s, mouthCx + 8*s, mouthCy);
           ctx.lineWidth = 2.5*s;
           ctx.stroke();
        } else if (emotion === 'drinking') {
           // Small sipping 'o' mouth
           const sipBob = Math.sin(t * 8) * 2 * s;
           ctx.beginPath();
           ctx.ellipse(0 + eyeOffsetX, eyeDrawY + 16*s + sipBob, 4*s, 5*s, 0, 0, Math.PI*2);
           ctx.lineWidth = 2.5*s;
           ctx.stroke();
        } else if (emotion === 'happy') {
           // Gentle upward smile
           ctx.beginPath();
           ctx.arc(0 + eyeOffsetX, eyeDrawY + 16*s, 9*s, 0.15, Math.PI - 0.15, false);
           ctx.lineWidth = 3*s;
           ctx.stroke();
        } else if (emotion === 'blink') {
           // Neutral small smile during blink
           ctx.beginPath();
           ctx.arc(0 + eyeOffsetX, eyeDrawY + 16*s, 6*s, 0.2, Math.PI - 0.2, false);
           ctx.lineWidth = 2.5*s;
           ctx.stroke();
        } else {
           // Normal resting smile
           ctx.beginPath();
           ctx.arc(0 + eyeOffsetX, eyeDrawY + 16*s, 8*s, 0.15, Math.PI - 0.15, false);
           ctx.lineWidth = 3*s;
           ctx.stroke();
        }
      }
      ctx.shadowBlur = 0; // reset

      // --- Speech Bubble ---
      if (msgObj.alpha > 0) {
        if (msgObj.timer > 0) msgObj.timer--;
        else msgObj.alpha = Math.max(0, msgObj.alpha - 0.05);

        ctx.globalAlpha = msgObj.alpha;
        
        // Smaller font, line wrapping
        const fontSize = 12 * s;
        ctx.font = `500 ${fontSize}px Inter`;
        const padding = 14 * s;
        const lineSpacing = 6 * s;
        const maxTextWidth = 160 * s;

        const lines = getWrappedLines(msgObj.text, maxTextWidth);
        const longestLine = Math.max(...lines.map(line => ctx.measureText(line).width));
        
        const boxW = longestLine + padding * 2;
        const boxH = (lines.length * fontSize) + ((lines.length - 1) * lineSpacing) + (padding * 2);
        
        // Ensure bubble does not bleed off right edge
        let boxX = bellW * 0.7; 
        const marginXRight = w - (cx + boxX + boxW + 20*s);
        if (marginXRight < 0) { boxX += marginXRight; }

        // Floating Y with animation, but CLAMPED so it never goes above the canvas top
        let boxY = -bellH * 1.8 - boxH - (Math.sin(t * 3) * 3 * s);
        
        // Clamp: prevent the bubble from going above the visible canvas area
        // cy is the jellyfish center in canvas coords; boxY is relative to that
        const minBoxYInCanvas = -cy + 10 * s; // 10px padding from top edge
        if (boxY < minBoxYInCanvas) boxY = minBoxYInCanvas;

        // Hardware themed sharp speech bubble backing
        const bubbleBgRadius = 6 * s;
        
        // Glow layer for bubble
        ctx.shadowBlur = 10 * s;
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        
        roundRect(boxX, boxY, boxW, boxH, bubbleBgRadius);
        ctx.shadowBlur = 0; // Turn off shadow for tail to avoid layering artifacts
        
        // Draw Tail pointing toward body
        ctx.beginPath();
        const tailRootX = boxX + padding + 10*s;
        ctx.moveTo(tailRootX, boxY + boxH);
        ctx.lineTo(bellW * 0.5, -bellH * 0.4);
        ctx.lineTo(tailRootX + 16*s, boxY + boxH);
        ctx.fill();

        ctx.fillStyle = '#000000';
        for (let l = 0; l < lines.length; l++) {
          ctx.fillText(lines[l], boxX + padding, boxY + padding + fontSize + (l * (fontSize + lineSpacing)) - 2*s);
        }

        ctx.globalAlpha = 1.0;
      }

      ctx.restore();
    }
  }

  const jelly = new LEDCompanion();

  function resize() {
    const parent = canvas.parentElement;
    w = parent.clientWidth;
    h = parent.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
  }

  function frame() {
    t += 0.016;
    ctx.clearRect(0,0,w,h);
    jelly.draw();
    requestAnimationFrame(frame);
  }

  return { init: () => { window.addEventListener('resize', resize); resize(); requestAnimationFrame(frame); }, speak, setDrinking };
})();

/* ── APIs ── */
const WeatherApi = (() => {
  // THRESHOLDS are now dynamically generated in fetchWeather
  
  const SVGS = {
    'Clear': '<path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path><circle cx="12" cy="12" r="4"></circle>',
    'Clouds': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>',
    'Rain': '<path d="M16 13v8m-8-8v8m4-6v8m4-14a7 7 0 1 0-13.42 2H3.5a4.5 4.5 0 1 0 0 9h15.5a4.5 4.5 0 1 0 0-9h-1.21Z"></path>',
    'Snow': '<path d="M12 2v20M4.93 4.93l14.14 14.14M2 12h20M19.07 4.93L4.93 19.07M10 4l2-2 2 2M4 10l-2 2 2 2M20 10l2 2-2 2M10 20l2 2 2-2"></path>'
  };

  async function fetchWeather(loc, key) {
    if(!key || !loc) return Log.warn('Weather sync skipped: Missing Location or API Key');
    try {
      const s = Settings.load();
      const THRESHOLDS = [
        { min:35, col:hexToRgb(s.hc35), fx:s.fx35 !== undefined ? s.fx35 : 0, l:'High Heat' },
        { min:28, col:hexToRgb(s.hc28), fx:s.fx28 !== undefined ? s.fx28 : 0, l:'Warm' },
        { min:22, col:hexToRgb(s.hc22), fx:s.fx22 !== undefined ? s.fx22 : 0, l:'Pleasant' },
        { min:-99, col:hexToRgb(s.hc0), fx:s.fx0 !== undefined ? s.fx0 : 0, l:'Cool' }
      ];
      
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(loc)}&appid=${key}&units=metric`);
      const data = await res.json();
      if(!res.ok) throw new Error(data.message);
      
      const t = data.main.temp, f = data.main.feels_like;
      const c = THRESHOLDS.find(x => f >= x.min) || THRESHOLDS[3];
      const wMain = data.weather[0]?.main || 'Clear';
      const iconCode = data.weather[0]?.icon || '01d';
      
      let modeStr = wMain.toLowerCase();
      if (modeStr === 'clear' && iconCode.includes('n')) {
         modeStr = 'clear-night';
      }
      
      const el = id => document.getElementById(id);
      
      if(el('wd-temp')) el('wd-temp').textContent = Math.round(t) + '°';
      if(el('wd-feels')) el('wd-feels').textContent = 'It feels ' + Math.round(f) + '°';
      
      const locAlias = data.name + (data.sys && data.sys.country ? ', ' + data.sys.country : '');
      if(el('wd-meta')) el('wd-meta').textContent = wMain + ' • ' + locAlias;
      
      if(el('wd-status')) el('wd-status').textContent = c.l;
      if(el('wd-icon')) el('wd-icon').src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
      if(el('weather-board')) el('weather-board').className = `weather-dashboard wd-mode-${modeStr}`;
      
      if(el('wd-lmi-badge')) {
         el('wd-lmi-badge').style.background = `rgb(${c.col.join(',')})`;
         el('wd-lmi-badge').style.boxShadow = `0 0 10px rgb(${c.col.join(',')})`;
      }
      if(el('wd-lmi-label')) {
         const fxName = WLED_FX.find(x => x.id === c.fx)?.name || 'Solid';
         el('wd-lmi-label').textContent = `Effect: ${fxName}`;
      }

      // Update Global Mini-Widget
      if(el('gw-temp')) el('gw-temp').textContent = Math.round(t) + '°C';
      if(el('gw-feels')) el('gw-feels').textContent = 'Feels ' + Math.round(f) + '°C';
      if(el('gw-loc')) el('gw-loc').textContent = locAlias;
      if(el('gw-icon')) el('gw-icon').src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
      if(el('global-weather-widget')) el('global-weather-widget').className = `global-weather-widget wd-mode-${modeStr}`;

      Log.info(`Weather: ${data.name} - ${c.l}`);
      
      WledApi.sendState({ on:true, bri:100, seg:[{id:0, fx:c.fx, col:[c.col,[0,0,0],[0,0,0]]}], tt:20 });
      LampState.set(c.col, c.fx, 100, true);
      _restPayload = { on:true, bri:100, seg:[{id:0, fx:c.fx, col:[c.col,[0,0,0],[0,0,0]]}], tt:20 };
      
      // Character Speak
      JellyfishRenderer.speak(`It feels like ${Math.round(f)}°C. Setting lights to ${c.l}.`);
      showToast(`Weather updated`);

    } catch (e) { Log.err('Weather Fetch: ' + e.message); }
  }
  return { fetchWeather };
})();

/* ── Water Reminder ── */
let _restPayload = null;
function triggerWaterReminder() {
  const s = Settings.load();
  const durationMs = s.waterDuration * 1000;
  const fx = s.waterFx !== undefined ? s.waterFx : 15;
  const col = s.waterColor ? hexToRgb(s.waterColor) : [0, 120, 255];

  Log.ok('Hydration sequence triggered.');
  WledApi.sendState({ on:true, bri:255, seg:[{id:0, fx:fx, sx:120, ix:200, col:[col,[col[0],255,255],[200,200,255]]}], tt:5 });
  LampState.set(col, fx, 255, true);
  
  JellyfishRenderer.setDrinking(true);
  JellyfishRenderer.speak("Time to hydrate! Drink some water! 💧", durationMs);

  setTimeout(() => { 
    JellyfishRenderer.setDrinking(false);
    const defaultFx = s.waterReturnFx !== undefined ? s.waterReturnFx : 0;

    if(_restPayload && _restPayload.seg && _restPayload.seg[0]) {
      const defaultPayload = JSON.parse(JSON.stringify(_restPayload));
      defaultPayload.seg[0].fx = defaultFx;

      const baseCol = Array.isArray(defaultPayload.seg[0].col?.[0]) ? defaultPayload.seg[0].col[0] : [93, 82, 240];
      WledApi.sendState(defaultPayload); 
      LampState.set(baseCol, defaultFx, defaultPayload.bri, defaultPayload.on);
      Log.info('Hydration reminder ended. Applied default effect ID: ' + defaultFx);
    } else {
      const curr = LampState.get();
      const baseCol = Array.isArray(curr.col) ? curr.col : [93, 82, 240];
      const fallbackPayload = { on: curr.on !== false, bri: curr.bri || 120, seg:[{id:0, fx:defaultFx, col:[baseCol,[0,0,0],[0,0,0]]}], tt:8 };
      WledApi.sendState(fallbackPayload);
      LampState.set(baseCol, defaultFx, fallbackPayload.bri, fallbackPayload.on);
      Log.info('Hydration reminder ended. Applied fallback default effect ID: ' + defaultFx);
    }
  }, durationMs);
}

/* ── Scheduler ── */
const Scheduler = (() => {
  let cfg={}, wTimer=0, rTimer=0, intId=null;
  function start(settings) {
    cfg = settings;
    wTimer = cfg.weatherInterval * 60;
    rTimer = cfg.waterInterval * 60;
    if(intId) clearInterval(intId);
    intId = setInterval(tick, 1000);
  }
  function tick() {
    wTimer--; rTimer--;
    if(wTimer<=0) {
      wTimer = cfg.weatherInterval * 60;
      const overrideLoc = document.getElementById('loc-input') ? document.getElementById('loc-input').value.trim() : '';
      const locToUse = overrideLoc || cfg.location;
      WeatherApi.fetchWeather(locToUse, cfg.weatherApiKey); 
    }
    if(rTimer<=0) { rTimer = cfg.waterInterval * 60; triggerWaterReminder(); }
    
    const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    const tw = document.getElementById('timer-weather-cd');
    const tr = document.getElementById('timer-water-cd');
    if(tw) tw.textContent = fmt(wTimer);
    if(tr) tr.textContent = fmt(rTimer);
  }
  return { start, restart: start };
})();

/* ── UI Binding ── */
function hexToRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

document.addEventListener('DOMContentLoaded', () => {
  const s = Settings.load();
  if (s.startupMode === 'rest') s.commMode = 'rest';
  else if (s.startupMode === 'mqtt') s.commMode = 'mqtt';
  
  try { 
    WledApi.init(s, { source: 'startup' }); 
  } catch(e) { 
    console.error("WledApi INIT CRASH:", e);
    setTimeout(() => Log.err('System Error: ' + e.message), 1000); 
  }

  // Populate FX selects
  const opts = WLED_FX.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
  document.querySelectorAll('.fx-select').forEach(sel => sel.innerHTML = opts);

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== btn.dataset.page));
    });
  });

  // FX Grid
  const grid = document.getElementById('fx-grid');
  WLED_FX.forEach((fx, i) => {
    const el = document.createElement('div');
    el.className = 'fx-item' + (i===0?' active':'');
    el.textContent = fx.name;
    el.dataset.id = fx.id;
    el.addEventListener('click', () => {
      grid.querySelectorAll('.fx-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    });
    grid.appendChild(el);
  });

  // Sliders binding
  ['brightness','speed','intensity'].forEach(k => {
    const el = document.getElementById('sl-'+k);
    const val = document.getElementById('val-'+k);
    if(el && val) el.addEventListener('input', () => val.textContent=el.value);
  });

  function syncForms() {
    document.getElementById('ip-input').value = s.wledIp;
    if (document.getElementById('sys-startup-mode')) document.getElementById('sys-startup-mode').value = s.startupMode || 'last';
    if (document.getElementById('sys-loc-input')) document.getElementById('sys-loc-input').value = s.location;
    if (document.getElementById('loc-input')) document.getElementById('loc-input').value = s.location;
    if (document.getElementById('sys-apikey-input')) document.getElementById('sys-apikey-input').value = s.weatherApiKey;
    document.getElementById('set-weather-interval').value = s.weatherInterval;
    document.getElementById('set-water-interval').value = s.waterInterval;
    if(document.getElementById('set-water-duration')) document.getElementById('set-water-duration').value = s.waterDuration;
    if(document.getElementById('hc-35')) {
      document.getElementById('hc-35').value = s.hc35;
      document.getElementById('hc-28').value = s.hc28;
      document.getElementById('hc-22').value = s.hc22;
      document.getElementById('hc-0').value = s.hc0;
      
      document.getElementById('fx-35').value = s.fx35 || 0;
      document.getElementById('fx-28').value = s.fx28 || 0;
      document.getElementById('fx-22').value = s.fx22 || 0;
      document.getElementById('fx-0').value = s.fx0 || 0;
      
      if(document.getElementById('water-fx')) document.getElementById('water-fx').value = s.waterFx !== undefined ? s.waterFx : 15;
      if(document.getElementById('water-color')) document.getElementById('water-color').value = s.waterColor || '#0078ff';
      if(document.getElementById('water-default-fx')) document.getElementById('water-default-fx').value = s.waterReturnFx !== undefined ? s.waterReturnFx : 0;
    }
    if(document.getElementById('mode-rest')) {
      document.getElementById('mode-' + s.commMode).checked = true;
      document.getElementById('mqtt-broker').value = s.mqttBroker;
      document.getElementById('mqtt-port').value = s.mqttPort;
      document.getElementById('mqtt-topic').value = s.mqttTopic;
      const isMqtt = s.commMode === 'mqtt';
      document.getElementById('group-mqtt').classList.toggle('hidden', !isMqtt);
      document.getElementById('group-rest').classList.toggle('hidden', isMqtt);
    }
  }
  syncForms();

  ['fx-35','fx-28','fx-22','fx-0','hc-35','hc-28','hc-22','hc-0','water-fx','water-color','water-default-fx','set-weather-interval','set-water-interval','set-water-duration'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', () => document.getElementById('btn-save-settings')?.click());
  });

  document.getElementsByName('comm-mode').forEach(rad => {
    rad.addEventListener('change', (e) => {
      const isMqtt = e.target.value === 'mqtt';
      document.getElementById('group-mqtt').classList.toggle('hidden', !isMqtt);
      document.getElementById('group-rest').classList.toggle('hidden', isMqtt);
      
      s.commMode = isMqtt ? 'mqtt' : 'rest';
      ConnStatus.setMode(s.commMode);
      if (isMqtt) {
         JellyfishRenderer.speak("Establishing Cloud Uplink...");
      } else {
         JellyfishRenderer.speak("Testing Local Network...");
      }
      WledApi.init(s, { source: 'manual-switch' });
    });
  });

  // Buttons
  document.getElementById('btn-lamp-on')?.addEventListener('click', () => { 
    WledApi.sendState({on:true}); 
    LampState.set(undefined, undefined, undefined, true);
    JellyfishRenderer.speak("I'm awake! ✨");
    showToast('Lamp On'); 
  });
  
  document.getElementById('btn-lamp-off')?.addEventListener('click', () => { 
    WledApi.sendState({on:false}); 
    LampState.set(undefined, undefined, undefined, false);
    JellyfishRenderer.speak("byeee 👋", 3000);
    showToast('Lamp Off'); 
  });
  
  document.getElementById('btn-apply-light')?.addEventListener('click', () => {
    const fx = parseInt(document.querySelector('.fx-item.active')?.dataset.id || 0);
    const rgb = hexToRgb(document.getElementById('color-picker').value);
    const b = parseInt(document.getElementById('sl-brightness').value);
    const sp = parseInt(document.getElementById('sl-speed').value);
    const ix = parseInt(document.getElementById('sl-intensity').value);
    
    const payload = { on:true, bri:b, seg:[{id:0, fx, sx:sp, ix, col:[rgb,[0,0,0],[0,0,0]]}], tt:5 };
    WledApi.sendState(payload);
    LampState.set(rgb, fx, b, true);
    _restPayload = payload;
    showToast('Applied Effect');
    Log.ok(`Applied FX ${fx} @ Bri ${b}`);
    JellyfishRenderer.speak("Ooh, pretty colors!");
  });

  document.getElementById('btn-fetch-weather')?.addEventListener('click', () => {
    const liveLoc = document.getElementById('loc-input').value.trim();
    const liveKey = document.getElementById('sys-apikey-input') ? document.getElementById('sys-apikey-input').value.trim() : s.weatherApiKey;
    WeatherApi.fetchWeather(liveLoc, liveKey);
  });
  
  document.getElementById('preset-grid')?.addEventListener('click', (e) => {
    if(e.target.classList.contains('preset-btn')) {
      const loc = e.target.getAttribute('data-loc');
      const liveKey = document.getElementById('sys-apikey-input') ? document.getElementById('sys-apikey-input').value.trim() : s.weatherApiKey;
      const locInput = document.getElementById('loc-input');
      if (locInput) locInput.value = loc;
      WeatherApi.fetchWeather(loc, liveKey);
      showToast(`Teleported to ${loc}`);
    }
  });

  document.getElementById('btn-add-preset')?.addEventListener('click', () => {
    const ipt = document.getElementById('new-preset-loc');
    const val = ipt.value.trim();
    if(val) {
       const btn = document.createElement('button');
       btn.className = 'btn-ghost preset-btn';
       btn.setAttribute('data-loc', val);
       btn.textContent = val.split(',')[0];
       document.getElementById('preset-grid').appendChild(btn);
       ipt.value = '';
    }
  });

  document.getElementById('btn-force-speech')?.addEventListener('click', () => {
    const ipt = document.getElementById('lab-speech');
    if(ipt.value.trim()) {
      JellyfishRenderer.speak(ipt.value.trim());
      ipt.value = '';
    }
  });

  document.getElementById('btn-load-preset')?.addEventListener('click', () => {
    const ipt = document.getElementById('lab-preset-id');
    const ps = parseInt(ipt.value);
    if (!isNaN(ps) && ps >= 1) {
      WledApi.sendState({ ps: ps });
      JellyfishRenderer.speak(`Loading Preset ${ps} from device!`);
      showToast(`Loaded Preset ${ps}`);
      ipt.value = '';
    }
  });

  document.getElementById('btn-party-mode')?.addEventListener('click', () => {
    JellyfishRenderer.speak("RAVE MODE ACTIVATED! WOOOO!", 4000);
    let count = 0;
    const colors = [[255,0,0], [0,255,0], [0,0,255], [255,255,0], [255,0,255], [0,255,255]];
    const iv = setInterval(() => {
       const col = colors[Math.floor(Math.random() * colors.length)];
       const fx = Math.floor(Math.random() * 80);
       WledApi.sendState({ on:true, bri:255, seg:[{id:0, fx:fx, col:[col,[0,0,0],[0,0,0]]}], tt:5 });
       LampState.set(col, fx, 255, true);
       count++;
       if(count > 25) {
         clearInterval(iv);
         setTimeout(() => {
             JellyfishRenderer.speak("Phew... I'm exhausted.", 5000);
             LampState.set([99,88,255], 0, 100, true);
             WledApi.sendState({ on:true, bri:100, seg:[{id:0, fx:0, col:[[99,88,255],[0,0,0],[0,0,0]]}], tt:10 });
         }, 800);
       }
    }, 400);
  });

  const restBypassModal = document.getElementById('rest-mode-modal');
  const openRestBypassModal = () => {
    if (restBypassModal) restBypassModal.classList.remove('hidden');
  };
  const closeRestBypassModal = () => {
    if (restBypassModal) restBypassModal.classList.add('hidden');
  };

  document.getElementById('btn-unlock-rest-mode')?.addEventListener('click', openRestBypassModal);
  document.getElementById('btn-close-rest-modal')?.addEventListener('click', closeRestBypassModal);
  document.getElementById('btn-close-rest-modal-footer')?.addEventListener('click', closeRestBypassModal);

  restBypassModal?.addEventListener('click', (e) => {
    if (e.target === restBypassModal) closeRestBypassModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && restBypassModal && !restBypassModal.classList.contains('hidden')) {
      closeRestBypassModal();
    }
  });

  document.getElementById('btn-reset-loc')?.addEventListener('click', () => {
    const defaultLoc = document.getElementById('sys-loc-input') ? document.getElementById('sys-loc-input').value.trim() : s.location;
    const locInput = document.getElementById('loc-input');
    if (locInput) locInput.value = defaultLoc;
    const liveKey = document.getElementById('sys-apikey-input') ? document.getElementById('sys-apikey-input').value.trim() : s.weatherApiKey;
    WeatherApi.fetchWeather(defaultLoc, liveKey);
  });
  
  document.getElementById('btn-trigger-water')?.addEventListener('click', triggerWaterReminder);
  document.getElementById('btn-clear-log')?.addEventListener('click', () => { document.getElementById('log-feed').innerHTML = ''; });

  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    s.wledIp = document.getElementById('ip-input').value.trim();
    if (document.getElementById('sys-loc-input')) s.location = document.getElementById('sys-loc-input').value.trim();
    if (document.getElementById('sys-apikey-input')) s.weatherApiKey = document.getElementById('sys-apikey-input').value.trim();
    s.weatherInterval = parseInt(document.getElementById('set-weather-interval').value)||15;
    s.waterInterval = parseInt(document.getElementById('set-water-interval').value)||60;
    if (document.getElementById('set-water-duration')) s.waterDuration = parseInt(document.getElementById('set-water-duration').value)||15;
    if (document.getElementById('hc-35')) {
      s.hc35 = document.getElementById('hc-35').value;
      s.hc28 = document.getElementById('hc-28').value;
      s.hc22 = document.getElementById('hc-22').value;
      s.hc0 = document.getElementById('hc-0').value;
      
      s.fx35 = parseInt(document.getElementById('fx-35').value) || 0;
      s.fx28 = parseInt(document.getElementById('fx-28').value) || 0;
      s.fx22 = parseInt(document.getElementById('fx-22').value) || 0;
      s.fx0 = parseInt(document.getElementById('fx-0').value) || 0;
      
      if(document.getElementById('water-fx')) s.waterFx = parseInt(document.getElementById('water-fx').value) || 0;
      if(document.getElementById('water-color')) s.waterColor = document.getElementById('water-color').value;
      if(document.getElementById('water-default-fx')) s.waterReturnFx = parseInt(document.getElementById('water-default-fx').value) || 0;
    }
    if (document.getElementById('sys-startup-mode')) s.startupMode = document.getElementById('sys-startup-mode').value;
    if (document.querySelector('input[name="comm-mode"]:checked')) {
      s.commMode = document.querySelector('input[name="comm-mode"]:checked').value;
      s.mqttBroker = document.getElementById('mqtt-broker').value.trim();
      s.mqttPort = parseInt(document.getElementById('mqtt-port').value) || 8000;
      s.mqttTopic = document.getElementById('mqtt-topic').value.trim();
    }
    
    Settings.save(s);
    try { WledApi.init(s, { source: 'settings-save' }); } catch (e) { Log.err('MQTT Init Error: ' + e.message); }
    Scheduler.restart(s);
    JellyfishRenderer.speak("Got it! Settings saved.");
    showToast('Configuration Saved');
    Log.info('System configuration updated');
  });

  document.getElementById('btn-test-conn')?.addEventListener('click', async () => {
    const pingMode = s.commMode;
    const pingEpoch = WledApi.getEpoch();
    ConnStatus.setMode(pingMode);
    ConnStatus.set('warn');
    Log.info('Pinging target device...');
    
    // Allow live pinging without strictly requiring Save
    if (s.commMode === 'rest') s.wledIp = document.getElementById('ip-input').value.trim();
    if (s.commMode === 'mqtt') {
      s.mqttBroker = document.getElementById('mqtt-broker').value.trim();
      s.mqttPort = parseInt(document.getElementById('mqtt-port').value) || 8000;
      s.mqttTopic = document.getElementById('mqtt-topic').value.trim();
    }
    
    const ok = await WledApi.ping({ mode: pingMode, epoch: pingEpoch });
    if (!WledApi.isRequestCurrent(pingMode, pingEpoch)) {
      Log.info('Ignored stale ping result after mode switch.');
      return;
    }
    
    // Simulate initial awake if device responds initially
    if(ok) { LampState.set(undefined, undefined, undefined, true); JellyfishRenderer.speak("Connected to target!"); }
    else JellyfishRenderer.speak("I can't see the lamp...");
    
    Log[ok?'ok':'err'](ok?'Ping successful':'Ping failed. Device offline.');
  });

  // Init routines
  JellyfishRenderer.init();
  Scheduler.start(s);
  
  setTimeout(async () => {
    const startupMode = s.commMode;
    const startupEpoch = WledApi.getEpoch();
    ConnStatus.setMode(startupMode);
    ConnStatus.set('warn');
    const ok = await WledApi.ping({ mode: startupMode, epoch: startupEpoch });
    if (!WledApi.isRequestCurrent(startupMode, startupEpoch)) return;
    if (ok) LampState.set(null, null, null, true); // Assume on if connected for happy state
    Log.info('Lumina System Boot Sequence Complete');
    JellyfishRenderer.speak("Hello there! I'm your Lumina companion.");
  }, 500);
});
