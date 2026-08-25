"use client";

/**
 * Dependency-free canvas confetti burst + reduced-motion detection.
 * The canvas mounts itself, animates ~2.6 s, then removes itself.
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

const COLORS = ["#F0C75E", "#34D399", "#8B5CF6", "#ffffff", "#E05252", "#4C9BE6"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  life: number;
}

export function fireConfetti(): void {
  if (typeof document === "undefined" || prefersReducedMotion()) return;

  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70";
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  // Two cannons from the lower corners, angled inward.
  const particles: Particle[] = [];
  for (let i = 0; i < 90; i++) spawn(particles, w * 0.08, h * 0.85, -0.35);
  for (let i = 0; i < 90; i++) spawn(particles, w * 0.92, h * 0.85, Math.PI + 0.35);

  const start = performance.now();
  let raf = 0;

  const tick = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    let alive = false;
    for (const p of particles) {
      p.life -= 1;
      if (p.life <= 0) continue;
      alive = true;
      p.vy += 0.18; // gravity
      p.vx *= 0.99; // drag
      p.vy *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;

      const alpha = Math.min(1, p.life / 40);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (alive && t < 3000) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(tick);
}

function spawn(out: Particle[], x: number, y: number, baseAngle: number): void {
  const speed = 7 + Math.random() * 9;
  const angle = baseAngle + (Math.random() - 0.5) * 0.9;
  out.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 6 - Math.random() * 5,
    size: 6 + Math.random() * 7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    life: 110 + Math.random() * 60,
  });
}
