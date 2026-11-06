import { Check, ClipboardCopy, Download, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SessionDetail } from '../../shared/types';
import { buildAnalysis, copyText, DEFAULT_ANALYZE, type AnalyzeOptions } from '../lib/analyze';
import { download, slug } from '../lib/export';
import { count, tokens } from '../lib/format';
import { Button, Modal } from './ui';

const STORE = 'turnbill.analyze';

function loadOptions(): AnalyzeOptions {
  try {
    return { ...DEFAULT_ANALYZE, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') };
  } catch {
    return DEFAULT_ANALYZE;
  }
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--ink)]" />
      <span>
        <span className="block text-[13px] text-fg">{label}</span>
        <span className="block text-[12px] text-fg-3">{hint}</span>
      </span>
    </label>
  );
}

export function AnalyzeModal({ open, onClose, session }: { open: boolean; onClose: () => void; session: SessionDetail & { projectPath?: string } }) {
  const [opts, setOpts] = useState<AnalyzeOptions>(loadOptions);
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => (open ? buildAnalysis(session, opts) : ''), [open, session, opts]);
  const set = (patch: Partial<AnalyzeOptions>) =>
    setOpts((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Storage unavailable; options last for this page view.
      }
      return next;
    });

  const copy = async (thenOpen?: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
    if (thenOpen) window.open(thenOpen, '_blank', 'noopener');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Analyze this session with any AI"
      footer={
        <>
          <span className="mr-auto text-[12px] text-fg-3">
            {count(text.length)} characters · ~{tokens(text.length / 4)} tokens
          </span>
          <Button size="sm" variant="ghost" onClick={() => download(`turnbill-${slug(session.title)}.md`, text, 'text/markdown;charset=utf-8')}>
            <Download size={13} /> .md
          </Button>
          <Button size="sm" onClick={() => copy('https://claude.ai/new')}>
            <ExternalLink size={13} /> Copy & open Claude
          </Button>
          <Button size="sm" variant="primary" onClick={() => copy()}>
            {copied ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied ? 'Copied' : 'Copy to clipboard'}
          </Button>
        </>
      }
    >
      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        <div className="border-b border-line p-5 md:border-r md:border-b-0">
          <p className="text-[12.5px] leading-relaxed text-fg-2">
            Builds a structured cost review of this session — prompts, API calls, tools, cache behavior and automated findings — with instructions asking the model what went wrong and what to change. Paste it into Claude, ChatGPT or any assistant.
          </p>
          <div className="mt-4 space-y-0.5">
            <Toggle checked={opts.includePromptText} onChange={(v) => set({ includePromptText: v })} label="Include prompt text" hint="Your messages, up to 700 characters each" />
            <Toggle checked={opts.includeToolDetails} onChange={(v) => set({ includeToolDetails: v })} label="Include tool details" hint="File paths, commands, search patterns" />
            <Toggle checked={opts.maskHome} onChange={(v) => set({ maskHome: v })} label="Mask home directory" hint="Replace /Users/you with ~" />
          </div>
          <label className="mt-3 block text-[13px] text-fg">
            Prompts to include
            <select
              value={opts.promptLimit}
              onChange={(e) => set({ promptLimit: Number(e.target.value) })}
              className="mt-1 h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px]"
            >
              <option value={0}>All ({session.prompts.length})</option>
              <option value={10}>10 most expensive</option>
              <option value={25}>25 most expensive</option>
              <option value={50}>50 most expensive</option>
            </select>
          </label>
          <p className="mt-4 text-[11.5px] leading-snug text-fg-3">Nothing is sent anywhere until you paste it. Review the preview before sharing.</p>
        </div>
        <div className="min-w-0 p-4">
          <pre className="max-h-[56vh] overflow-auto rounded-md border border-line bg-bg p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg-2">{text}</pre>
        </div>
      </div>
    </Modal>
  );
}
