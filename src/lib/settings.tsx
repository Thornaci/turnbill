import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';

export const PLANS = [
  { key: 'api', label: 'API (pay as you go)', monthly: 0 },
  { key: 'pro', label: 'Pro', monthly: 20 },
  { key: 'max5', label: 'Max 5×', monthly: 100 },
  { key: 'max20', label: 'Max 20×', monthly: 200 },
  { key: 'custom', label: 'Custom', monthly: 0 },
] as const;

export type PlanKey = (typeof PLANS)[number]['key'];

interface Settings {
  theme: Theme;
  plan: PlanKey;
  customMonthly: number;
}

interface SettingsContext extends Settings {
  setTheme: (t: Theme) => void;
  setPlan: (p: PlanKey) => void;
  setCustomMonthly: (n: number) => void;
  /** Monthly subscription price, or null when billing is pay-as-you-go. */
  planMonthly: number | null;
  planLabel: string;
}

const DEFAULTS: Settings = { theme: 'system', plan: 'api', customMonthly: 0 };
const KEY = 'turnbill.settings';
const Ctx = createContext<SettingsContext | null>(null);

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const theme = localStorage.getItem('turnbill.theme');
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULTS, ...parsed, theme: theme === 'light' || theme === 'dark' ? theme : 'system' };
  } catch {
    return DEFAULTS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ plan: s.plan, customMonthly: s.customMonthly }));
    if (s.theme === 'system') localStorage.removeItem('turnbill.theme');
    else localStorage.setItem('turnbill.theme', s.theme);
  } catch {
    // Storage unavailable; settings last for this page view.
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(load);

  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
    save(s);
  }, [s]);

  const setTheme = useCallback((theme: Theme) => setS((p) => ({ ...p, theme })), []);
  const setPlan = useCallback((plan: PlanKey) => setS((p) => ({ ...p, plan })), []);
  const setCustomMonthly = useCallback((customMonthly: number) => setS((p) => ({ ...p, customMonthly })), []);

  const value = useMemo<SettingsContext>(() => {
    const plan = PLANS.find((p) => p.key === s.plan) ?? PLANS[0];
    const monthly = s.plan === 'custom' ? s.customMonthly : plan.monthly;
    return {
      ...s,
      setTheme,
      setPlan,
      setCustomMonthly,
      planMonthly: s.plan === 'api' || monthly <= 0 ? null : monthly,
      planLabel: s.plan === 'custom' ? `Custom ($${s.customMonthly}/mo)` : plan.label,
    };
  }, [s, setTheme, setPlan, setCustomMonthly]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings outside SettingsProvider');
  return v;
}

/** Resolved light/dark for chart code that cannot use CSS variables. */
export function useResolvedTheme(): 'light' | 'dark' {
  const { theme } = useSettings();
  const [system, setSystem] = useState(() => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'system' ? (system as 'light' | 'dark') : theme;
}
