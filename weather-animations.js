class WeatherAnimations {
  constructor() {
    this.currentWeather = 'pleasant';
    this.activeUntil = 0;
    this.durationMs = 8000;
  }

  setWeatherState(state, durationMs = this.durationMs) {
    this.currentWeather = state;
    this.durationMs = durationMs;
    this.activeUntil = Date.now() + durationMs;
  }

  getActiveState(now = Date.now()) {
    if (now >= this.activeUntil) return null;
    return this.currentWeather;
  }

  getEffectAlpha(now = Date.now()) {
    if (now >= this.activeUntil) return 0;
    const timeLeft = this.activeUntil - now;
    const elapsed = this.durationMs - timeLeft;
    const fadeIn = Math.min(1, elapsed / 450);
    const fadeOut = Math.min(1, timeLeft / 800);
    return Math.max(0, Math.min(fadeIn, fadeOut));
  }

  getFanHoldPoint(t, s, bellW, bellH) {
    const fanBob = Math.sin(t * 3.0) * 6 * s;
    return {
      x: -bellW * 1.8,
      y: bellH * 1.2 + fanBob
    };
  }

  drawAccessories(ctx, t, s, cx, cy, eyeOffsetX, eyeOffsetY, meta = {}) {
    const activeState = this.getActiveState();
    if (!activeState) return;

    const fxAlpha = this.getEffectAlpha();
    if (fxAlpha <= 0) return;

    const bellW = meta.bellW || 85 * s;
    const bellH = meta.bellH || 80 * s;
    const eyeSpacing = meta.eyeSpacing || bellW * 0.35;

    ctx.save();
    ctx.globalAlpha *= fxAlpha;

    if (activeState === 'heat') {
      this.drawFan(ctx, t, s, bellW, bellH);
      this.drawFanBreeze(ctx, t, s, bellW, bellH);
      this.drawSweat(ctx, t, s, cx, eyeOffsetX, eyeOffsetY);
      this.drawHeatWave(ctx, t, s);
    } else if (activeState === 'warm') {
      this.drawSunglasses(ctx, s, cx, cy, eyeSpacing, eyeOffsetX);
      this.drawWarmBlush(ctx, t, s, eyeSpacing, eyeOffsetX, cy);
    } else if (activeState === 'cool') {
      this.drawSnowflakes(ctx, t, s);
      this.drawSnowMist(ctx, t, s, cx, cy, eyeOffsetX);
    } else if (activeState === 'rain') {
      this.drawRainDrizzle(ctx, t, s);
    } else if (activeState === 'pleasant') {
      this.drawPleasantParticles(ctx, t, s);
    }

    ctx.restore();
  }

  drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawFan(ctx, t, s, bellW, bellH) {
    const hold = this.getFanHoldPoint(t, s, bellW, bellH);
    ctx.save();
    ctx.translate(hold.x, hold.y);

    // Fan handle
    ctx.fillStyle = '#9aa2aa';
    this.drawRoundedRect(ctx, -4 * s, 8 * s, 8 * s, 34 * s, 2 * s);
    ctx.fill();

    // Outer fan cage
    ctx.beginPath();
    ctx.arc(0, -10 * s, 24 * s, 0, Math.PI * 2);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = 'rgba(220, 230, 245, 0.95)';
    ctx.stroke();

    // Fan blades
    ctx.save();
    ctx.translate(0, -10 * s);
    ctx.rotate(t * 20);
    for (let i = 0; i < 4; i++) {
      ctx.rotate((Math.PI * 2) / 4);
      ctx.beginPath();
      ctx.ellipse(0, -9 * s, 5 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(110, 206, 255, 0.72)';
      ctx.fill();
    }
    ctx.restore();

    // Hub
    ctx.beginPath();
    ctx.arc(0, -10 * s, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 248, 255, 1)';
    ctx.fill();

    ctx.restore();
  }

  drawFanBreeze(ctx, t, s, bellW, bellH) {
    const hold = this.getFanHoldPoint(t, s, bellW, bellH);
    ctx.strokeStyle = 'rgba(175, 228, 255, 0.28)';
    ctx.lineWidth = 1.8 * s;

    for (let i = 0; i < 3; i++) {
      const yBase = hold.y - (12 + i * 8) * s;
      ctx.beginPath();
      ctx.moveTo(hold.x + 26 * s, yBase);
      ctx.bezierCurveTo(
        hold.x + 42 * s,
        yBase - 4 * s + Math.sin(t * 5 + i) * 2 * s,
        hold.x + 68 * s,
        yBase + 2 * s + Math.cos(t * 4 + i) * 2 * s,
        hold.x + 88 * s,
        yBase - 1 * s
      );
      ctx.stroke();
    }
  }

  drawSweat(ctx, t, s, cx, eyeOffsetX, eyeOffsetY) {
    const headTopY = -72 * s;
    const dropA = (t * 26) % (52 * s);
    const dropB = ((t * 22) + 19) % (45 * s);

    ctx.fillStyle = 'rgba(155, 225, 255, 0.85)';

    ctx.beginPath();
    ctx.arc(cx - 30 * s + eyeOffsetX, headTopY + dropA + eyeOffsetY, 3.7 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx + 20 * s + eyeOffsetX, headTopY + 10 * s + dropB + eyeOffsetY, 2.9 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  drawHeatWave(ctx, t, s) {
    ctx.strokeStyle = 'rgba(255, 195, 130, 0.22)';
    ctx.lineWidth = 2.1 * s;

    for (let i = 0; i < 4; i++) {
      const x = (-62 + i * 40) * s;
      const y = (-136 + i * 3) * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x + 10 * s,
        y - 10 * s + Math.sin(t * 2.4 + i) * 4 * s,
        x - 10 * s,
        y - 20 * s + Math.cos(t * 2.1 + i) * 4 * s,
        x,
        y - 34 * s
      );
      ctx.stroke();
    }
  }

  drawSunglasses(ctx, s, cx, cy, eyeSpacing, eyeOffsetX) {
    const centerX = cx + eyeOffsetX;
    const centerY = cy;
    const lensW = 23 * s;
    const lensH = 19 * s;

    ctx.save();
    ctx.translate(centerX, centerY);

    const glassGrad = ctx.createLinearGradient(0, -lensH, 0, lensH);
    glassGrad.addColorStop(0, 'rgba(36, 40, 60, 0.96)');
    glassGrad.addColorStop(1, 'rgba(8, 10, 18, 0.99)');

    this.drawRoundedRect(ctx, -eyeSpacing - lensW / 2, -lensH / 2, lensW, lensH, 5 * s);
    ctx.fillStyle = glassGrad;
    ctx.fill();

    this.drawRoundedRect(ctx, eyeSpacing - lensW / 2, -lensH / 2, lensW, lensH, 5 * s);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-eyeSpacing + lensW / 2 - 1.5 * s, 0);
    ctx.lineTo(eyeSpacing - lensW / 2 + 1.5 * s, 0);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = 'rgba(20, 24, 34, 0.95)';
    ctx.stroke();

    // Lens highlight
    ctx.strokeStyle = 'rgba(180, 225, 255, 0.33)';
    ctx.lineWidth = 1.3 * s;
    ctx.beginPath();
    ctx.moveTo(-eyeSpacing - lensW / 2 + 4 * s, -4 * s);
    ctx.lineTo(-eyeSpacing + lensW / 2 - 4 * s, -6 * s);
    ctx.moveTo(eyeSpacing - lensW / 2 + 4 * s, -6 * s);
    ctx.lineTo(eyeSpacing + lensW / 2 - 4 * s, -4 * s);
    ctx.stroke();

    ctx.restore();
  }

  drawWarmBlush(ctx, t, s, eyeSpacing, eyeOffsetX, eyeY) {
    const pulse = 0.14 + 0.08 * ((Math.sin(t * 3.1) + 1) / 2);
    ctx.fillStyle = `rgba(255, 140, 170, ${pulse})`;
    ctx.beginPath();
    ctx.ellipse(-eyeSpacing + eyeOffsetX, eyeY + 10 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(eyeSpacing + eyeOffsetX, eyeY + 10 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRainDrizzle(ctx, t, s) {
    ctx.strokeStyle = 'rgba(166, 214, 255, 0.42)';
    ctx.lineWidth = 1.5 * s;

    for (let i = 0; i < 16; i++) {
      const x = (-130 + i * 16) * s + Math.sin(t * 0.8 + i) * 4 * s;
      const travel = (t * 70 + i * 18) % (250 * s);
      const y = -150 * s + travel;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4 * s, y + 11 * s);
      ctx.stroke();
    }
  }

  drawSnowflakes(ctx, t, s) {
    ctx.strokeStyle = 'rgba(230, 245, 255, 0.78)';
    ctx.lineWidth = 1.4 * s;

    for (let i = 0; i < 15; i++) {
      const x = (-140 + ((i * 21) % 280)) * s + Math.sin(t * 0.9 + i) * 8 * s;
      const travel = (t * 32 + i * 26) % (245 * s);
      const y = -155 * s + travel;
      const size = (2.1 + (i % 4) * 0.7) * s;

      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
      ctx.moveTo(x - size * 0.7, y - size * 0.7);
      ctx.lineTo(x + size * 0.7, y + size * 0.7);
      ctx.moveTo(x + size * 0.7, y - size * 0.7);
      ctx.lineTo(x - size * 0.7, y + size * 0.7);
      ctx.stroke();
    }
  }

  drawSnowMist(ctx, t, s, cx, cy, eyeOffsetX) {
    const mistPulse = 0.1 + 0.12 * ((Math.sin(t * 2.8) + 1) / 2);
    const mistX = cx + eyeOffsetX;
    const mistY = cy + 18 * s;

    for (let i = 0; i < 3; i++) {
      const drift = Math.sin(t * 1.3 + i * 0.8) * 7 * s;
      const spread = (12 + i * 7) * s;
      const grad = ctx.createRadialGradient(
        mistX + drift,
        mistY - i * 8 * s,
        1,
        mistX + drift,
        mistY - i * 8 * s,
        spread
      );
      grad.addColorStop(0, `rgba(228, 246, 255, ${mistPulse})`);
      grad.addColorStop(1, 'rgba(228, 246, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(
        mistX + drift,
        mistY - i * 8 * s,
        spread,
        (7 + i * 2) * s,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  drawPleasantParticles(ctx, t, s) {
    for (let i = 0; i < 11; i++) {
      const ang = t * 0.78 + i * ((Math.PI * 2) / 11);
      const rx = (82 + Math.sin(t * 0.7 + i) * 8) * s;
      const ry = (44 + Math.cos(t * 0.85 + i) * 5) * s;
      const x = Math.cos(ang) * rx;
      const y = -34 * s + Math.sin(ang * 1.25) * ry;
      const pulse = 0.22 + 0.5 * ((Math.sin(t * 2.2 + i) + 1) / 2);
      const size = (2.2 + (i % 4) * 0.7) * s;

      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(186, 240, 255, ${pulse})`;
      ctx.fill();
    }
  }
}

const WeatherFx = new WeatherAnimations();