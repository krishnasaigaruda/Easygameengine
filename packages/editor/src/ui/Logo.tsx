/** Easy Game Engine mark: an isometric cube outline. Uses currentColor. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5L12 2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3.5 7.25 12 12l8.5-4.75M12 12v9.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 12 16.25 9.6v4.8L12 16.8Z" fill="currentColor" opacity="0.35" />
    </svg>
  );
}
