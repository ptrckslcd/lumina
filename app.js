'use strict';

/* ── WLED FX ──────────────────────────────────────────────── */
const WLED_FX = [
  { id: 0,   name: 'Solid' },
  { id: 1,   name: 'Blink' },
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
  { id: 101, name: 'Pacifica' },
  { id: 32,  name: 'Sparkle' }
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
      if (v !== null) s[k] = (typeof defaults[k] === 'number') ? Number(v) : v;
    });
    return s;
  }
  function save(obj) { Object.entries(obj).forEach(([k, v]) => localStorage.setItem('lumina_' + k, v)); }
  function resetEffects() {
    const s = load();
    const defaultsOnly = {
      weatherInterval: 15, waterInterval: 60, waterDuration: 15,
      waterFx: 15, waterColor: '#0078ff', waterReturnFx: 0,
      hc35: '#df4b4b', hc28: '#da9228', hc22: '#24b65a', hc0: '#5d52f0',
      fx35: 0, fx28: 0, fx22: 0, fx0: 0
    };
    Object.assign(s, defaultsOnly);
    save(s);
    return s;
  }
  return { load, save, resetEffects };
})();

/* ── Utilities: Log & Toast ───────────────────────────────── */
const Log = (() => {
  const f = () => document.getElementById('log-feed');
  const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false });
  function write(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `log-line ${type}`;

    const tsEl = document.createElement('span');
    tsEl.className = 'log-ts';
    tsEl.textContent = ts();

    const msgEl = document.createElement('span');
    msgEl.className = 'log-msg';
    msgEl.textContent = msg;

    el.appendChild(tsEl);
    el.appendChild(msgEl);

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
  let cfg = { color: [99,88,255], fx: 0, bri: 128, on: false };
  function set(c, f, b, o) {
    if(c) cfg.color = [...c]; 
    if(f!==undefined) cfg.fx = f; 
    if(b!==undefined) cfg.bri = b;
    if(o!==undefined) cfg.on = o;
  }
  function get() { return { ...cfg, color: [...cfg.color] }; }
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
    const source = options.source || 'startup';
    
    // If saving settings, only rebuild connection if critical network parameters actually changed
    if (source === 'settings-save' && s) {
      const sameMode = s.commMode === settings.commMode;
      const sameMqtt = s.mqttBroker === settings.mqttBroker && s.mqttPort === settings.mqttPort && s.mqttTopic === settings.mqttTopic;
      const sameRest = s.wledIp === settings.wledIp;
      
      if (sameMode && ((settings.commMode === 'mqtt' && sameMqtt) || (settings.commMode === 'rest' && sameRest))) {
        s = { ...settings }; // Just update config silently
        return;
      }
    }

    s = { ...settings };
    const initEpoch = ++modeEpoch;
    ConnStatus.setMode(s.commMode);
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
            syncToHardware();
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
          if (ok) syncToHardware();
        } else if (source === 'manual-switch') {
          JellyfishRenderer.speak(ok ? 'Switched to REST. Connected!' : 'Local node unreachable.');
        }
      });
    }
  }

  function syncToHardware() {
    const s = Settings.load(); // Reload to get freshest config if needed
    const def = LampState.get();
    // Force a known state to hardware + mascot to ensure 1:1 sync on boot
    const col = getEffectColors(def.fx, def.color);
    sendState({ on: true, bri: def.bri, seg:[{id:0, fx: def.fx, col: col}], tt: 10 });
    LampState.set(def.color, def.fx, def.bri, true);
    Log.ok('State Sync: Hardware and Mascot are now synchronized.');
    console.log("[Lumina] Startup Sync complete.");
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
  let msgObj = { text: '', alpha: 0, expires: 0 };
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
  let partyJitter = 0;
  let hasMouse = false;

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    hasMouse = true;
  });
  canvas.addEventListener('mouseleave', () => { hasMouse = false; });

  // Underwater Effect Status
  let underwaterEndTime = 0;
  let underwaterBubbles = [];
  let underwaterCorals = [];
  let underwaterGodRays = [];
  let underwaterFish = [];

  canvas.addEventListener('dblclick', () => {
    const state = LampState.get();
    if (state && state.on) {
      underwaterEndTime = Date.now() + 10000;
      underwaterBubbles = [];
      underwaterCorals = [];
      underwaterGodRays = [];
      underwaterFish = [];

      // Generate Bubbles
      const numBubbles = Math.floor(Math.random() * 20) + 40;
      for (let i = 0; i < numBubbles; i++) {
        underwaterBubbles.push({
          x: Math.random() * w,
          y: h + 50 + Math.random() * 150, // Start below viewport
          s: Math.random() * 3 + 1.5, // Size
          v: Math.random() * 2 + 1.5, // Velocity
          wobbleOffset: Math.random() * Math.PI * 2,
          wobbleSpeed: Math.random() * 2 + 1
        });
      }

      // Generate God Rays (deterministic for this click)
      const numRays = 4;
      for (let i = 0; i < numRays; i++) {
        underwaterGodRays.push({
          topX: Math.random() * w,
          bottomXOffset: (Math.random() - 0.5) * w * 0.4,
          speed: Math.random() * 0.4 + 0.2,
          width: Math.random() * 60 + 30
        });
      }

      // Generate Branching Seafloor Corals / Kelp
      const numCorals = Math.floor(Math.random() * 5) + 7;
      for (let i = 0; i < numCorals; i++) {
        const height = h * (0.2 + Math.random() * 0.3);
        const hasBranches = Math.random() > 0.3; // 70% chance to have branches
        
        const coral = {
          x: (w * 0.05) + Math.random() * (w * 0.9),
          baseY: h,
          height: height,
          segments: Math.floor(Math.random() * 3) + 4,
          swaySpeed: Math.random() * 0.8 + 0.4,
          swayOffset: Math.random() * Math.PI * 2,
          color: `hsla(${180 + Math.random() * 120}, ${50 + Math.random() * 30}%, ${15 + Math.random() * 20}%, 1.0)`,
          branches: []
        };
        
        if (hasBranches) {
           const numBranches = Math.floor(Math.random() * 3) + 1;
           for(let j = 0; j < numBranches; j++) {
              coral.branches.push({
                 startYPct: 0.3 + Math.random() * 0.5,
                 lengthPct: 0.3 + Math.random() * 0.4,
                 angle: (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 0.5),
                 swayOffset: Math.random() * Math.PI * 2
              });
           }
        }
        underwaterCorals.push(coral);
      }

      // Generate small swimming fish
      const numFishes = Math.floor(Math.random() * 8) + 5;
      for (let i = 0; i < numFishes; i++) {
         const fromLeft = Math.random() > 0.5;
         underwaterFish.push({
           x: fromLeft ? -50 - Math.random()*200 : w + 50 + Math.random()*200,
           y: h * 0.2 + Math.random() * (h * 0.6),
           dir: fromLeft ? 1 : -1,
           speed: 1.0 + Math.random() * 2.0,
           size: Math.random() * 8 + 4,
           color: `hsla(${Math.random() * 360}, ${70 + Math.random() * 30}%, ${50 + Math.random() * 30}%, 0.8)`,
           wobbleOffset: Math.random() * Math.PI * 2
         });
      }
    }
  });

  let isDrinking = false;
  function setDrinking(val) { isDrinking = val; }

  function updateSpeechCache() {
    const s = Math.min(w, h) / 500;
    const fontSize = 12 * s;
    ctx.font = `500 ${fontSize}px Inter`;
    const maxTextWidth = 160 * s;
    msgObj.lines = getWrappedLines(msgObj.text, maxTextWidth);
    msgObj.longestLine = msgObj.lines.length > 0 ? Math.max(...msgObj.lines.map(line => ctx.measureText(line).width)) : 0;
  }

  function speak(text, duration = 4000) {
    if (!text) {
      msgObj.text = '';
      msgObj.expires = 0;
      msgObj.alpha = 0;
      return;
    }
    msgObj.text = text;
    msgObj.alpha = 1.0;
    msgObj.expires = Date.now() + duration; 
    updateSpeechCache();
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
    constructor() { 
      this.numTentacles = 7; 
      this.segmentsPerTentacle = 25; 
      this.isDrinking = false;
      this.drinkingLevel = 0;
      this.isParty = false;
      this.partyLevel = 0;
    }

    setDrinking(val) { this.isDrinking = val; }
    setParty(val) { this.isParty = val; }

    draw() {
      // Smooth interpolation for modes
      this.drinkingLevel += (this.isDrinking ? 1.0 : 0.0 - this.drinkingLevel) * 0.1;
      this.partyLevel += (this.isParty ? 1.0 : 0.0 - this.partyLevel) * 0.08;
      const partyLevel = this.partyLevel; // Local shortcut for easier use below

      const { color, fx, bri, on } = LampState.get();
      const s = Math.min(w, h) / 500;
      const cx = w * 0.5;
      
      const dimAlpha = on ? 1.0 : 0.6;
      ctx.globalAlpha = dimAlpha;

      targetCyPct = on ? 0.45 : 0.65;
      currentCyPct += (targetCyPct - currentCyPct) * 0.05;

      const baseAmplitude = on ? 15 : 4; 
      const bellW = 85 * s;
      const bellH = 80 * s;
      const tentacleLength = 220 * s;
      let bob = Math.sin(t * (on ? 0.8 : 0.4)) * baseAmplitude * s;
      
      // Crazy bobbing for party mode
      if (partyLevel > 0.01) {
        const targetJitter = (Math.random() - 0.5) * 14 * s;
        partyJitter += (targetJitter - partyJitter) * 0.22;
        bob += Math.sin(t * 12) * 10 * partyLevel * s;
        bob += partyJitter * partyLevel;
      } else {
        partyJitter *= 0.8;
      }

      const rawCy = (h * currentCyPct) + bob;
      let cy = rawCy;

      // Keep mascot bounded only during intense party motion.
      // For normal on/off transitions, preserve original smooth vertical travel.
      if (on && partyLevel > 0.08) {
        const minCy = bellH * 1.25;
        const maxCy = Math.max(minCy + 1, h - tentacleLength - 24 * s);
        cy = Math.max(minCy, Math.min(maxCy, rawCy));
      }

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
         if (fx === 11) { // Rainbow Bell — slow smooth full-spectrum rotation
            const hue = (t * 15) % 360;
            const C = 255;
            const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
            if(hue < 60) { r=C; g=X; b=0; }
            else if(hue < 120) { r=X; g=C; b=0; }
            else if(hue < 180) { r=0; g=C; b=X; }
            else if(hue < 240) { r=0; g=X; b=C; }
            else if(hue < 300) { r=X; g=0; b=C; }
            else { r=C; g=0; b=X; }
         } else if (fx === 9) { // Colorloop Bell — fast pulsing color blocks
            const hue = (t * 45) % 360;
            const blockHue = Math.floor(hue / 60) * 60; // snap to 6 color blocks
            const C = 255;
            const X = Math.round(C * (1 - Math.abs(((blockHue/60) % 2) - 1)));
            if(blockHue < 60) { r=C; g=X; b=0; }
            else if(blockHue < 120) { r=X; g=C; b=0; }
            else if(blockHue < 180) { r=0; g=C; b=X; }
            else if(blockHue < 240) { r=0; g=X; b=C; }
            else if(blockHue < 300) { r=X; g=0; b=C; }
            else { r=C; g=0; b=X; }
         } else if (fx === 101) { // Pacifica Bell
            const pct = (Math.sin(t*0.5) + 1) / 2;
            r = Math.round(62*(1-pct) + 0*pct);
            g = Math.round(229*(1-pct) + 130*pct);
            b = Math.round(153*(1-pct) + 200*pct);
         } else if (fx === 64) { // Plasmawave Bell — red and blue
            const val = (Math.sin(t*0.8) + 1)/2;
            r = Math.round(255*val);
            g = 0;
            b = Math.round(255*(1-val));
         } else if (fx === 72) { // Aurora Bell — green to purple
            const hue = 120 + ((Math.sin(t*0.3) + 1)/2) * 160; 
            const C = 255;
            const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
            if(hue < 180) { r=0; g=C; b=X; }
            else if(hue < 240) { r=0; g=X; b=C; }
            else if(hue < 300) { r=X; g=0; b=C; }
            else { r=C; g=0; b=X; }
         } else if (fx === 2) { // Breathe Bell — slow pulse of user color
            const pulse = 0.3 + 0.7 * ((Math.sin(t * 1.2) + 1) / 2);
            r = Math.round(r * pulse);
            g = Math.round(g * pulse);
            b = Math.round(b * pulse);
         } else if (fx === 15) { // Ripple Bell — brief bright flash expanding
            const ripPulse = Math.max(0, Math.sin(t * 4));
            r = Math.round(r + (255 - r) * ripPulse * 0.5);
            g = Math.round(g + (255 - g) * ripPulse * 0.5);
            b = Math.round(b + (255 - b) * ripPulse * 0.5);
         } else if (fx === 1) { // Blink Bell — hard on/off
            const blinkPulse = Math.floor(t * 2) % 2 === 0 ? 1 : 0;
            if (blinkPulse === 0) { r=0; g=0; b=0; }
         }
      }
      
      const baseBri = on ? bri : bri * 0.15;
      const brightnessFactor = (baseBri !== undefined ? baseBri : 100) / 255;
      
      let effectMultiplier = 1.0;
      let chaseOffset = -1;

      if (on) {
        if (fx === 1) { // Blink — sharp on and off
          effectMultiplier = Math.floor(t * 2) % 2 === 0 ? 1 : 0;
        } else if (fx === 2) { // Breathe — slow global pulse
          effectMultiplier = 0.2 + 0.8 * ((Math.sin(t * 1.2) + 1) / 2);
        } else if (fx === 15) { // Ripple — tighter rapid pulse
          effectMultiplier = 0.4 + 0.6 * Math.abs(Math.sin(t * 3.5));
        } else if (fx === 25) { // Chase — lit group chases down
          chaseOffset = (t * 14) % this.segmentsPerTentacle;
        } else if (fx === 28) { // Comet — fast bright head with trail
          chaseOffset = (t * 24) % this.segmentsPerTentacle;
        } else if (fx === 76) { // Running — staggered wave per tentacle
          chaseOffset = (t * 16) % this.segmentsPerTentacle;
        } else if (fx === 3) { // Wipe — color reveal sweeping down
          chaseOffset = -2; // special marker for wipe
        }
      } else {
        effectMultiplier = 0.6 + 0.4 * Math.sin(t * 0.6);
      }

      const alpha = 0.9 * effectMultiplier * brightnessFactor;

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
        let phase = t * 1.2 + i * 2.0;

        if (partyLevel > 0.01) {
           phase += t * 10 * partyLevel; // Go fast!
        }

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
        let phase = t * 0.8 + i * 1.5;

        if (partyLevel > 0.01) {
           phase += t * 8 * partyLevel; // Curl dance!
        }

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
      const activeWeatherState =
        typeof WeatherFx !== 'undefined' && typeof WeatherFx.getActiveState === 'function'
          ? WeatherFx.getActiveState()
          : null;

      for (let i = 0; i < this.numTentacles; i++) {
        const pct = i / (this.numTentacles - 1); 
        const thRoot = (pct - 0.5) * bellW * 1.5;
        
        let phase = t * (on ? 1.2 : 0.3) + i * 0.8;
        
        if (partyLevel > 0.01) {
           phase += t * 15 * partyLevel; // Raving LEDs!
        }
        
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

          // --- Blink/Sparkle Effect Animation for Mascot ---
          if (on && fx === 1) { // Blink
             const blinkPhase = Math.floor(t * 2) % 2;
             if (blinkPhase === 1) {
                const h = (t * 60 + i * 20) % 360;
                ctx.fillStyle = `hsla(${h}, 80%, 60%, ${alpha * 0.8})`;
                ctx.beginPath();
                ctx.arc(currentX, currentY, 4 * s, 0, Math.PI * 2);
                ctx.fill();
             }
          } else if (on && fx === 32) { // Sparkle
             const sparklePhase = (t * 12 + i * 5 + j * 0.5) % 8; // Faster cycle for more energy
             if (sparklePhase < 2) {
                const sparkleAlpha = (1.2 - Math.abs(1.0 - sparklePhase)) * alpha;
                // Vibrant Random-ish color based on time and position
                const h = (t * 150 + i * 60 + j * 30) % 360; 
                ctx.fillStyle = `hsla(${h}, 100%, 80%, ${sparkleAlpha})`;
                ctx.beginPath();
                // Bigger, more glowing sparks
                ctx.shadowBlur = 10 * s;
                ctx.shadowColor = `hsla(${h}, 100%, 80%, ${sparkleAlpha})`;
                ctx.arc(currentX, currentY, 5 * s, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
             }
          }

          const useCupArm = isCupArm && on && (isDrinking || activeWeatherState === 'heat');
          if (useCupArm) {
             let holdTargetX = -bellW * 1.8;
             let holdTargetY = bellH * 1.2 + Math.sin(t * 3) * 6 * s;

             if (
               !isDrinking &&
               activeWeatherState === 'heat' &&
               typeof WeatherFx !== 'undefined' &&
               typeof WeatherFx.getFanHoldPoint === 'function'
             ) {
               const hold = WeatherFx.getFanHoldPoint(t, s, bellW, bellH);
               holdTargetX = hold.x;
               holdTargetY = hold.y;
             }

             // Smooth bezier curve for a pronounced V-shape hanging elbow bend
             const cpX = -bellW * 1.2;
             const cpY = bellH * 3.5;

             const armPct = depthPct;
             const invPct = 1 - armPct;
             let baseX = (invPct * invPct * thRoot) + (2 * invPct * armPct * cpX) + (armPct * armPct * holdTargetX);
             let baseY = (invPct * invPct * 0) + (2 * invPct * armPct * cpY) + (armPct * armPct * holdTargetY);

             // Wiggle the arm organically while holding the accessory
             const wiggleMask = Math.sin(depthPct * Math.PI);
             const armWiggleX = Math.sin(t * 4 - depthPct * 5) * 15 * s * wiggleMask;
             const armWiggleY = Math.cos(t * 4 - depthPct * 5) * 10 * s * wiggleMask;

             currentX = baseX + armWiggleX;
             currentY = baseY + armWiggleY;
          }

          let ledAlpha = Math.min(1.0, alpha * 1.5);
          let ledSize = 4 * s; 

          if (on && chaseOffset >= 0 && chaseOffset !== -2) {
            // Per-effect chase behavior
            if (fx === 25) { // Chase — single tight group of 2 LEDs, no fade trail, background dim
              let distance = j - chaseOffset;
              if (distance < 0) distance += this.segmentsPerTentacle;
              if (distance < 2) {
                ledAlpha = 1.0 * brightnessFactor;
                ledSize = 6 * s;
              } else {
                ledAlpha = 0.06 * brightnessFactor;
              }
            } else if (fx === 28) { // Comet — bright head, long fading tail
              let distance = j - chaseOffset;
              if (distance < 0) distance += this.segmentsPerTentacle;
              if (distance < 1) {
                ledAlpha = 1.0 * brightnessFactor;
                ledSize = 7 * s;
              } else if (distance < 15) {
                ledAlpha = Math.max(0, (1.0 - (distance / 15))) * 0.9 * brightnessFactor;
                ledSize = (6 - distance * 0.2) * s;
              } else {
                ledAlpha = 0.03 * brightnessFactor;
              }
            } else if (fx === 76) { // Running — multiple evenly-spaced dots flowing as a wave
              const spacing = 6; // space between lit dots
              const wavePos = (chaseOffset + i * 2.5) % this.segmentsPerTentacle;
              // Multiple lit points spaced evenly
              let nearestDist = this.segmentsPerTentacle;
              for (let dot = 0; dot < 4; dot++) {
                const dotPos = (wavePos + dot * spacing) % this.segmentsPerTentacle;
                let d = Math.abs(j - dotPos);
                if (d > this.segmentsPerTentacle / 2) d = this.segmentsPerTentacle - d;
                nearestDist = Math.min(nearestDist, d);
              }
              if (nearestDist < 1) {
                ledAlpha = 1.0 * brightnessFactor;
                ledSize = 5 * s;
              } else if (nearestDist < 3) {
                ledAlpha = Math.max(0.1, (1.0 - nearestDist / 3)) * 0.7 * brightnessFactor;
              } else {
                ledAlpha = 0.12 * brightnessFactor;
              }
            }
          } else if (on && fx === 1) { // Blink — sharp on/off per segment
             const segBlink = (Math.floor(t * 2) + i + j) % 2 === 0 ? 1 : 0.1;
             ledAlpha = segBlink * brightnessFactor;
          } else if (on && fx === 32) {
             // Sparkle background: near black so the vibrant sparks pop
             ledAlpha = 0.04 * brightnessFactor;
          } else if (!on || chaseOffset === -1) {
             ledAlpha = Math.min(1.0, alpha * (1 - depthPct * (on ? 0.4 : 0.8)) * 1.5);
          }

          let drawR = r, drawG = g, drawB = b;
          if (on) {
             if (fx === 11) { // Rainbow — smooth wide gradient across all LEDs
                const hue = (t * 30 + j * 8 + i * 20) % 360;
                const C = 255;
                const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
                if(hue < 60) { drawR=C; drawG=X; drawB=0; }
                else if(hue < 120) { drawR=X; drawG=C; drawB=0; }
                else if(hue < 180) { drawR=0; drawG=C; drawB=X; }
                else if(hue < 240) { drawR=0; drawG=X; drawB=C; }
                else if(hue < 300) { drawR=X; drawG=0; drawB=C; }
                else { drawR=C; drawG=0; drawB=X; }
             } else if (fx === 9) { // Colorloop — fast discrete color blocks shifting
                const blockIdx = Math.floor((t * 8 + j * 0.6 + i * 3) % 6);
                const blockColors = [[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255]];
                [drawR, drawG, drawB] = blockColors[blockIdx];
             } else if (fx === 101) { // Pacifica
                const pctP = (Math.sin(t*1.5 - depthPct*3 + i) + 1) / 2;
                drawR = Math.round(62*(1-pctP) + 0*pctP);
                drawG = Math.round(229*(1-pctP) + 130*pctP);
                drawB = Math.round(153*(1-pctP) + 200*pctP);
             } else if (fx === 64) { // Plasmawave — red and blue
                const val = (Math.sin(t*2 - depthPct*5 + i*2) + 1)/2;
                drawR = Math.round(255*val);
                drawG = 0;
                drawB = Math.round(255*(1-val));
             } else if (fx === 72) { // Aurora — green to purple
                const hue = 120 + ((Math.sin(t + depthPct*2) + 1)/2) * 160; 
                const C = 255;
                const X = Math.round(C * (1 - Math.abs(((hue/60) % 2) - 1)));
                if(hue < 180) { drawR=0; drawG=C; drawB=X; }
                else if(hue < 240) { drawR=0; drawG=X; drawB=C; }
                else if(hue < 300) { drawR=X; drawG=0; drawB=C; }
                else { drawR=C; drawG=0; drawB=X; }
             } else if (fx === 45) { // Twinkle — random isolated sparkles
                const seed = Math.sin(j * 4321.7 + i * 123.4);
                const twinklePhase = (seed * 1000 + t * 2.5) % 6.28;
                const sparkle = Math.max(0, Math.sin(twinklePhase));
                if (sparkle > 0.92) {
                   drawR = Math.min(255, r + 180); drawG = Math.min(255, g + 180); drawB = Math.min(255, b + 180);
                   ledAlpha = 1.0 * brightnessFactor;
                   ledSize = 5.5 * s;
                } else if (sparkle > 0.7) {
                   ledAlpha *= 0.8;
                } else {
                   ledAlpha *= 0.35;
                }
             } else if (fx === 49) { // Dissolve — random groups fade in/out
                const groupId = Math.floor(j / 3) + i * 10;
                const dissolvePhase = (Math.sin(groupId * 73.1 + t * 3) + 1) / 2;
                ledAlpha *= dissolvePhase;
                if (dissolvePhase > 0.85) {
                   drawR = Math.min(255, r + 100); drawG = Math.min(255, g + 100); drawB = Math.min(255, b + 100);
                   ledSize = 5 * s;
                }
             } else if (fx === 3) { // Wipe — color reveal sweeping down with smooth edge
                const wipePos = ((t * 0.8) % 2.0);
                const wipeFront = wipePos;
                const edgeDist = depthPct - wipeFront;
                if (edgeDist > 0.08) {
                    ledAlpha = 0.03 * brightnessFactor;
                } else if (edgeDist > -0.03) {
                    // Bright leading edge
                    drawR = 255; drawG = 255; drawB = 255;
                    ledAlpha = 1.0 * brightnessFactor;
                    ledSize = 6 * s;
                } else {
                    // Already wiped — show full color
                    ledAlpha = alpha * (1 - depthPct * 0.3);
                }
             } else if (fx === 15) { // Ripple — radial expanding rings
                const rippleCenter = ((t * 2.5) % 1.5) - 0.2;
                const dist = Math.abs(depthPct - rippleCenter);
                if (dist < 0.06) {
                    drawR = Math.min(255, r + 160);
                    drawG = Math.min(255, g + 160);
                    drawB = Math.min(255, b + 160);
                    ledAlpha = 1.0 * brightnessFactor;
                    ledSize = 6 * s;
                } else if (dist < 0.15) {
                    const fade = 1.0 - ((dist - 0.06) / 0.09);
                    drawR = Math.min(255, Math.round(r + 80 * fade));
                    drawG = Math.min(255, Math.round(g + 80 * fade));
                    drawB = Math.min(255, Math.round(b + 80 * fade));
                    ledAlpha = alpha * (0.5 + 0.5 * fade);
                    ledSize = (4 + 1.5 * fade) * s;
                }
             } else if (fx === 2) { // Breathe — gentle fade per LED (staggered)
                const breathePhase = Math.sin(t * 1.2 - depthPct * 0.3 - i * 0.1);
                const breatheFactor = 0.2 + 0.8 * ((breathePhase + 1) / 2);
                drawR = Math.round(r * breatheFactor);
                drawG = Math.round(g * breatheFactor);
                drawB = Math.round(b * breatheFactor);
                ledAlpha = alpha * breatheFactor;
             } else if (fx === 28) { // Comet — bright head color shifts to white
                let distance = j - chaseOffset;
                if (distance < 0) distance += this.segmentsPerTentacle;
                if (distance < 2) {
                   drawR = 255; drawG = 255; drawB = 255;
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
        const hotWeatherActive =
         typeof WeatherFx !== 'undefined' &&
         typeof WeatherFx.getActiveState === 'function' &&
         WeatherFx.getActiveState() === 'heat';

        if (isBlinking) {
           blinkScale = 0.1; 
           emotion = 'blink';
        } else if (hotWeatherActive) {
           emotion = 'sweaty';
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
        } else if (emotion === 'sweaty') {
            // Tired, droopy eyes for hot weather (not angry)
            ctx.beginPath();
            ctx.moveTo(eyeDrawXLeft - 7*s, eyeDrawY - 1*s);
            ctx.quadraticCurveTo(eyeDrawXLeft, eyeDrawY + 3*s, eyeDrawXLeft + 7*s, eyeDrawY - 1*s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(eyeDrawXRight - 7*s, eyeDrawY - 1*s);
            ctx.quadraticCurveTo(eyeDrawXRight, eyeDrawY + 3*s, eyeDrawXRight + 7*s, eyeDrawY - 1*s);
            ctx.stroke();
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
        } else if (emotion === 'sweaty') {
            // Simple tired mouth for hot weather
            ctx.beginPath();
            ctx.moveTo(0 + eyeOffsetX - 4*s, eyeDrawY + 18*s);
            ctx.lineTo(0 + eyeOffsetX + 4*s, eyeDrawY + 18*s);
            ctx.lineWidth = 2.3*s;
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
        if (Date.now() < msgObj.expires) {
           // still active, keep alpha at 1.0 (or fade in)
        } else {
           msgObj.alpha = Math.max(0, msgObj.alpha - 0.05);
        }

        ctx.globalAlpha = msgObj.alpha;
        
        // Smaller font, line wrapping
        const fontSize = 12 * s;
        ctx.font = `500 ${fontSize}px Inter`;
        const padding = 14 * s;
        const lineSpacing = 6 * s;

        const lines = msgObj.lines;
        const longestLine = msgObj.longestLine;
        
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

      // Draw external weather accessories on top of mascot
      if (typeof WeatherFx !== 'undefined') {
          WeatherFx.drawAccessories(ctx, t, s, 0, eyeDrawY, eyeOffsetX, eyeOffsetY, { bellW, bellH, eyeSpacing });
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
    updateSpeechCache();
  }

  function frame() {
    t += 0.016;
    ctx.clearRect(0,0,w,h);

    if (typeof PartyFx !== 'undefined') {
      PartyFx.drawBackground(ctx, t, w, h);
    }
    
    // Calculate global scale standard for rendering elements proportionally
    const s = Math.min(w, h) / 500;
    
    // --- Underwater Effect ---
    const now = Date.now();
    if (now < underwaterEndTime) {
      const remaining = underwaterEndTime - now;
      let effectAlpha = 1.0;
      if (remaining < 2000) effectAlpha = remaining / 2000;
      else if (remaining > 9000) effectAlpha = (10000 - remaining) / 1000;
      
      ctx.save();
      ctx.globalAlpha = effectAlpha;
      
      // Deep sea gradient background
      const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h));
      grad.addColorStop(0, 'rgba(8, 25, 45, 0.4)');
      grad.addColorStop(1, 'rgba(2, 6, 12, 0.8)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      
      // Light rays (god rays) from top sweeping
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(100, 200, 255, 0.05)';
      ctx.beginPath();
      for (let ray of underwaterGodRays) {
        const topSweep = Math.sin(t * ray.speed) * 100;
        const botSweep = Math.cos(t * ray.speed * 0.8) * 120;
        
        ctx.moveTo(ray.topX + topSweep - ray.width/2, 0);
        ctx.lineTo(ray.topX + topSweep + ray.width/2, 0);
        ctx.lineTo(ray.topX + botSweep + ray.bottomXOffset + ray.width, h);
        ctx.lineTo(ray.topX + botSweep + ray.bottomXOffset - ray.width, h);
      }
      ctx.fill();

      // Fish swimming across
      ctx.globalCompositeOperation = 'source-over';
      for (let f of underwaterFish) {
         ctx.fillStyle = f.color;
         f.x += f.speed * f.dir;
         
         const fishY = f.y + Math.sin(t * 2 + f.wobbleOffset) * 10 * s;
         const tipX = f.x + (f.size * 2 * f.dir) * s;
         const tailX = f.x - (f.size * 1.5 * f.dir) * s;
         
         ctx.beginPath();
         // Fish body (simple tear shape)
         ctx.moveTo(tipX, fishY);
         ctx.quadraticCurveTo(f.x, fishY - f.size*s, tailX, fishY);
         ctx.quadraticCurveTo(f.x, fishY + f.size*s, tipX, fishY);
         ctx.fill();
         
         // Fish Tail fin
         const tailWag = Math.sin(t * 8 + f.wobbleOffset) * 4 * s;
         ctx.beginPath();
         ctx.moveTo(tailX, fishY);
         ctx.lineTo(tailX - (f.size * f.dir * 1.2)*s, fishY - f.size*s + tailWag);
         ctx.lineTo(tailX - (f.size * f.dir * 1.2)*s, fishY + f.size*s + tailWag);
         ctx.fill();
      }

      // Deep Sea Floor / Terrain Backdrop (3 Layers now for depth)
      ctx.globalCompositeOperation = 'source-over';
      
      // Layer 1: Darkest, furthest back mound
      ctx.fillStyle = 'rgba(2, 8, 16, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h - h * 0.12);
      ctx.quadraticCurveTo(w * 0.2, h - h * 0.25, w * 0.45, h - h * 0.12);
      ctx.quadraticCurveTo(w * 0.7, h, w, h - h * 0.18);
      ctx.lineTo(w, h);
      ctx.fill();

      // Layer 2: Mid-ground dark navy mounds
      ctx.fillStyle = 'rgba(6, 18, 32, 0.8)';
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h - h * 0.08);
      ctx.quadraticCurveTo(w * 0.35, h - h * 0.18, w * 0.6, h - h * 0.06);
      ctx.quadraticCurveTo(w * 0.85, h - h * 0.12, w, h - h * 0.05);
      ctx.lineTo(w, h);
      ctx.fill();
      
      // Layer 3: Foreground teal-tinged mounds
      ctx.fillStyle = 'rgba(12, 30, 50, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h - h * 0.03);
      ctx.bezierCurveTo(w * 0.2, h, w * 0.4, h - h * 0.12, w * 0.7, h - h * 0.04);
      ctx.quadraticCurveTo(w * 0.9, h, w, h - h * 0.08);
      ctx.lineTo(w, h);
      ctx.fill();

      // Branching Seafloor Corals / Kelp
      for (let c of underwaterCorals) {
        ctx.beginPath();
        const segH = c.height / c.segments;
        ctx.moveTo(c.x, c.baseY);
        let currX = c.x;
        let currY = c.baseY;
        
        let pathPoints = [{x: currX, y: currY}];
        
        for (let i = 1; i <= c.segments; i++) {
           const sway = Math.sin(t * c.swaySpeed + c.swayOffset + i * 0.5) * 12 * (i/c.segments);
           const nextX = c.x + sway;
           const nextY = c.baseY - (i * segH);
           
           ctx.quadraticCurveTo(currX, currY - segH/2, nextX, nextY);
           pathPoints.push({x: nextX, y: nextY});
           
           currX = nextX;
           currY = nextY;
        }

        ctx.strokeStyle = c.color;
        ctx.lineWidth = 12 * s;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        // Draw branches if this coral has them
        if (c.branches && c.branches.length > 0) {
           for (let br of c.branches) {
               // Find branch start point based on path
               const startIdx = Math.floor(br.startYPct * c.segments);
               const pt = pathPoints[Math.min(startIdx, pathPoints.length-1)];
               
               ctx.beginPath();
               ctx.moveTo(pt.x, pt.y);
               
               const branchLen = c.height * br.lengthPct;
               const sway = Math.sin(t * c.swaySpeed + br.swayOffset) * 8;
               
               const endX = pt.x + Math.sin(br.angle) * branchLen + sway;
               const endY = pt.y - Math.cos(br.angle) * branchLen;
               
               ctx.quadraticCurveTo(pt.x + Math.sin(br.angle) * (branchLen*0.5), pt.y - Math.cos(br.angle) * (branchLen*0.5), endX, endY);
               
               ctx.lineWidth = 8 * s;
               ctx.stroke();
           }
        }
        
        // Inner highlight for the main stalk
        ctx.beginPath();
        ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
        for(let i=1; i<pathPoints.length; i++) {
            ctx.quadraticCurveTo(pathPoints[i-1].x, pathPoints[i-1].y - segH/2, pathPoints[i].x, pathPoints[i].y);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 3 * s;
        ctx.stroke();
      }
      
      // Rising bubbles
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      for (let b of underwaterBubbles) {
        b.y -= b.v;
        const xOffset = Math.sin(t * b.wobbleSpeed + b.wobbleOffset) * 8;
        
        ctx.beginPath();
        ctx.arc(b.x + xOffset, b.y, b.s, 0, Math.PI * 2);
        ctx.fill();
        
        // respawn at bottom if hit top
        if (b.y < -10) {
          b.y = h + Math.random() * 20;
          b.x = Math.random() * w;
        }
      }
      ctx.restore();
    }
    
    jelly.draw();
    requestAnimationFrame(frame);
  }

  return { init: () => { window.addEventListener('resize', resize); resize(); requestAnimationFrame(frame); }, speak, setDrinking, setParty: (v) => jelly.setParty(v) };
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

  async function fetchWeather(loc, key, isManual = false) {
    if(!key) {
       showToast("Please set OpenWeather API Key in System Tab!");
       Log.err("Weather Error: API Key missing.");
       return;
    }
    if(!loc) return Log.warn('Weather sync skipped: Missing Location');

    // 1. Proactive feedback ONLY if NOT a manual user action (background automation)
    if (!isManual) {
       JellyfishRenderer.speak("Checking the sky... Updating weather data.");
    }

    try {
      const s = Settings.load();
      // ... (Thresholds logic same) ...
      const THRESHOLDS = [
        { min:35, col:hexToRgb(s.hc35), fx:s.fx35 !== undefined ? s.fx35 : 0, l:'High Heat' },
        { min:28, col:hexToRgb(s.hc28), fx:s.fx28 !== undefined ? s.fx28 : 0, l:'Warm' },
        { min:22, col:hexToRgb(s.hc22), fx:s.fx22 !== undefined ? s.fx22 : 0, l:'Pleasant' },
        { min:-99, col:hexToRgb(s.hc0), fx:s.fx0 !== undefined ? s.fx0 : 0, l:'Cool' }
      ];
      
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(loc)}&appid=${key}&units=metric`);
      const data = await res.json();
      if(!res.ok) {
        showToast(`Sync Failed: ${data.message}`);
        if (!isManual) JellyfishRenderer.speak("Hmm, I couldn't reach the weather API.");
        return;
      }
      
      document.getElementById('btn-widget-sync')?.classList.add('hidden');
      
      const t = data.main.temp, f = data.main.feels_like;
      const c = THRESHOLDS.find(x => f >= x.min) || THRESHOLDS[3];
      const wMain = data.weather[0]?.main || 'Clear';
      
      if (typeof WeatherFx !== 'undefined') {
         const weatherMain = String(wMain || '').toLowerCase();
         let weatherAnimState = 'pleasant';

         // Use actual weather condition first to avoid conflicting visuals.
         if (weatherMain === 'rain' || weatherMain === 'drizzle' || weatherMain === 'thunderstorm') {
           weatherAnimState = 'rain';
         } else if (weatherMain === 'snow') {
           weatherAnimState = 'cool';
         } else if (c.l === 'High Heat') {
           weatherAnimState = 'heat';
         } else if (c.l === 'Warm') {
           weatherAnimState = 'warm';
         } else if (c.l === 'Cool') {
           weatherAnimState = 'cool';
         }

         WeatherFx.setWeatherState(weatherAnimState, 8000);
      }
      
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

      if(el('gw-temp')) el('gw-temp').textContent = Math.round(t) + '°C';
      if(el('gw-feels')) el('gw-feels').textContent = 'Feels ' + Math.round(f) + '°C';
      if(el('gw-loc')) el('gw-loc').textContent = locAlias;
      if(el('gw-icon')) el('gw-icon').src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
      if(el('global-weather-widget')) el('global-weather-widget').className = `global-weather-widget wd-mode-${modeStr}`;

      Log.info(`Weather: ${data.name} - ${c.l}`);
      
      const weatherCol = getEffectColors(c.fx, c.col);
      WledApi.sendState({ on:true, bri:100, seg:[{id:0, fx:c.fx, col:weatherCol}], tt:20 });
      LampState.set(c.col, c.fx, 100, true);
      
      // 2. Final Results
      const desc = data.weather[0].description;
      const finalMsg = `Looks like ${desc} in ${data.name}. It feels like ${Math.round(f)}°C. Setting lights to ${c.l}.`;
      
      // If was automated, give the "checking" message some time to breathe otherwise it blinks away too fast
      if (!isManual) {
         setTimeout(() => JellyfishRenderer.speak(finalMsg), 3000);
      } else {
         JellyfishRenderer.speak(finalMsg);
      }
      
      showToast(`Weather updated`);

    } catch (e) { Log.err('Weather Fetch: ' + e.message); }
  }
  return { fetchWeather };
})();

/* ── Water Reminder ── */
let _restPayload = null;
let _hydrationSnapshot = null; // To store state before reminder

function triggerWaterReminder() {
  const s = Settings.load();
  const durationMs = s.waterDuration * 1000;
  const fx = s.waterFx !== undefined ? s.waterFx : 15;
  const col = s.waterColor ? hexToRgb(s.waterColor) : [0, 120, 255];
  const waterCol = getEffectColors(fx, col);

  Log.ok('Hydration sequence triggered.');
  
  // Capture current state before flashing
  _hydrationSnapshot = { ...LampState.get(), color: [...LampState.get().color] };

  WledApi.sendState({ on:true, bri:255, seg:[{id:0, fx:fx, sx:120, ix:200, pal:0, col:waterCol}], tt:5 });
  LampState.set(col, fx, 255, true);
  
  JellyfishRenderer.setDrinking(true);
  JellyfishRenderer.speak("Time to hydrate! Drink some water! 💧", durationMs);

  setTimeout(() => { 
    JellyfishRenderer.setDrinking(false);
    JellyfishRenderer.speak(''); // Clear the reminder message immediately
    
    // Return to the state captured before the reminder
    if (_hydrationSnapshot) {
      const { color, fx: prevFx, bri, on } = _hydrationSnapshot;
      const returnCol = getEffectColors(prevFx, color);
      const returnPayload = { on, bri, seg:[{id:0, fx:prevFx, col:returnCol}], tt:8 };
      
      WledApi.sendState(returnPayload);
      LampState.set(color, prevFx, bri, on);
      Log.info(`Hydration reminder ended. Returning to FX ${prevFx}`);
      _hydrationSnapshot = null;
    } else {
       // Fallback
       LampState.set([99,88,255], 0, 128, true);
       WledApi.sendState({ on:true, bri:128, seg:[{id:0, fx:0, col:[[99,88,255],[0,0,0],[0,0,0]]}], tt:10 });
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
function hueToRgb(hue) {
  const h = ((hue % 360) + 360) % 360;
  const C = 255;
  const X = Math.round(C * (1 - Math.abs(((h/60) % 2) - 1)));
  if(h < 60)  return [C, X, 0];
  if(h < 120) return [X, C, 0];
  if(h < 180) return [0, C, X];
  if(h < 240) return [0, X, C];
  if(h < 300) return [X, 0, C];
  return [C, 0, X];
}

/**
 * Returns the correct WLED col array for a given effect ID and user color.
 * Effects with predefined palettes (Plasmawave, Pacifica, Aurora) override
 * the user color so the WLED strip matches the jellyfish animation.
 */
function getEffectColors(fxId, userColor) {
  const uc = userColor || [99, 88, 255];
  switch (fxId) {
    case 64:  return [[255, 0, 0], [0, 0, 255], [0, 0, 0]];          // Plasmawave — red + blue
    case 101: return [[0, 200, 180], [62, 229, 153], [0, 80, 200]];  // Pacifica — ocean teal-green
    case 72:  return [[0, 255, 100], [130, 0, 255], [0, 200, 180]];  // Aurora — green + purple
    default:  return [uc, [0, 0, 0], [0, 0, 0]];                    // All others: user color
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let s = Settings.load();
  if (s.startupMode === 'rest') s.commMode = 'rest';
  else if (s.startupMode === 'mqtt') s.commMode = 'mqtt';
  
  // Pause networking until loader is done. The loader explicitly triggers 'lumina-loader-complete'
  window.addEventListener('lumina-loader-complete', () => {
    try { 
      WledApi.init(s, { source: 'startup' }); 
    } catch(e) { 
      console.error("WledApi INIT CRASH:", e);
      setTimeout(() => Log.err('System Error: ' + e.message), 1000); 
    }
  });

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
      handleLightingApply(); // Apply immediately on click
    });
    grid.appendChild(el);
  });

  // Sliders binding
  ['brightness','speed','intensity'].forEach(k => {
    const el = document.getElementById('sl-'+k);
    const val = document.getElementById('val-'+k);
    if(el && val) el.addEventListener('input', () => {
      val.textContent=el.value;
      // Update brightness preset active states when slider moves
      if (k === 'brightness') {
        document.querySelectorAll('.bri-preset-btn').forEach(btn => {
          btn.classList.toggle('active', parseInt(btn.dataset.bri) === parseInt(el.value));
        });
      }
    });
  });

  // Brightness preset buttons
  document.querySelectorAll('.bri-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bri = parseInt(btn.dataset.bri);
      const slider = document.getElementById('sl-brightness');
      const valEl = document.getElementById('val-brightness');
      if (slider) slider.value = bri;
      if (valEl) valEl.textContent = bri;
      document.querySelectorAll('.bri-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
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

  ['set-weather-interval','set-water-interval','set-water-duration'].forEach(id => {
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
  
  function handleLightingApply(showToastMsg = true) {
    const activeItem = document.querySelector('.fx-item.active');
    if (!activeItem) return;

    const fx = parseInt(activeItem.dataset.id || 0);
    const rgb = hexToRgb(document.getElementById('color-picker').value);
    const b = parseInt(document.getElementById('sl-brightness').value);
    const sp = parseInt(document.getElementById('sl-speed').value);
    const ix = parseInt(document.getElementById('sl-intensity').value);
    
    const col = getEffectColors(fx, rgb);
    
    const payload = { on:true, bri:b, seg:[{id:0, fx, sx:sp, ix, col}], tt:5 };
    WledApi.sendState(payload);
    LampState.set(rgb, fx, b, true);
    _restPayload = payload;
    
    if (showToastMsg) showToast('Applied Effect');
    Log.ok(`Applied FX ${fx} @ Bri ${b}`);
    JellyfishRenderer.speak("Ooh, pretty colors!");
  }

  document.getElementById('btn-apply-light')?.addEventListener('click', () => handleLightingApply(true));

  document.getElementById('btn-fetch-weather')?.addEventListener('click', () => {
    const liveLoc = document.getElementById('loc-input').value.trim();
    const liveKey = document.getElementById('sys-apikey-input') ? document.getElementById('sys-apikey-input').value.trim() : s.weatherApiKey;
    WeatherApi.fetchWeather(liveLoc, liveKey, true);
  });

  document.getElementById('btn-widget-sync')?.addEventListener('click', (e) => {
    const liveLoc = document.getElementById('loc-input').value.trim() || s.location;
    const liveKey = document.getElementById('sys-apikey-input') ? document.getElementById('sys-apikey-input').value.trim() : s.weatherApiKey;
    WeatherApi.fetchWeather(liveLoc, liveKey, true);
  });
  
  document.getElementById('preset-grid')?.addEventListener('click', (e) => {
    if(e.target.classList.contains('preset-btn')) {
      const loc = e.target.getAttribute('data-loc');
      const liveKey = document.getElementById('sys-apikey-input') ? document.getElementById('sys-apikey-input').value.trim() : s.weatherApiKey;
      const locInput = document.getElementById('loc-input');
      if (locInput) locInput.value = loc;
      WeatherApi.fetchWeather(loc, liveKey, true);
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
    const partyDurationMs = 11200;
    JellyfishRenderer.speak("RAVE MODE ACTIVATED! WOOOO!", 4000);
    JellyfishRenderer.setParty(true);
    if (typeof PartyFx !== 'undefined') PartyFx.start(partyDurationMs);
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
         JellyfishRenderer.setParty(false);
         setTimeout(() => {
             JellyfishRenderer.speak("Phew... I'm exhausted.", 5000);
             LampState.set([99,88,255], 0, 100, true);
             WledApi.sendState({ on:true, bri:100, seg:[{id:0, fx:0, col:[[99,88,255],[0,0,0],[0,0,0]]}], tt:10 });
         }, 800);
       }
    }, 400);
  });



  document.getElementById('btn-reset-loc')?.addEventListener('click', () => {
    const defaultLoc = document.getElementById('sys-loc-input') ? document.getElementById('sys-loc-input').value.trim() : s.location;
    const locInput = document.getElementById('loc-input');
    if (locInput) locInput.value = defaultLoc;
    const liveKey = document.getElementById('sys-apikey-input') ? document.getElementById('sys-apikey-input').value.trim() : s.weatherApiKey;
    WeatherApi.fetchWeather(defaultLoc, liveKey, true);
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

  // Weather Sync Dropdown & Color Apply Immediately
  const weatherMapGroups = [
    { id: '35', label: 'High Heat' },
    { id: '28', label: 'Warm' },
    { id: '22', label: 'Pleasant' },
    { id: '0',  label: 'Cool' }
  ];

  weatherMapGroups.forEach(group => {
    const fxSelect = document.getElementById(`fx-${group.id}`);
    const colorPicker = document.getElementById(`hc-${group.id}`);

    const applyIfCurrent = () => {
      const currentLevel = document.getElementById('wd-status')?.textContent;
      if (currentLevel === group.label) {
        const fx = parseInt(fxSelect.value);
        const col = hexToRgb(colorPicker.value);
        const wCol = getEffectColors(fx, col);
        
        WledApi.sendState({ on:true, bri:100, seg:[{id:0, fx, col:wCol}], tt:10 });
        LampState.set(col, fx, 100, true);
        
        // Update indicator UI
        const badge = document.getElementById('wd-lmi-badge');
        if (badge) {
          badge.style.background = `rgb(${col.join(',')})`;
          badge.style.boxShadow = `0 0 10px rgb(${col.join(',')})`;
        }
        const label = document.getElementById('wd-lmi-label');
        if (label) {
          const fxName = WLED_FX.find(x => x.id === fx)?.name || 'Solid';
          label.textContent = `Effect: ${fxName}`;
        }
        Log.info(`Immediate Weather Apply: ${group.label} → FX ${fx}`);
      }
      
      // Save changes immediately to memory
      s[`fx${group.id}`] = parseInt(fxSelect.value);
      s[`hc${group.id}`] = colorPicker.value;
      Settings.save(s);
    };

    fxSelect?.addEventListener('change', applyIfCurrent);
    colorPicker?.addEventListener('input', applyIfCurrent);
  });

  // Hydration Selector Save (No Immediate Preview overlay)
  const waterFxSelect = document.getElementById('water-fx');
  const waterColorPicker = document.getElementById('water-color');
  if (waterFxSelect && waterColorPicker) {
    const applyWaterSettings = () => {
      s.waterFx = parseInt(waterFxSelect.value) || 0;
      s.waterColor = waterColorPicker.value;
      Settings.save(s);
      
      Log.info('Saved Hydration Setting: FX ' + s.waterFx);
      // Wait for the trigger or interval to actually apply/preview it 
      // so we don't accidentally overwrite the active Weather Sync state.
    };
    waterFxSelect.addEventListener('change', applyWaterSettings);
    waterColorPicker.addEventListener('input', applyWaterSettings);
  }

  // --- Reset Effects to Default ---
  document.getElementById('btn-reset-effects')?.addEventListener('click', () => {
    s = Settings.resetEffects();
    syncForms();
    Scheduler.restart(s);
    showToast('Effects & Intervals Reset to Default');
    Log.info('Effects resetting to defaults');
    
    // Auto-fetch weather to immediate apply the restored default colors
    document.getElementById('btn-fetch-weather')?.click();
  });

  // Payload Injector logic
  const jsonInput = document.getElementById('pi-json-input');
  
  document.getElementById('btn-fill-red')?.addEventListener('click', () => {
    jsonInput.value = '{"on": true, "seg": [{"col": [[255, 0, 0]]}]}';
  });
  document.getElementById('btn-fill-blink')?.addEventListener('click', () => {
    jsonInput.value = '{"on": true, "seg": [{"fx": 1, "sx": 128}]}';
  });
  document.getElementById('btn-fill-sample')?.addEventListener('click', () => {
    jsonInput.value = JSON.stringify({
      on: true,
      bri: 255,
      tt: 10,
      seg: [{
        id: 0,
        fx: 2,
        sx: 128,
        ix: 128,
        col: [[99, 88, 255], [0, 0, 0], [0, 0, 0]]
      }]
    }, null, 2);
  });

  document.getElementById('btn-send-payload')?.addEventListener('click', () => {
    const raw = jsonInput.value.trim();
    if (!raw) return;
    
    try {
      const p = JSON.parse(raw);
      WledApi.sendState(p);
      
      // Synchronize Jellyfish Mascot with the injected payload
      const curr = LampState.get();
      const on = p.on !== undefined ? p.on : curr.on;
      const bri = p.bri !== undefined ? p.bri : curr.bri;
      let fx = curr.fx;
      let col = curr.color;
      
      // Heuristic extraction from WLED JSON structure
      if (p.seg && Array.isArray(p.seg) && p.seg[0]) {
        const s0 = p.seg[0];
        if (s0.fx !== undefined) fx = s0.fx;
        if (s0.col && Array.isArray(s0.col) && s0.col[0]) col = s0.col[0];
      } else {
        if (p.fx !== undefined) fx = p.fx;
        // Handle top-level 'col' if present (some API versions use this)
        if (p.col && Array.isArray(p.col) && p.col[0]) col = p.col[0];
      }

      LampState.set(col, fx, bri, on);
      JellyfishRenderer.speak("Manual payload override active!");
      
      Log.info('Raw payload injected & mascot synced');
      showToast('Payload Sent!');
    } catch (e) {
      Log.err('Invalid JSON format');
      showToast('Invalid JSON structure');
    }
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
    
    if(ok) { LampState.set(undefined, undefined, undefined, true); JellyfishRenderer.speak("Connected to target!"); }
    else JellyfishRenderer.speak("I can't see the lamp...");
    
    Log[ok?'ok':'err'](ok?'Ping successful':'Ping failed. Device offline.');
  });

  // Info Modal Logic
  const infoModal = document.getElementById('info-modal');
  document.getElementById('btn-open-info')?.addEventListener('click', () => {
    infoModal?.classList.remove('hidden');
  });
  [document.getElementById('btn-close-info'), document.getElementById('btn-info-ok')].forEach(btn => {
    btn?.addEventListener('click', () => infoModal?.classList.add('hidden'));
  });
  infoModal?.addEventListener('click', (e) => {
    if (e.target === infoModal) infoModal.classList.add('hidden');
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
    
    Log.info('Lumina System Boot Sequence Complete');
    JellyfishRenderer.speak("Hello there! I'm your Lumina companion.");
  }, 500);
});
