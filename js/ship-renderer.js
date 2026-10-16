// Shared game and tuning-preview rendering. Animation state is supplied by the caller.
export function drawPlayerShield(ctx, p, beatPulse, tuning, shieldRotation = 0, now = performance.now()) {
    const hpRatio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    let shieldHue = 185;
    if (hpRatio > 0.65) {
      shieldHue = 165 + (hpRatio - 0.65) * 65;
    } else if (hpRatio > 0.32) {
      shieldHue = 38 + ((hpRatio - 0.32) / 0.33) * 85;
    } else {
      shieldHue = 348;
    }

    const baseRadius = p.radius * (tuning.shieldRadiusMult ?? 2.55) + beatPulse * 3.2;
    const thickMult = tuning.shieldThicknessMult ?? 0.3;
    const coreThickness = (1.6 + hpRatio * 4.2) * thickMult;
    const glowThickness = (5.0 + hpRatio * 10.5 + beatPulse * 3) * thickMult;
    const dangerPulse = hpRatio < 0.32 ? 0.55 + Math.sin(now * 0.02) * 0.35 : 1.0;

    ctx.save();
    ctx.translate(p.x, p.y);

    const grad = ctx.createRadialGradient(0, 0, p.radius * 0.4, 0, 0, baseRadius);
    grad.addColorStop(0, `hsla(${shieldHue}, 100%, 60%, 0.03)`);
    grad.addColorStop(0.75, `hsla(${shieldHue}, 100%, 60%, ${0.08 + hpRatio * 0.1})`);
    grad.addColorStop(1, `hsla(${shieldHue}, 100%, 70%, ${0.24 * dangerPulse})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `hsla(${shieldHue}, 100%, 58%, ${(0.22 + hpRatio * 0.28) * dangerPulse})`;
    ctx.lineWidth = glowThickness;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
    ctx.stroke();

    const startAngle = -Math.PI * 0.5 + Math.sin(shieldRotation * 0.5) * 0.2;
    const endAngle = startAngle + Math.PI * 2 * Math.max(0.08, hpRatio);
    ctx.strokeStyle = `hsla(${shieldHue}, 100%, 78%, ${0.92 * dangerPulse})`;
    ctx.lineWidth = coreThickness;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius, startAngle, endAngle);
    ctx.stroke();

    const nodeCount = 4;
    for (let i = 0; i < nodeCount; i++) {
      const na = shieldRotation + (i * Math.PI * 2) / nodeCount;
      const nx = Math.cos(na) * baseRadius;
      const ny = Math.sin(na) * baseRadius;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(nx, ny, 1.5 + hpRatio * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

export function drawCrabShip(ctx, p, tuning, drilling = false, now = performance.now()) {
    const r = p.radius;
    const flashAlpha = p.invuln > 0 && Math.floor(now / 50) % 2 === 0 ? 0.45 : 1;
    const drillScale = p.stats.drillScale || 1.0;

    const carapaceCol = tuning.carapaceColor || '#00f3ff';
    const innerCol = tuning.innerArmorColor || '#00ffaa';
    const drillIdleCol = tuning.drillIdleColor || '#00f3ff';
    const drillActiveCol = tuning.drillActiveColor || '#00ffaa';
    const drillJawCol = tuning.drillJawColor || '#ffcc00';

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = flashAlpha;

    // 1. Rotate Crab Body, Legs & Twin Drill-Claws along p.drillAngle
    ctx.save();
    ctx.rotate(p.drillAngle ?? p.angle);

    // 1a. Six Geometric Scuttling Crab Legs (3 Left, 3 Right)
    const legOffsets = [-0.42, 0.0, 0.42];
    ctx.strokeStyle = carapaceCol;
    ctx.lineWidth = 2.2;
    for (let side = -1; side <= 1; side += 2) {
      for (let l = 0; l < 3; l++) {
        const scutt = Math.sin((p.walkCycle || 0) + l * 2.1 + (side > 0 ? Math.PI : 0)) * 2.4;
        const baseX = legOffsets[l] * r * 0.85;
        const baseY = side * r * 0.88;
        const kneeX = baseX - r * 0.15 + scutt * 0.6;
        const kneeY = side * r * 1.42;
        const tipX = baseX - r * 0.48 + scutt;
        const tipY = side * r * 1.72;

        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
    }

    // 1b. Wide Geometric Crab Carapace (Hexagonal Armored Shell)
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? carapaceCol : '#ffffff';
      ctx.globalAlpha = (pass === 0 ? 0.65 : 1.0) * flashAlpha;
      ctx.lineWidth = pass === 0 ? 6.5 : 2.5;

      ctx.beginPath();
      ctx.moveTo(r * 0.78, -r * 0.55);   // Front-left brow
      ctx.lineTo(r * 0.25, -r * 1.12);   // Wide left carapace wing
      ctx.lineTo(-r * 0.68, -r * 0.88);  // Rear-left corner
      ctx.lineTo(-r * 0.92, 0);          // Rear thruster tail
      ctx.lineTo(-r * 0.68, r * 0.88);   // Rear-right corner
      ctx.lineTo(r * 0.25, r * 1.12);    // Wide right carapace wing
      ctx.lineTo(r * 0.78, r * 0.55);    // Front-right brow
      ctx.lineTo(r * 0.92, 0);           // Front rostrum nose
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = flashAlpha;

    // Inner Carapace Armor Facets
    ctx.strokeStyle = innerCol;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(r * 0.52, -r * 0.35);
    ctx.lineTo(-r * 0.45, -r * 0.52);
    ctx.lineTo(-r * 0.62, 0);
    ctx.lineTo(-r * 0.45, r * 0.52);
    ctx.lineTo(r * 0.52, r * 0.35);
    ctx.closePath();
    ctx.stroke();

    // 1c. Twin Front Crab Pincer Arms + Spinning Conical Rotary Drills!
    const drillSpin = p.drillSpin || 0;
    const drillColor = drilling ? drillActiveCol : drillIdleCol;
    const drillCoreColor = drilling ? '#ffffff' : '#b8fff0';

    for (let side = -1; side <= 1; side += 2) {
      ctx.save();
      // Shoulder joint at front corners of the crab carapace
      const shoulderX = r * 0.62;
      const shoulderY = side * r * 0.76;
      const elbowX = r * 1.15;
      const elbowY = side * r * 1.05;

      // Articulated Crab Claw Arm
      ctx.strokeStyle = carapaceCol;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(elbowX, elbowY);
      ctx.stroke();

      // Translate to the Claw's Rotary Drill Mount at the front pincer position
      const vibrateX = drilling ? (Math.random() - 0.5) * 2.4 : 0;
      const vibrateY = drilling ? (Math.random() - 0.5) * 2.4 : 0;
      const clawX = r * 1.42 + vibrateX;
      const clawY = side * r * 0.78 + vibrateY;

      ctx.translate(clawX, clawY);
      // Angle the two crab drill-claws slightly inward like pincers (pinching tighter when drilling!)
      const pinchAngle = -side * (drilling ? 0.28 : 0.16);
      ctx.rotate(pinchAngle);
      ctx.scale(drillScale, drillScale);

      // Outer Crab Pincer Jaw Brackets framing the drill
      ctx.strokeStyle = drilling ? drillJawCol : innerCol;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-4, -7.5);
      ctx.lineTo(4, -8.5);
      ctx.moveTo(-4, 7.5);
      ctx.lineTo(4, 8.5);
      ctx.stroke();

      // Conical Rotary Drill Bit Outline (Base at x=0, sharp drill point at x=16)
      const drillLen = 16.5;
      const drillHalfW = 6.2;

      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? drillColor : drillCoreColor;
        ctx.lineWidth = pass === 0 ? 4.8 : 2.0;
        ctx.beginPath();
        ctx.moveTo(drillLen, 0);               // Sharp rotary drill tip
        ctx.lineTo(0, -drillHalfW);            // Upper drill base
        ctx.lineTo(-3.5, 0);                   // Rear spindle hub
        ctx.lineTo(0, drillHalfW);             // Lower drill base
        ctx.closePath();
        ctx.stroke();
      }

      // Animated Spinning Helical Drill Threads inside the cone!
      ctx.strokeStyle = drilling ? drillJawCol : innerCol;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (let t = 0; t < 3; t++) {
        // Scroll threads from base (0) to tip (1) as the drill spins
        const phase = ((drillSpin * 0.35 + t / 3) % 1 + 1) % 1;
        const tx = phase * (drillLen - 2);
        const halfSpan = drillHalfW * (1 - phase);
        ctx.moveTo(tx, -halfSpan);
        ctx.lineTo(tx + 2.2, halfSpan);
      }
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore(); // End Crab Body & Drill-Claw orientation

    // 2. Central 360° Rotating Plasma Blaster Turret (aims toward p.angle)
    ctx.save();
    ctx.rotate(p.angle);

    ctx.strokeStyle = carapaceCol;
    ctx.lineWidth = 2.2;
    // Twin Turret Barrels
    ctx.beginPath();
    ctx.moveTo(2, -3.5);
    ctx.lineTo(r * 0.95, -3.5);
    ctx.moveTo(2, 3.5);
    ctx.lineTo(r * 0.95, 3.5);
    ctx.stroke();

    // Central Diamond Turret Hub
    ctx.fillStyle = '#051024';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(r * 0.45, 0);
    ctx.lineTo(0, -r * 0.38);
    ctx.lineTo(-r * 0.38, 0);
    ctx.lineTo(0, r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

