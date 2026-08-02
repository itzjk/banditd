"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/components/visuals";

const LINES = [
  "I sell cold brew coffee concentrate at $28, a 32oz bottle that makes 16 cups.",
  "Handmade soy candles, 9oz, wooden wick, about 50 hours of burn.",
  "Vendo mochilas de lona impermeable de 30 litros a 65 dolares.",
  "Refurbished steel road bike, 54cm frame, new drivetrain, 420 pounds.",
];

const TYPE_MS = 42;
const ERASE_MS = 18;
const HOLD_MS = 2200;

export default function Typewriter() {
  const [text, setText] = useState(LINES[0]);
  const [still, setStill] = useState(true);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let line = 0;
    let at = 0;
    let erasing = false;
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      const full = LINES[line];
      if (!erasing) {
        at += 1;
        setText(full.slice(0, at));
        if (at >= full.length) {
          erasing = true;
          timer = setTimeout(tick, HOLD_MS);
          return;
        }
        timer = setTimeout(tick, TYPE_MS);
        return;
      }
      at -= 1;
      setText(full.slice(0, Math.max(0, at)));
      if (at <= 0) {
        erasing = false;
        line = (line + 1) % LINES.length;
        timer = setTimeout(tick, 320);
        return;
      }
      timer = setTimeout(tick, ERASE_MS);
    }

    const frame = requestAnimationFrame(() => {
      setStill(false);
      setText("");
      timer = setTimeout(tick, 700);
    });

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  return (
    <span aria-hidden className="bd-type">
      {text}
      {still ? null : <span className="bd-caret" />}
    </span>
  );
}
