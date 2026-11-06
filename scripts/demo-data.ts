// Writes a synthetic Claude Code projects directory for demos, screenshots and manual testing.
// Every project, prompt and token count is made up; the records follow the real transcript format.
// Usage: tsx scripts/demo-data.ts [outDir]   (default: .demo/projects, replaced on every run)
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { priceRequest } from '../shared/pricing';

const OUT = path.resolve(process.argv[2] ?? '.demo/projects');
const HOME = '/Users/demo/code';
const VERSION = '2.1.317';
const NOW = Date.now();
const SYSTEM_TOKENS = 19_000;
const COMPACT_AT = 330_000;

// Deterministic randomness so the demo looks the same on every run.
let seed = 0x5eed;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;

type Model = 'claude-opus-5-5' | 'claude-fable-5-1' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

interface PromptSpec {
  text: string;
  steps?: [number, number];
  /** Minutes of idle time before this prompt. */
  gap?: number;
  interrupt?: boolean;
  agent?: { type: 'Explore' | 'general-purpose'; description: string };
  model?: Model;
  /** Re-read this file several times during the prompt. */
  reread?: string;
}

interface SessionSpec {
  title: string;
  daysAgo: number;
  hour: number;
  branch: string;
  model: Model;
  prompts: PromptSpec[];
  pr?: number;
  live?: boolean;
}

interface ProjectSpec {
  name: string;
  repo: string;
  files: string[];
  tests: string;
  build: string;
  greps: string[];
  sessions: SessionSpec[];
}

const PROJECTS: ProjectSpec[] = [
  {
    name: 'acme-storefront',
    repo: 'acme/storefront',
    files: ['src/app/checkout/page.tsx', 'src/app/checkout/ShippingStep.tsx', 'src/lib/cart.ts', 'src/lib/money.ts', 'src/components/ProductCard.tsx', 'src/app/search/page.tsx', 'src/lib/search/filters.ts', 'src/lib/images.ts', 'prisma/schema.prisma', 'src/app/api/wishlist/route.ts', 'src/components/Banner.tsx', 'tests/e2e/checkout.spec.ts'],
    tests: 'npm test -- --run',
    build: 'npm run build',
    greps: ['useCheckoutForm', 'formatPrice\\(', 'cdn.acme.test', 'toFixed\\(2\\)', 'wishlist', 'searchParams'],
    sessions: [
      {
        title: 'Checkout flow refactor', daysAgo: 26, hour: 10, branch: 'refactor/checkout', model: 'claude-opus-5-5', pr: 388,
        prompts: [
          { text: 'Refactor the checkout flow so the payment and shipping steps share one form state instead of two separate useState trees.', steps: [18, 26], reread: 'src/app/checkout/page.tsx' },
          { text: 'The shipping step loses the address when I go back from payment. Fix it.', steps: [8, 14] },
          { text: 'Run the e2e tests and fix whatever fails.', steps: [12, 20] },
          { text: '/review checkout', steps: [6, 9] },
          { text: 'Looks good. Write a short summary I can paste into the PR description.', steps: [1, 2] },
        ],
      },
      {
        title: 'Faceted product search', daysAgo: 21, hour: 14, branch: 'feat/search-filters', model: 'claude-fable-5-1',
        prompts: [
          { text: 'Add faceted filters (brand, price range, size) to the product search page.', steps: [20, 30] },
          { text: 'Filters should sync to the URL so links are shareable.', steps: [8, 12] },
          { text: 'Search is slow on large categories. Profile it and fix the worst part.', steps: [14, 22], model: 'claude-opus-5-5' },
          { text: 'Add unit tests for the filter reducer.', steps: [6, 10], model: 'claude-opus-5-5' },
        ],
      },
      {
        title: 'Cart rounding bug', daysAgo: 15, hour: 9, branch: 'fix/cart-rounding', model: 'claude-opus-5-5',
        prompts: [
          { text: 'Customers report cart totals off by one cent on multi-currency carts. Find the cause.', steps: [10, 16] },
          { text: 'Use integer minor units everywhere in the cart, not floats.', steps: [12, 18], gap: 95 },
          { text: 'Add a regression test with the EUR → TRY case from the ticket.', steps: [5, 8] },
        ],
      },
      {
        title: 'Image CDN migration', daysAgo: 9, hour: 11, branch: 'chore/image-cdn', model: 'claude-opus-5-5', pr: 412,
        prompts: [
          { text: 'Find every place we build product image URLs by hand.', steps: [3, 5], agent: { type: 'Explore', description: 'Find hand-built image URLs' } },
          { text: 'Move them all to the new imageUrl() helper with width presets.', steps: [16, 24] },
          { text: 'Run the build and lint, fix anything that breaks.', steps: [6, 10] },
        ],
      },
      {
        title: 'Wishlist feature', daysAgo: 3, hour: 13, branch: 'feat/wishlist', model: 'claude-opus-5-5',
        prompts: [
          { text: 'Build a wishlist: a heart button on product cards, a /wishlist page, persisted per user.', steps: [28, 40] },
          { text: 'Add the API routes and the Prisma model for it.', steps: [18, 26] },
          { text: 'Hook it up to the auth session so guests get a prompt to sign in.', steps: [14, 20] },
          { text: 'Write tests for the API routes.', steps: [16, 24] },
          { text: 'The heart icon flickers on hydration. Fix it.', steps: [12, 18], gap: 80 },
          { text: 'Add an empty state and a share link.', steps: [14, 22] },
          { text: 'Run the full test suite and the e2e checkout test too.', steps: [16, 24] },
          { text: 'Explain what changed in the data model so I can tell the backend team.', steps: [2, 3] },
          { text: 'Wishlist count in the header is stale after removing an item. Fix it.', steps: [14, 20] },
          { text: 'Ship it: final lint, typecheck and a commit message.', steps: [6, 10] },
        ],
      },
      {
        title: 'Black Friday banner', daysAgo: 0, hour: 0, branch: 'feat/bf-banner', model: 'claude-opus-5-5', live: true,
        prompts: [
          { text: 'Add a dismissible Black Friday banner driven by the CMS.', steps: [14, 20] },
          { text: 'Make the animation respect prefers-reduced-motion.', steps: [4, 7] },
        ],
      },
    ],
  },
  {
    name: 'billing-api',
    repo: 'acme/billing-api',
    files: ['src/webhooks/stripe.ts', 'src/db/migrations/0042_idempotency.sql', 'src/invoices/pdf.ts', 'src/usage/aggregate.ts', 'src/usage/backfill.ts', 'src/dunning/schedule.ts', 'src/mailer/templates.ts', 'test/webhooks.test.ts'],
    tests: 'pnpm vitest run',
    build: 'pnpm build',
    greps: ['handleStripeEvent', 'idempotency_key', 'renderInvoice', 'metered_events', 'sendDunning'],
    sessions: [
      {
        title: 'Idempotent Stripe webhooks', daysAgo: 24, hour: 15, branch: 'fix/webhook-retries', model: 'claude-opus-5-5', pr: 97,
        prompts: [
          { text: 'The Stripe webhook handler double-charges when Stripe retries. Make it idempotent.', steps: [14, 20] },
          { text: 'Add an idempotency key table and a migration.', steps: [8, 12] },
          { text: 'Write tests for duplicate and out-of-order events.', steps: [10, 14] },
        ],
      },
      {
        title: 'Invoice PDFs', daysAgo: 17, hour: 10, branch: 'feat/invoice-pdf', model: 'claude-sonnet-5-5',
        prompts: [
          { text: 'Generate invoice PDFs with line items, tax and company details.', steps: [16, 22] },
          { text: 'Fonts look wrong in the PDF. Embed Inter properly.', steps: [6, 10] },
          { text: 'Add a snapshot test for the invoice layout.', steps: [5, 8] },
        ],
      },
      {
        title: 'Usage-based pricing', daysAgo: 11, hour: 16, branch: 'feat/metered', model: 'claude-fable-5-1',
        prompts: [
          { text: 'Design usage-based pricing: metered events, monthly aggregation and proration on plan changes.', steps: [8, 12] },
          { text: 'Implement the aggregation job.', steps: [18, 26] },
          { text: "Backfill last month's usage from the events table.", steps: [10, 14] },
        ],
      },
      {
        title: 'Dunning emails', daysAgo: 4, hour: 9, branch: 'feat/dunning', model: 'claude-opus-5-5',
        prompts: [
          { text: 'Send dunning emails on failed payments on day 1, 3 and 7.', steps: [14, 20] },
          { text: 'Use the existing mailer templates instead of new HTML.', steps: [6, 9] },
        ],
      },
    ],
  },
  {
    name: 'mobile-app',
    repo: 'acme/mobile',
    files: ['app/orders/OrdersScreen.tsx', 'app/orders/useOrders.ts', 'app/sync/queue.ts', 'app/notifications/linking.ts', 'android/app/build.gradle', 'ios/Podfile', 'package.json'],
    tests: 'yarn jest',
    build: 'yarn tsc --noEmit',
    greps: ['useOrders', 'NetInfo', 'Linking.getInitialURL', 'newArchEnabled'],
    sessions: [
      {
        title: 'Offline orders list', daysAgo: 20, hour: 11, branch: 'feat/offline', model: 'claude-opus-5-5',
        prompts: [
          { text: 'Add offline support for the orders list with a local cache.', steps: [18, 26] },
          { text: 'Sync queued changes when the app comes back online.', steps: [14, 20], interrupt: true },
          { text: 'Handle conflicts: the server wins, show a toast to the user.', steps: [10, 16] },
        ],
      },
      {
        title: 'Push deep links on Android', daysAgo: 12, hour: 17, branch: 'fix/deeplinks', model: 'claude-opus-5-5',
        prompts: [
          { text: 'Deep links from push notifications open the wrong screen on Android.', steps: [12, 18] },
          { text: 'Add tests for the link parser.', steps: [5, 8] },
        ],
      },
      {
        title: 'React Native upgrade', daysAgo: 2, hour: 10, branch: 'chore/rn-upgrade', model: 'claude-opus-5-5',
        prompts: [
          { text: 'Upgrade React Native to the latest version and fix the breaking changes.', steps: [26, 36], agent: { type: 'general-purpose', description: 'Collect breaking changes from release notes' } },
          { text: 'The iOS build fails with the new architecture flag. Fix it.', steps: [16, 24] },
          { text: 'Android release build crashes on start. Here is the logcat output.', steps: [14, 20] },
        ],
      },
    ],
  },
  {
    name: 'infra',
    repo: 'acme/infra',
    files: ['modules/queue/main.tf', 'modules/queue/variables.tf', 'envs/staging/main.tf', '.github/workflows/ci.yml', 'Dockerfile'],
    tests: 'terraform validate',
    build: 'terraform plan -out plan.bin',
    greps: ['aws_sqs_queue', 'redrive_policy', 'actions/cache', 'docker/build-push-action'],
    sessions: [
      {
        title: 'Terraform queue module', daysAgo: 19, hour: 14, branch: 'feat/sqs-module', model: 'claude-sonnet-5-5',
        prompts: [
          { text: 'Write a Terraform module for SQS queues with dead-letter queues and CloudWatch alarms.', steps: [10, 16] },
          { text: 'Wire it into the staging environment.', steps: [6, 10] },
        ],
      },
      {
        title: 'Faster CI', daysAgo: 6, hour: 12, branch: 'ci/speed', model: 'claude-sonnet-5-5',
        prompts: [
          { text: 'CI takes 25 minutes. Find the slowest jobs and speed them up.', steps: [12, 18] },
          { text: 'Cache the Docker layers between runs.', steps: [6, 10] },
        ],
      },
    ],
  },
  {
    name: 'docs-site',
    repo: 'acme/docs',
    files: ['openapi.yaml', 'scripts/gen-reference.ts', 'content/reference/index.mdx', 'content/guides/webhooks.mdx'],
    tests: 'npm run check-links',
    build: 'npm run build',
    greps: ['operationId', '](/', 'href="/'],
    sessions: [
      {
        title: 'API reference from OpenAPI', daysAgo: 14, hour: 15, branch: 'docs/reference', model: 'claude-sonnet-5-5',
        prompts: [
          { text: 'Generate the API reference pages from openapi.yaml.', steps: [10, 16] },
          { text: 'Add code samples in curl and TypeScript for every endpoint.', steps: [8, 12] },
        ],
      },
      {
        title: 'Broken links', daysAgo: 1, hour: 16, branch: 'docs/links', model: 'claude-haiku-5-5',
        prompts: [{ text: 'Find and fix broken links across the docs.', steps: [8, 12] }],
      },
    ],
  },
  {
    name: 'data-pipeline',
    repo: 'acme/data',
    files: ['dags/revenue_daily.py', 'sql/revenue_daily.sql', 'sql/clickstream_dedup.sql', 'pipelines/clickstream.py', 'tests/test_revenue.py'],
    tests: 'pytest -q',
    build: 'dbt build --select revenue_daily',
    greps: ['refund_amount', 'event_id', 'client_ts', 'schedule_interval'],
    sessions: [
      {
        title: 'Daily revenue report', daysAgo: 23, hour: 10, branch: 'feat/revenue-report', model: 'claude-opus-5-5',
        prompts: [
          { text: 'Build a daily revenue report job from the orders warehouse table.', steps: [14, 20] },
          { text: 'Handle refunds and partial refunds correctly.', steps: [10, 14] },
          { text: 'Schedule it with the existing Airflow DAG.', steps: [5, 8] },
        ],
      },
      {
        title: 'Clickstream duplicates', daysAgo: 8, hour: 13, branch: 'fix/dedup', model: 'claude-opus-5-5',
        prompts: [
          { text: 'We have duplicate events in the clickstream table. Find out why.', steps: [10, 16], agent: { type: 'Explore', description: 'Trace where clickstream events are written' } },
          { text: 'Write a dedup step keyed on event_id and the client timestamp.', steps: [8, 12] },
        ],
      },
    ],
  },
];

const EXPLORE_TEXT = ['Let me look at how this is wired today.', 'Searching for the relevant code.', 'Reading the files involved.', 'Checking where this is used.'];
const EDIT_TEXT = ['Making the change.', 'Updating the implementation.', 'Applying the fix.', 'Editing the component.'];
const VERIFY_TEXT = ['Running the tests.', 'Checking the build.', 'Verifying the change.'];
const DONE_TEXT = ['Done. All tests pass and the change is ready for review.', 'Fixed. I added a regression test for it.', 'Implemented and verified; summary below.'];

function usage(o: { read: number; w1h?: number; w5m?: number; out: number }) {
  return {
    input_tokens: int(2, 9),
    cache_read_input_tokens: o.read,
    cache_creation_input_tokens: (o.w1h ?? 0) + (o.w5m ?? 0),
    cache_creation: { ephemeral_1h_input_tokens: o.w1h ?? 0, ephemeral_5m_input_tokens: o.w5m ?? 0 },
    output_tokens: o.out,
    service_tier: 'standard',
    speed: 'standard',
    server_tool_use: { web_search_requests: 0 },
  };
}

function filler(chars: number) {
  const line = '  const value = compute(input, options); // generated demo content\n';
  return line.repeat(Math.ceil(chars / line.length)).slice(0, chars);
}

interface ToolPlan {
  name: string;
  input: Record<string, unknown>;
  chars: number;
  error?: boolean;
}

function plannedTools(p: ProjectSpec, cwd: string, phase: 'explore' | 'edit' | 'verify', reread?: string): ToolPlan[] {
  const file = () => `${cwd}/${pick(p.files)}`;
  if (phase === 'explore') {
    const n = chance(0.35) ? 2 : 1;
    return Array.from({ length: n }, (): ToolPlan => {
      const r = rand();
      if (reread && r < 0.3) return { name: 'Read', input: { file_path: `${cwd}/${reread}` }, chars: 24_000 };
      if (r < 0.55) return { name: 'Read', input: { file_path: file() }, chars: int(2_500, 22_000) };
      if (r < 0.85) return { name: 'Grep', input: { pattern: pick(p.greps), path: cwd }, chars: int(300, 5_000) };
      return { name: 'Glob', input: { pattern: '**/*.{ts,tsx}' }, chars: int(400, 2_500) };
    });
  }
  if (phase === 'edit') {
    const r = rand();
    if (r < 0.65) return [{ name: 'Edit', input: { file_path: file(), old_string: '…', new_string: '…' }, chars: int(200, 900) }];
    if (r < 0.8) return [{ name: 'Write', input: { file_path: file(), content: '…' }, chars: 120 }];
    return [{ name: 'Read', input: { file_path: reread ? `${cwd}/${reread}` : file() }, chars: int(3_000, 18_000) }];
  }
  const r = rand();
  if (r < 0.6) return [{ name: 'Bash', input: { command: p.tests, description: 'Run tests' }, chars: int(1_500, 38_000), error: chance(0.3) }];
  if (r < 0.85) return [{ name: 'Bash', input: { command: p.build, description: 'Build' }, chars: int(800, 9_000), error: chance(0.15) }];
  return [{ name: 'Bash', input: { command: 'git diff --stat', description: 'Show changes' }, chars: int(200, 1_200) }];
}

function commandText(text: string) {
  const [cmd, ...args] = text.split(' ');
  return `<command-name>${cmd}</command-name>\n<command-message>${cmd.slice(1)}</command-message>\n<command-args>${args.join(' ')}</command-args>`;
}

async function writeSession(p: ProjectSpec, s: SessionSpec, dir: string) {
  const cwd = `${HOME}/${p.name}`;
  const sessionId = uuid();
  const lines: unknown[] = [];
  const base = { cwd, sessionId, version: VERSION, gitBranch: s.branch, userType: 'external' };
  let t: number;
  if (s.live) {
    const est = s.prompts.reduce((a, q) => a + ((q.steps?.[1] ?? 10) * 22_000), 0);
    t = NOW - est - 60_000;
  } else {
    const d = new Date(NOW - s.daysAgo * 86_400_000);
    d.setHours(s.hour, int(0, 50), int(0, 59), 0);
    t = d.getTime();
  }
  const start = t;
  let parent: string | null = null;
  let ctx = 0;
  let cachedModel = '';
  let lastCall = 0;
  let pendingTokens = SYSTEM_TOKENS;
  let costUSD = 0;
  const costByModel: Record<string, number> = {};
  let msgN = 0;

  const call = (model: Model, content: unknown[], out: number, stop: string, promptId: string, writeKind: 'w1h' | 'w5m' = 'w1h') => {
    // A cache entry expires after an hour of inactivity, and each model has its own cache.
    const expired = lastCall > 0 && t - lastCall > 60 * 60_000;
    let read = ctx;
    let write = pendingTokens;
    if (!ctx || expired || model !== cachedModel) {
      read = 0;
      write = ctx + pendingTokens;
    }
    const u = usage({ read, [writeKind]: write, out } as { read: number; w1h?: number; w5m?: number; out: number });
    const rec = {
      ...base,
      type: 'assistant',
      uuid: uuid(),
      parentUuid: parent,
      promptId,
      timestamp: new Date(t).toISOString(),
      requestId: `req_${hex(24)}`,
      message: { id: `msg_${hex(24)}`, type: 'message', role: 'assistant', model, content, stop_reason: stop, usage: u },
    };
    lines.push(rec);
    parent = rec.uuid;
    const cost = priceRequest(model, { input: u.input_tokens, cacheRead: read, cacheWrite5m: u.cache_creation.ephemeral_5m_input_tokens, cacheWrite1h: u.cache_creation.ephemeral_1h_input_tokens, output: out, webSearches: 0 }).total;
    costUSD += cost;
    costByModel[model] = (costByModel[model] ?? 0) + cost;
    ctx = read + write;
    cachedModel = model;
    lastCall = t;
    pendingTokens = out;
    msgN++;
    return rec;
  };

  lines.push({ type: 'ai-title', aiTitle: s.title, sessionId });

  for (const q of s.prompts) {
    t += (q.gap ?? int(1, 9)) * 60_000 + int(5, 50) * 1000;
    const promptId = uuid();
    const model = q.model ?? s.model;
    const isCommand = q.text.startsWith('/');
    const userId = uuid();
    const user = {
      ...base,
      type: 'user',
      uuid: userId,
      parentUuid: parent,
      promptId,
      timestamp: new Date(t).toISOString(),
      origin: { kind: 'human' },
      promptSource: 'typed',
      message: { role: 'user', content: isCommand ? commandText(q.text) : q.text },
    };
    lines.push(user);
    parent = userId;
    pendingTokens += Math.round(q.text.length / 3.5) + 40;
    const promptStart = t;
    const [lo, hi] = q.steps ?? [6, 12];
    const total = int(lo, hi);

    for (let i = 0; i < total; i++) {
      t += int(4, 30) * 1000;
      const last = i === total - 1;
      if (ctx > COMPACT_AT && !last) {
        lines.push({ ...base, type: 'system', subtype: 'compact_boundary', uuid: uuid(), parentUuid: null, timestamp: new Date(t).toISOString(), compactMetadata: { trigger: 'auto', preTokens: ctx } });
        lines.push({ ...base, type: 'user', uuid: uuid(), parentUuid: null, promptId, isCompactSummary: true, timestamp: new Date(t).toISOString(), message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context.' } });
        ctx = 0;
        pendingTokens = SYSTEM_TOKENS + int(5_000, 9_000);
        t += int(40, 90) * 1000;
      }
      const thinking = chance(0.3) ? [{ type: 'thinking', thinking: '', signature: hex(32) }] : [];
      if (last) {
        call(model, [...thinking, { type: 'text', text: isCommand ? 'Review complete: two small issues, both fixed.' : pick(DONE_TEXT) }], int(250, 1_400), 'end_turn', promptId);
        break;
      }
      const phase = i < Math.max(1, Math.round(total * 0.35)) ? 'explore' : i < Math.round(total * 0.75) ? 'edit' : 'verify';
      const spawnAgent = q.agent && i === 0;
      const tools: ToolPlan[] = spawnAgent
        ? [{ name: 'Agent', input: { subagent_type: q.agent!.type, description: q.agent!.description, prompt: q.text }, chars: int(2_500, 5_000) }]
        : plannedTools(p, cwd, phase, q.reread);
      const text = pick(phase === 'explore' ? EXPLORE_TEXT : phase === 'edit' ? EDIT_TEXT : VERIFY_TEXT);
      const toolUses = tools.map((tool) => ({ type: 'tool_use', id: `toolu_${hex(20)}`, name: tool.name, input: tool.input }));
      call(model, [...thinking, { type: 'text', text }, ...toolUses], int(120, 2_200), 'tool_use', promptId);

      if (spawnAgent) {
        await writeSubagent(dir, sessionId, promptId, q.agent!, p, cwd, t);
        t += int(60, 180) * 1000;
      }
      t += int(1, 20) * 1000;
      for (const [k, tool] of tools.entries()) {
        const resultId = uuid();
        const result = {
          ...base,
          type: 'user',
          uuid: resultId,
          parentUuid: parent,
          promptId,
          timestamp: new Date(t).toISOString(),
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUses[k].id, content: filler(tool.chars), is_error: tool.error ?? false }] },
        };
        lines.push(result);
        parent = resultId;
        pendingTokens += Math.round(tool.chars / 3.5);
      }
      if (q.interrupt && i === Math.floor(total / 2)) {
        lines.push({ ...base, type: 'user', uuid: uuid(), parentUuid: parent, promptId, timestamp: new Date(t + 2000).toISOString(), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
        break;
      }
    }
    lines.push({ ...base, type: 'system', subtype: 'turn_duration', durationMs: t - promptStart, uuid: uuid(), parentUuid: parent, timestamp: new Date(t).toISOString() });
  }

  if (s.pr) lines.push({ type: 'pr-link', sessionId, prNumber: s.pr, prUrl: `https://github.com/${p.repo}/pull/${s.pr}`, prRepository: p.repo, timestamp: new Date(t).toISOString() });
  // Claude Code saves its own counter when a run ends; it also includes background requests (titles, summaries).
  if (!s.live) {
    const background = 1.08 + rand() * 0.08;
    lines.push({
      type: 'cost-state',
      sessionId,
      totalCostUSD: costUSD * background,
      startTime: start - 30_000,
      modelUsage: Object.fromEntries(Object.entries(costByModel).map(([m, c]) => [m, { costUSD: c * background }])),
      totalLinesAdded: int(40, 900),
      totalLinesRemoved: int(5, 300),
    });
  }

  const file = path.join(dir, `${sessionId}.jsonl`);
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const mtime = new Date(s.live ? NOW : t);
  await utimes(file, mtime, mtime);
  return { calls: msgN, cost: costUSD };
}

async function writeSubagent(dir: string, sessionId: string, promptId: string, agent: NonNullable<PromptSpec['agent']>, p: ProjectSpec, cwd: string, at: number) {
  const agentId = hex(16);
  const model: Model = agent.type === 'Explore' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5';
  const subDir = path.join(dir, sessionId, 'subagents');
  await mkdir(subDir, { recursive: true });
  const lines: unknown[] = [];
  let t = at + 2000;
  let parent: string | null = null;
  let ctx = 0;
  let pending = 12_000;
  const first = { type: 'user', uuid: uuid(), parentUuid: null, isSidechain: true, agentId, promptId, sessionId, cwd, timestamp: new Date(t).toISOString(), message: { role: 'user', content: agent.description } };
  lines.push(first);
  parent = first.uuid;
  const n = int(6, 12);
  for (let i = 0; i < n; i++) {
    t += int(3, 12) * 1000;
    const last = i === n - 1;
    const tools = last ? [] : plannedTools(p, cwd, 'explore');
    const toolUses = tools.map((tool) => ({ type: 'tool_use', id: `toolu_${hex(20)}`, name: tool.name, input: tool.input }));
    const out = int(150, 900);
    const recId = uuid();
    const rec = {
      type: 'assistant',
      uuid: recId,
      parentUuid: parent,
      isSidechain: true,
      agentId,
      promptId,
      sessionId,
      cwd,
      timestamp: new Date(t).toISOString(),
      message: { id: `msg_${hex(24)}`, role: 'assistant', model, content: [{ type: 'text', text: last ? 'Found 14 call sites; list below.' : 'Searching.' }, ...toolUses], stop_reason: last ? 'end_turn' : 'tool_use', usage: usage({ read: ctx, w5m: pending, out }) },
    };
    lines.push(rec);
    parent = recId;
    ctx += pending;
    pending = out;
    for (const [k, tool] of tools.entries()) {
      const rId = uuid();
      const r = { type: 'user', uuid: rId, parentUuid: parent, isSidechain: true, agentId, promptId, sessionId, cwd, timestamp: new Date(t + 1500).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUses[k].id, content: filler(tool.chars) }] } };
      lines.push(r);
      parent = rId;
      pending += Math.round(tool.chars / 3.5);
    }
  }
  const file = path.join(subDir, `agent-${agentId}.jsonl`);
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await writeFile(path.join(subDir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: agent.type, description: agent.description }));
  await utimes(file, new Date(t), new Date(t));
}

await rm(OUT, { recursive: true, force: true });
let sessions = 0;
let calls = 0;
let cost = 0;
for (const p of PROJECTS) {
  const dir = path.join(OUT, `${HOME}/${p.name}`.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  for (const s of p.sessions) {
    const r = await writeSession(p, s, dir);
    sessions++;
    calls += r.calls;
    cost += r.cost;
  }
}
console.log(`Demo data: ${PROJECTS.length} projects, ${sessions} sessions, ${calls} main-thread calls, ~$${cost.toFixed(2)} → ${OUT}`);
