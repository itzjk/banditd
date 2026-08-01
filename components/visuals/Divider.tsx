import type { ReactNode } from "react";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  label?: ReactNode;
  className?: string;
}

export default function Divider({
  orientation = "horizontal",
  label,
  className = "",
}: DividerProps) {
  if (orientation === "vertical") {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={`hairline-vertical ${className}`.trim()}
      />
    );
  }

  if (!label) {
    return <hr className={`hairline ${className}`.trim()} />;
  }

  return (
    <div className={`flex items-center gap-4 ${className}`.trim()} role="separator">
      <span className="hairline hairline-in flex-1" />
      <span className="t-eyebrow shrink-0">{label}</span>
      <span className="hairline hairline-out flex-1" />
    </div>
  );
}
