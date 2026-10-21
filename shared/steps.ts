import type { Step } from './types';

/**
 * A cache rebuild that cost more than necessary. The first call of a thread has nothing to
 * read yet, and after a compaction the summary is new content, so neither counts.
 */
export function isAvoidableRebuild(s: Step): boolean {
  return s.cacheRebuild && s.rebuildReason !== 'first' && s.rebuildReason !== 'compaction';
}
