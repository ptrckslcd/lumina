class PartyModeEffects {
  constructor() {
    this.activeUntil = 0;
    this.durationMs = 0;
    this.confetti = [];
    this.lights = [];
    this.cachedW = 0;
    this.cachedH = 0;
  }

  start(durationMs = 11200) {
    this.durationMs = durationMs;
    this.activeUntil = Date.now() + durationMs;
  }

  stop() {
    this.activeUntil = 0;
  }

  isActive(now = Date.now()) {
    return now < this.activeUntil;
  }

  getAlpha(now = Date.now()) {
    if (!this.isActive(now)) return 0;
    const timeLeft = this.activeUntil - now;
    const elapsed = this.durationMs - timeLeft;
    const fadeIn = Math.min(1, elapsed / 500);
    const fadeOut = Math.min(1, timeLeft / 900);
    return Math.max(0, Math.min(fadeIn, fadeOut));
  }

  ensureScene(w, h) {
    if (this.cachedW === w && this.cachedH === h && this.confetti.length > 0) return;

    this.cachedW = w;
    this.cachedH = h;

    this.lights = [];
    for (let i = 0; i < 6; i++) {
      this.lights.push({
        x: w * (0.1 + i * 0.16),
        hue: Math.floor(Math.random() * 360),
        speed: 0.6 + Math.random() * 0.7,
        width: w * (0.08 + Math.random() * 0.06)
      });
    }

    this.confetti = [];
    const confettiCount = Math.floor(Math.max(80, Math.min(180, w * h / 9000)));
    for (let i = 0; i < confettiCount; i++) {
      this.confetti.push({
        x: Math.random() * w,
        y: Math.random() * h,
        w: 3 + Math.random() * 5,
        h: 5 + Math.random() * 9,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.12,
        fall: 0.5 + Math.random() * 1.6,
        swaySpeed: 0.5 + Math.random() * 1.6,
        swayAmp: 4 + Math.random() * 10,
        hue: Math.floor(Math.random() * 360)
      });
    }
  }

  drawBackground(ctx, t, w, h) {
    const now = Date.now();
    if (!this.isActive(now)) return;

    this.ensureScene(w, h);

    const alpha = this.getAlpha(now);
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha *= alpha;

    // Club room atmosphere
    const roomGrad = ctx.createLinearGradient(0, 0, 0, h);
    roomGrad.addColorStop(0, "rgba(9, 8, 20, 0.86)");
    roomGrad.addColorStop(0.55, "rgba(16, 12, 32, 0.78)");
    roomGrad.addColorStop(1, "rgba(5, 4, 14, 0.92)");
    ctx.fillStyle = roomGrad;
    ctx.fillRect(0, 0, w, h);

    // Dance floor glow
    const floorGrad = ctx.createLinearGradient(0, h * 0.58, 0, h);
    floorGrad.addColorStop(0, "rgba(180, 90, 255, 0)");
    floorGrad.addColorStop(1, "rgba(180, 90, 255, 0.25)");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, h * 0.58, w, h * 0.42);

    // Ceiling truss strip lights
    ctx.fillStyle = "rgba(210, 220, 255, 0.2)";
    ctx.fillRect(w * 0.06, h * 0.07, w * 0.88, 2);

    // Sweeping club beams
    ctx.globalCompositeOperation = "screen";
    for (const light of this.lights) {
      const beamOffset = Math.sin(t * light.speed) * (w * 0.09);
      const beamX = light.x + beamOffset;
      const beamHue = (light.hue + t * 55) % 360;
      const beamCol = `hsla(${beamHue}, 98%, 70%, 0.18)`;

      ctx.beginPath();
      ctx.moveTo(beamX - light.width * 0.25, h * 0.08);
      ctx.lineTo(beamX + light.width * 0.25, h * 0.08);
      ctx.lineTo(beamX + light.width * 1.1, h);
      ctx.lineTo(beamX - light.width * 1.1, h);
      ctx.closePath();
      ctx.fillStyle = beamCol;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(beamX, h * 0.08, 5, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${beamHue}, 98%, 75%, 0.7)`;
      ctx.fill();
    }

    // Simple equalizer bars in background
    ctx.globalCompositeOperation = "source-over";
    const bars = 18;
    const barW = w / (bars * 2.2);
    for (let i = 0; i < bars; i++) {
      const bx = w * 0.08 + i * (barW * 1.2);
      const barPulse = (Math.sin(t * 7 + i * 0.8) + 1) / 2;
      const bh = (h * 0.08) + barPulse * (h * 0.1);
      const hue = (i * 20 + t * 60) % 360;
      ctx.fillStyle = `hsla(${hue}, 85%, 62%, 0.3)`;
      ctx.fillRect(bx, h * 0.9 - bh, barW, bh);
    }

    // Confetti
    for (const c of this.confetti) {
      c.y += c.fall;
      c.rot += c.rotSpeed;
      const x = c.x + Math.sin(t * c.swaySpeed + c.rot) * c.swayAmp;

      if (c.y > h + 16) {
        c.y = -12 - Math.random() * 40;
        c.x = Math.random() * w;
      }

      ctx.save();
      ctx.translate(x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = `hsla(${c.hue}, 95%, 63%, 0.85)`;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }

    ctx.restore();
  }
}

const PartyFx = new PartyModeEffects();
