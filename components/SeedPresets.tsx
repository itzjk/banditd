"use client";

export interface SeedPreset {
  id: string;
  category: string;
  name: string;
  price: string;
  description: string;
}

export const SEED_PRESETS: SeedPreset[] = [
  {
    id: "sleep-mask",
    category: "Sleep",
    name: "Weighted Sleep Mask",
    price: "$34.00",
    description: "A contoured mask with 180g of glass beads that blocks light and stays put.",
  },
  {
    id: "dog-bowl",
    category: "Pets",
    name: "Slow Feeder Dog Bowl",
    price: "$18.50",
    description: "A ridged ceramic bowl that stretches a fast eater's meal to eight minutes.",
  },
  {
    id: "trail-vest",
    category: "Outdoor",
    name: "Trail Running Vest, 5L",
    price: "$89.00",
    description: "A no bounce vest with two soft flasks and room for a jacket on long runs.",
  },
  {
    id: "monitor-light",
    category: "Desk",
    name: "Monitor Light Bar",
    price: "$59.00",
    description: "A screen mounted lamp that lights the desk without glare on the display.",
  },
];

interface Props {
  onPick: (preset: SeedPreset) => void;
  disabled?: boolean;
  className?: string;
}

export default function SeedPresets({ onPick, disabled, className }: Props) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="eyebrow">Examples</p>
        <span className="text-xs text-subtle">Made up products, one tap fills the form</span>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        {SEED_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(preset)}
            className="min-w-0 rounded-xl border border-border bg-surface-2 p-3 text-left transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span className="eyebrow">{preset.category}</span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                {preset.price}
              </span>
            </div>
            <div className="mt-1 break-words text-sm font-medium tracking-tight">{preset.name}</div>
            <p className="mt-0.5 break-words text-xs leading-relaxed text-muted">
              {preset.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
