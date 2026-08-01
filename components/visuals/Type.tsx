import type { HTMLAttributes, ReactNode } from "react";
import { createElement } from "react";

export type TypeTag =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "p"
  | "span"
  | "div"
  | "dt"
  | "dd"
  | "li"
  | "figcaption";

export interface TypeProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: TypeTag;
  className?: string;
}

function text(base: string, fallback: TypeTag, props: TypeProps) {
  const { children, as = fallback, className = "", ...rest } = props;
  return createElement(as, { ...rest, className: `${base} ${className}`.trim() }, children);
}

export function Display(props: TypeProps) {
  return text("t-display", "h1", props);
}

export function Headline(props: TypeProps) {
  return text("t-headline", "h2", props);
}

export function Title(props: TypeProps) {
  return text("t-title", "h3", props);
}

export function Lead(props: TypeProps) {
  return text("t-lead", "p", props);
}

export function Body(props: TypeProps) {
  return text("t-body", "p", props);
}

export function Small(props: TypeProps) {
  return text("t-small", "p", props);
}

export function Caption(props: TypeProps) {
  return text("t-caption", "p", props);
}

export function Eyebrow(props: TypeProps) {
  return text("t-eyebrow", "p", props);
}

export function Mono(props: TypeProps) {
  return text("t-mono", "span", props);
}
