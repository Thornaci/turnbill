import { ChevronRight, Monitor, Moon, Search, Settings2, Sun } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { PRICING_AS_OF } from '../../shared/pricing';
import type { DataStatus } from '../../shared/types';
import { useApi } from '../lib/api';
import { bytes, homeRelative, relative } from '../lib/format';
import { RANGES, useRange, withRange } from '../lib/range';
import { PLANS, useSettings, type PlanKey, type Theme } from '../lib/settings';
import { cx, Segmented } from './ui';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="Tokenscope home">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="var(--ink)" />
        <rect x="7" y="17" width="4" height="8" rx="1.5" fill="var(--c4)" />
        <rect x="12.5" y="11" width="4" height="14" rx="1.5" fill="var(--c3)" />
        <rect x="18" y="14" width="4" height="11" rx="1.5" fill="var(--c2)" />
        <rect x="23.5" y="7" width="4" height="18" rx="1.5" fill="var(--c1)" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Tokenscope</span>
    </Link>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      } else if (e.key === '/' && document.activeElement === document.body) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="relative"
    >
      <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" aria-hidden />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search prompts, files, commands"
        aria-label="Search prompts, files and commands"
        className="h-8 w-[min(46vw,280px)] rounded-md border border-line-strong bg-surface pr-12 pl-8 text-[13px] text-fg placeholder:text-fg-3 focus:border-[var(--focus)] focus:outline-none"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1 font-mono text-[10px] text-fg-3 sm:block">⌘K</kbd>
    </form>
  );
}

function SettingsMenu() {
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const themes: { key: Theme; label: string; icon: ReactNode }[] = [
    { key: 'system', label: 'System', icon: <Monitor size={13} /> },
    { key: 'light', label: 'Light', icon: <Sun size={13} /> },
    { key: 'dark', label: 'Dark', icon: <Moon size={13} /> },
  ];
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Settings"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-fg-2 hover:text-fg"
      >
        <Settings2 size={15} />
      </button>
      {open && (
        <div className="card rise absolute right-0 z-40 mt-2 w-72 p-4" style={{ boxShadow: '0 12px 32px rgba(0,0,0,.2)' }}>
          <div className="eyebrow mb-2">Theme</div>
          <div className="grid grid-cols-3 gap-1.5">
            {themes.map((t) => (
              <button
                key={t.key}
                onClick={() => s.setTheme(t.key)}
                className={cx('inline-flex h-8 items-center justify-center gap-1.5 rounded-md border text-[12px]', s.theme === t.key ? 'border-ink bg-ink text-ink-contrast' : 'border-line-strong text-fg-2 hover:text-fg')}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="eyebrow mt-4 mb-2">How you pay for Claude Code</div>
          <select
            value={s.plan}
            onChange={(e) => s.setPlan(e.target.value as PlanKey)}
            className="h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg"
          >
            {PLANS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
                {p.monthly ? ` — $${p.monthly}/mo` : ''}
              </option>
            ))}
          </select>
          {s.plan === 'custom' && (
            <label className="mt-2 flex items-center gap-2 text-[12px] text-fg-2">
              Monthly price
              <input
                type="number"
                min={0}
                value={s.customMonthly || ''}
                onChange={(e) => s.setCustomMonthly(Math.max(0, Number(e.target.value) || 0))}
                className="num h-7 w-24 rounded border border-line-strong bg-surface px-2 text-fg"
              />
            </label>
          )}
          <p className="mt-2 text-[11.5px] leading-snug text-fg-3">
            With a subscription, the dashboard compares API-equivalent usage with what you pay. Stored in this browser only.
          </p>
        </div>
      )}
    </div>
  );
}

function RangePicker() {
  const range = useRange();
  return <Segmented label="Time range" value={range.key} options={RANGES.map((r) => ({ key: r.key, label: r.label, title: r.title }))} onChange={range.setKey} />;
}

function Footer() {
  const { data } = useApi<DataStatus>('/api/status', { poll: 30_000 });
  if (!data) return null;
  const c = data.calibration;
  return (
    <footer className="mx-auto max-w-[1320px] px-4 pt-8 pb-10 text-[12px] text-fg-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-4">
        <span className="num">{homeRelative(data.root)}</span>
        <span>
          {data.files} files · {bytes(data.bytes)} · parsed {relative(data.parsedAt)}
        </span>
        <span>List prices as of {PRICING_AS_OF}</span>
        {c.sessions > 0 && (
          <Link to="/method" className="underline decoration-line-strong underline-offset-2 hover:text-fg">
            Estimates track Claude Code’s own counter at {Math.round((c.estimatedUSD / c.reportedUSD) * 100)}%
          </Link>
        )}
        <span className="ml-auto">Everything stays on this machine.</span>
      </div>
      {data.warnings.length > 0 && <div className="mt-2 space-y-0.5">{data.warnings.map((w) => <div key={w}>{w}</div>)}</div>}
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const range = useRange();
  const nav = [
    { to: '/', label: 'Overview', end: true },
    { to: '/search', label: 'Search' },
    { to: '/method', label: 'Pricing & method' },
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_86%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to === '/search' ? n.to : withRange(n.to, range.key)}
                end={n.end}
                className={({ isActive }) => cx('rounded-md px-2.5 py-1.5 text-[13px]', isActive ? 'bg-surface-2 text-fg' : 'text-fg-2 hover:text-fg')}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <SearchBox />
            </div>
            <Link to="/search" aria-label="Search" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-fg-2 sm:hidden">
              <Search size={15} />
            </Link>
            <div className="hidden lg:block">
              <RangePicker />
            </div>
            <SettingsMenu />
          </div>
          <div className="scroll-x w-full lg:hidden">
            <RangePicker />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pt-6 sm:px-6">{children}</main>
      <Footer />
    </div>
  );
}

export function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-fg-3">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} aria-hidden />}
          {it.to ? (
            <Link to={it.to} className="hover:text-fg">
              {it.label}
            </Link>
          ) : (
            <span className="text-fg-2">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
