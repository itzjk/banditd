"use client";

import { useState } from "react";
import type { Creative } from "@/lib/store";
import {
  adCopyText,
  copyText,
  dataUrlToBlob,
  saveBlob,
  saveText,
  winnerCopyName,
  winnerImageName,
} from "./export-run";

interface Props {
  creative: Creative;
  productName?: string | null;
  probabilityBest?: number | null;
  style?: React.CSSProperties;
}

const BUTTON =
  "min-h-[2.75rem] flex-1 rounded-xl bg-white/[0.04] px-3 py-2 text-[13px] font-semibold text-zinc-100 transition-colors hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-40";

export default function WinnerExport({ creative, productName, probabilityBest, style }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const image = creative.imageData;

  const grabImage = () => {
    if (!image) return;
    const blob = dataUrlToBlob(image);
    if (!blob) {
      setNote("The image could not be read back out of this browser.");
      return;
    }
    saveBlob(blob, winnerImageName(creative, productName, image));
    setNote("Image saved to your downloads.");
  };

  const grabCopy = async () => {
    const text = adCopyText(creative, productName, probabilityBest);
    const ok = await copyText(text);
    if (ok) {
      setNote("Headline and body copied. Paste them into your ad.");
      return;
    }
    saveText(text, winnerCopyName(creative, productName));
    setNote("The clipboard was blocked, so the copy came down as a text file.");
  };

  return (
    <div style={style} className="mt-1 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Take this one with you
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <button type="button" onClick={grabImage} disabled={!image} className={BUTTON}>
          {image ? "Download the image" : "No image to download"}
        </button>
        <button type="button" onClick={() => void grabCopy()} className={BUTTON}>
          Copy the headline and body
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-[1rem] text-[11px] leading-snug text-zinc-400">
        {note}
      </p>
    </div>
  );
}
