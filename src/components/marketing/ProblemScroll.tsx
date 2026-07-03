"use client";

import { useEffect, useRef, useState } from "react";

const LINES = [
  "Your buyers stopped Googling. Now they just ask ChatGPT.",
  "It answers them directly, and recommends a handful of sites.",
  "Yours probably isn't one of them.",
  "You don't even know which searches you're losing.",
  "Or who's winning them instead.",
  "Every day, buyers ask AI and get sent to your competitors.",
];

const LIGHT = 212;
const DARK = 13;

function lineCharOffset(lineIndex: number) {
  return LINES.slice(0, lineIndex).reduce((n, line) => n + line.length, 0);
}

function charColor(progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  const v = Math.round(LIGHT + (DARK - LIGHT) * p);
  return `rgb(${v}, ${v}, ${v})`;
}

export default function ProblemScroll() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const totalChars = LINES.join("").length;

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setProgress(totalChars);
      return;
    }

    const onScroll = () => {
      const el = sectionRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const runway = el.offsetHeight - vh;
      if (runway <= 0) {
        setProgress(totalChars);
        return;
      }

      const scrolled = Math.max(0, -rect.top);
      const p = Math.max(0, Math.min(1, scrolled / runway));
      setProgress(p * totalChars);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [totalChars]);

  return (
    <section ref={sectionRef} className="problem-scroll" id="problem">
      <div className="problem-scroll-inner">
        <span className="problem-scroll-tag">THE PROBLEM</span>
        <div className="problem-scroll-lines">
          {LINES.map((line, li) => (
            <p key={line} className="problem-scroll-line">
              {line.split("").map((ch, ci) => {
                const idx = lineCharOffset(li) + ci;
                const darken = Math.max(0, Math.min(1, progress - idx));

                return (
                  <span
                    key={ci}
                    className="problem-scroll-ch"
                    style={{ color: charColor(darken) }}
                  >
                    {ch === " " ? "\u00a0" : ch}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
