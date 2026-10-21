// Compares Tokenscope's per-request estimate with the cost Claude Code itself records
// (`cost-state` lines) for every local session that has one.
import { Store } from '../server/store';

const store = new Store(process.argv[2]);
const t0 = Date.now();
await store.refresh(true);
const status = store.dataStatus();
console.log(`Parsed ${status.files} files (${(status.bytes / 1e6).toFixed(0)} MB) in ${Date.now() - t0} ms`);
for (const w of status.warnings) console.log(`  ! ${w}`);

const rows = store
  .sessions({ from: null, to: null })
  .filter((s) => s.reported && s.reported.windowEstimate > 0)
  .sort((a, b) => b.reported!.totalUSD - a.reported!.totalUSD);
for (const s of rows) {
  const r = s.reported!;
  console.log(
    `${s.id.slice(0, 8)}  reported ${r.totalUSD.toFixed(2).padStart(8)}  estimate ${r.windowEstimate.toFixed(2).padStart(8)}  ratio ${(r.windowEstimate / r.totalUSD).toFixed(3)}  ${s.title.slice(0, 48)}`,
  );
}
const c = status.calibration;
console.log(`\n${c.sessions} sessions  reported $${c.reportedUSD.toFixed(2)}  estimate $${c.estimatedUSD.toFixed(2)}  ratio ${(c.estimatedUSD / c.reportedUSD).toFixed(3)}`);
const ov = store.overview({ from: null, to: null });
console.log(`All-time estimate: $${ov.totals.cost.total.toFixed(2)} across ${ov.totals.sessions} sessions, ${ov.totals.projects} projects, ${ov.totals.steps} requests`);
