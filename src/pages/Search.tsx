import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SearchHit } from '../../shared/types';
import { Badge, Card, cx, Empty, ErrorBox } from '../components/ui';
import { useApi } from '../lib/api';
import { dateTime, homeRelative, usd } from '../lib/format';

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-[color-mix(in_oklab,var(--c4)_35%,transparent)] px-0.5 text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const [draft, setDraft] = useState(q);
  const { data, error, loading } = useApi<SearchHit[]>(q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null);

  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft.trim() !== q) setParams(draft.trim() ? { q: draft.trim() } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [draft, q, setParams]);

  return (
    <div className="space-y-4">
      <div className="rise">
        <h1 className="text-[22px] font-semibold tracking-tight">Search</h1>
        <p className="text-[13px] text-fg-3">Prompts, session titles, file paths, commands and search patterns across every session. Press ⌘K anywhere.</p>
        <div className="relative mt-3 max-w-xl">
          <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. package.json, npm test, refactor"
            aria-label="Search query"
            className="h-10 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-[14px] text-fg placeholder:text-fg-3 focus:border-[var(--focus)] focus:outline-none"
          />
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      <Card i={1} className={cx(loading && 'opacity-90')}>
        {q.length < 2 ? (
          <Empty title="Type at least two characters">
            <span className="inline-flex items-center gap-1">
              <SearchIcon size={13} /> Try a file name, a command like “npm test”, or a word from a prompt.
            </span>
          </Empty>
        ) : !data ? (
          <div className="h-40 animate-pulse" />
        ) : data.length === 0 ? (
          <Empty title={`No matches for “${q}”`} />
        ) : (
          <>
            <div className="border-b border-line px-5 py-2.5 text-[12px] text-fg-3">
              {data.length === 80 ? 'First 80 matches' : `${data.length} match${data.length === 1 ? '' : 'es'}`}, newest first
            </div>
            <ul className="divide-y divide-line">
              {data.map((h, i) => (
                <li key={i}>
                  <Link to={`/sessions/${h.sessionId}${h.promptIndex ? `#prompt-${h.promptIndex}` : ''}`} className="flex items-start gap-3 px-5 py-3 hover:bg-surface-2">
                    <Badge>{h.kind}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className={cx('text-[13px] text-fg', h.kind === 'tool' && 'font-mono text-[12px]')}>
                        <Highlight text={h.snippet} q={q} />
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-fg-3">
                        {h.sessionTitle} · {homeRelative(h.projectPath)}
                        {h.promptIndex ? ` · prompt #${h.promptIndex}` : ''} · {dateTime(h.ts)}
                      </div>
                    </div>
                    <span className="num shrink-0 text-[12.5px] text-fg-2">{usd(h.cost)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
