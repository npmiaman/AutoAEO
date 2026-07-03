"use client";

/**
 * Animated pixel-pigeon. Renders the sprite grid onto a <canvas> at 1px/cell and
 * upscales with `image-rendering: pixelated`, so it stays crisp at any size.
 * Idle animation: a gentle breathing bob, an occasional blink, a tail flick.
 */
import { useEffect, useRef } from "react";
import { PIGEON_ART, PIGEON_PALETTE, PIGEON_EYE, PIGEON_HEAD } from "./pixel-pigeon.js";

const PAD = 1; // top breathing room so the bob never clips
const W = Math.max(...PIGEON_ART.map((r) => r.length));
const H = PIGEON_ART.length + PAD;

export default function PixelPigeon({ size = 120 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    let tick = 0;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      const bob = -Math.round(0.5 + 0.5 * Math.sin(tick * 0.3)); // 0 or -1 breathing
      const blink = tick % 42 >= 40;
      const flick = tick % 60 < 3;

      ctx.fillStyle = "rgba(40,55,60,0.16)";
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H - 1.1, W * 0.28 * (bob ? 0.84 : 1), 1.3, 0, 0, Math.PI * 2);
      ctx.fill();

      for (let y = 0; y < PIGEON_ART.length; y++) {
        const row = PIGEON_ART[y];
        for (let x = 0; x < row.length; x++) {
          let ch = row[x];
          if (blink && x === PIGEON_EYE[0] && y === PIGEON_EYE[1]) ch = PIGEON_HEAD;
          const color = (PIGEON_PALETTE as Record<string, string>)[ch];
          if (!color) continue;
          let dy = PAD + bob;
          if (flick && x <= 6 && y >= 16) dy -= 1; // tail-tip flick
          ctx.fillStyle = color;
          ctx.fillRect(x, y + dy, 1, 1);
        }
      }
    };

    render();
    const id = setInterval(() => {
      tick++;
      render();
    }, 90);
    return () => clearInterval(id);
  }, []);

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      aria-label="Pixel pigeon"
      style={{ width: size, height: Math.round((size * H) / W), imageRendering: "pixelated" }}
    />
  );
}
