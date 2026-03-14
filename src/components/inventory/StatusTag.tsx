import { cn } from '@/lib/utils';

type TagVariant = 'gray' | 'green' | 'yellow' | 'red' | 'orange' | 'blue' | 'purple' | 'slate';

const variantClasses: Record<TagVariant, string> = {
  gray: 'bg-muted text-muted-foreground',
  green: 'bg-emerald-100 text-emerald-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  orange: 'bg-orange-100 text-orange-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-violet-100 text-violet-700',
  slate: 'bg-slate-100 text-slate-600',
};

interface StatusTagProps {
  variant?: TagVariant;
  children: React.ReactNode;
  className?: string;
}

export const StatusTag = ({ variant = 'gray', children, className }: StatusTagProps) => (
  <span className={cn(
    'inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-0.5 whitespace-nowrap',
    variantClasses[variant],
    className
  )}>
    {children}
  </span>
);

export const StockBar = ({ current, threshold }: { current: number; threshold: number }) => {
  const pct = Math.min(100, Math.round((current / Math.max(threshold * 3, 1)) * 100));
  const color = current <= threshold ? 'bg-stock-danger' : pct > 60 ? 'bg-stock-good' : 'bg-stock-warning';
  return (
    <div className="h-1 bg-muted rounded-full overflow-hidden mt-1">
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
};

export const FreshBadge = ({ expiresAt }: { expiresAt: string | null }) => {
  if (!expiresAt) return <span className="text-xs text-muted-foreground/40">N/A</span>;
  const d = Math.round((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  if (d < 0) return <StatusTag variant="red">Expired</StatusTag>;
  if (d <= 2) return <StatusTag variant="orange">Expires {d === 0 ? 'today' : `${d}d`}</StatusTag>;
  return <StatusTag variant="green">Good {d}d</StatusTag>;
};

export const Mono = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('font-mono text-[13px]', className)}>{children}</span>
);

export const SectionHead = ({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) => (
  <div className="flex justify-between items-start mb-4">
    <div>
      <h1 className="text-xl font-bold text-foreground">{title}</h1>
      {sub && <p className="text-[13px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
    {action}
  </div>
);
