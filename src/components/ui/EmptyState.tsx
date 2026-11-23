import type { ReactNode } from 'react';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-purple-200 bg-purple-50/50 p-8 text-center">
      <p className="font-display text-lg font-semibold text-purple-900">{title}</p>
      {children && <div className="mt-2 text-sm text-ink/70">{children}</div>}
    </div>
  );
}
