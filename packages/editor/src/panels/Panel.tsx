import type { ReactNode } from 'react';

export function Panel({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className ?? ''}`}>
      <header className="panel-header">{title}</header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
