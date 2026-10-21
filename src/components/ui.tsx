import { AlertTriangle, ArrowDown, ArrowUp, Info, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { modelLabel } from '../../shared/pricing';
import type { Severity } from '../../shared/types';
import { modelColor } from '../lib/colors';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Card({ children, className, style, i }: { children: ReactNode; className?: string; style?: CSSProperties; i?: number }) {
  return (
    <section className={cx('card rise', className)} style={{ ...style, ['--i' as string]: i ?? 0 }}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-fg-3">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  );
}

export function Kpi({ label, value, sub, title, accent }: { label: string; value: ReactNode; sub?: ReactNode; title?: string; accent?: string }) {
  return (
    <div className="min-w-0 bg-surface px-5 py-4" title={title}>
      <div className="eyebrow flex items-center gap-1.5">
        {accent && <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: accent }} />}
        {label}
      </div>
      <div className="mt-1.5 truncate text-[22px] font-medium leading-tight tracking-tight text-fg">{value}</div>
      {sub && <div className="mt-1 truncate text-[12px] text-fg-3">{sub}</div>}
    </div>
  );
}

/** Six tiles separated by hairlines (the grid gap shows the border color through). */
export function KpiRow({ children, i }: { children: ReactNode; i?: number }) {
  return (
    <Card i={i} className="grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 xl:grid-cols-6" style={{ background: 'var(--border)' }}>
      {children}
    </Card>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline'; size?: 'sm' | 'md' };

export function Button({ variant = 'outline', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-ink text-ink-contrast hover:opacity-90',
        variant === 'outline' && 'border border-line-strong bg-surface text-fg hover:bg-surface-2',
        variant === 'ghost' && 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={value === o.key}
          title={o.title}
          onClick={() => onChange(o.key)}
          className={cx(
            'h-[26px] rounded-[5px] px-2.5 font-mono text-[11.5px] transition-colors',
            value === o.key ? 'bg-ink text-ink-contrast' : 'text-fg-2 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ModelChip({ model, allModels, cost }: { model: string; allModels: string[]; cost?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-2 py-0.5 pr-2 pl-1.5 text-[11.5px] text-fg-2">
      <span className="h-2 w-2 rounded-full" style={{ background: modelColor(model, allModels) }} />
      {modelLabel(model)}
      {cost && <span className="num text-fg-3">{cost}</span>}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'info'; title?: string }) {
  const tones: Record<string, string> = {
    neutral: 'border-line bg-surface-2 text-fg-2',
    info: 'border-line bg-surface-2 text-fg-2',
    good: 'border-[color-mix(in_oklab,var(--status-good)_40%,transparent)] text-fg',
    warning: 'border-[color-mix(in_oklab,var(--status-warning)_55%,transparent)] text-fg',
    serious: 'border-[color-mix(in_oklab,var(--status-serious)_55%,transparent)] text-fg',
    critical: 'border-[color-mix(in_oklab,var(--status-critical)_55%,transparent)] text-fg',
  };
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wide', tones[tone])}>
      {children}
    </span>
  );
}

const SEVERITY: Record<Severity, { icon: typeof Info; color: string; label: string }> = {
  high: { icon: OctagonAlert, color: 'var(--status-critical)', label: 'High' },
  medium: { icon: TriangleAlert, color: 'var(--status-serious)', label: 'Medium' },
  low: { icon: AlertTriangle, color: 'var(--status-warning)', label: 'Low' },
  info: { icon: Info, color: 'var(--text-3)', label: 'Info' },
};

export function SeverityMark({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-wide text-fg-2">
      <Icon size={13} strokeWidth={2} style={{ color: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}

export function LiveDot({ label = 'Live' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide text-fg-2" title="Transcript updated in the last 3 minutes">
      <span className="live-dot" />
      {label}
    </span>
  );
}

/** Horizontal share-of-total bar for table rows. */
export function ShareBar({ value, max, color = 'var(--c1)' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-fg-2">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          {it.label}
          {it.value && <span className="num text-fg-3">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export function SortHeader<K extends string>({ k, sort, onSort, children, align = 'left' }: { k: K; sort: { key: K; dir: 'asc' | 'desc' }; onSort: (k: K) => void; children: ReactNode; align?: 'left' | 'right' }) {
  const active = sort.key === k;
  return (
    <th className={cx('px-3 py-2 font-normal', align === 'right' ? 'text-right' : 'text-left')} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button onClick={() => onSort(k)} className={cx('eyebrow inline-flex items-center gap-1 hover:text-fg', active && 'text-fg-2', align === 'right' && 'flex-row-reverse')}>
        {children}
        {active && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="text-[14px] font-medium text-fg">{title}</div>
      {children && <div className="mx-auto mt-1.5 max-w-md text-[13px] text-fg-3">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card mx-auto my-10 max-w-lg px-6 py-5">
      <div className="flex items-center gap-2 text-[14px] font-medium">
        <OctagonAlert size={16} style={{ color: 'var(--status-critical)' }} /> Couldn’t load data
      </div>
      <p className="mt-1 text-[13px] text-fg-2">{message}</p>
      {onRetry && (
        <Button className="mt-3" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-24 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="h-20 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="h-72 animate-pulse rounded-[10px] bg-surface-2" />
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] sm:p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cx('card rise flex max-h-[calc(100vh-5rem)] w-full flex-col outline-none', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-[14px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[12.5px]">
      <span className="text-fg-3">{label}</span>
      <span className="num text-fg">{value}</span>
    </div>
  );
}
