// Compact brand mark — four bubbles in 2×2 (BCG-matrix nod).
export function ProductMark({
  className,
  size = 22,
}: {
  className?: string;
  size?: number;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      aria-hidden
      className={className ?? 'shrink-0'}
    >
      <circle cx="6" cy="6" r="2.6" className="fill-accent-default" opacity="0.6" />
      <circle cx="16" cy="6" r="3.6" className="fill-accent-default" />
      <circle cx="6" cy="16" r="2.0" className="fill-accent-default" opacity="0.4" />
      <circle cx="16" cy="16" r="2.6" className="fill-accent-default" opacity="0.7" />
    </svg>
  );
}
