import type { ElementType, HTMLAttributes, ReactNode } from "react";

export type TypeTag = ElementType;

export interface TypeProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: TypeTag;
  className?: string;
}

function text(base: string, fallback: ElementType, props: TypeProps) {
  const { children, as, className = "", ...rest } = props;
  const Tag: ElementType = as ?? fallback;
  return (
    <Tag {...rest} className={`${base} ${className}`.trim()}>
      {children}
    </Tag>
  );
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
