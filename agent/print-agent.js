import fs from 'node:fs/promises';
import path from 'node:path';
import { config, assertConfigured } from './config.js';
import { renderSheet, renderStrip, renderFromComposite } from './compose.js';
import { getPrinterStatus, submitJob, waitForJob } from './printer.js';

// ─────────────────────────────────────────────────────────────
// The agent PULLS work. Your app never connects to this machine, so
// nothing needs to be exposed to the internet.
//
// Order lifecycle:
//   paid -> claimed -> printing -> printed
//                   \-> failed (retry) -> dead_letter (alert)
//
// The hard requirement is: never print the same paid order twice, and
// never silently lose one. A local ledger handles the first; the
// dead-letter state handles the second.
// ─────────────────────────────────────────────────────────────

const log = (level, msg, extra = {}) => {
  const line = { t: new Date().toISOString(), level, msg, ...extra };
  console.log(JSON.stringify(line));
};

async function loadLedger() {
  try {
    const raw = await fs.readFile(config.stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return new Set(parsed.printed || []);
  } catch {
    return new Set();
  }
}

async function saveLedger(printed) {
  await fs.mkdir(path.dirname(config.stateFile), { recursive: true });
  // Keep the ledger bounded; the server remains the source of truth.
  const recent = [...printed].slice(-5000);
  await fs.writeFile(config.stateFile, JSON.stringify({ printed: recent }, null, 2));
}

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(new URL(pathname, config.apiBase), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.agentToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${pathname} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Claims one order with a lease. The server marks it claimed and records
 * an expiry, so if this machine dies mid-job the lease lapses and the
 * order becomes claimable again rather than being stranded.
 */
async function claimNextOrder() {
  const data = await api('/api/print-queue/claim', { method: 'POST' });
  return data.order || null;
}

async function reportResult(orderId, status, detail = {}) {
  await api('/api/print-queue/status', {
    method: 'POST',
    body: { orderId, status, ...detail },
  });
}

async function renderOrder(order) {
  const opts = {
    frames: order.frameUrls || order.frames,
    background: order.background,
    filter: order.filter,
    dateText: order.dateText,
    dpi: config.dpi,
  };

  // Prefer composing from original frames — full capture resolution and
  // exact print geometry. Fall back only for legacy orders.
  const frames = order.frameUrls || order.frames;
  if (Array.isArray(frames) && frames.length) {
    return config.twoUp ? renderSheet(opts) : renderStrip(opts);
  }

  if (order.stripImage) {
    log('warn', 'Order has no frames; falling back to screen composite', { orderId: order.id });
    return renderFromComposite({
      stripImage: order.stripImage,
      background: order.background,
      dpi: config.dpi,
    });
  }

  throw new Error('Order contains no printable image');
}

async function processOrder(order, ledger) {
  const { id } = order;

  // Idempotency guard. If we crashed after printing but before
  // reporting, do not print again — reconcile instead.
  if (ledger.has(id)) {
    log('warn', 'Order already printed locally; reconciling', { orderId: id });
    await reportResult(id, 'printed', { note: 'reconciled from local ledger' });
    return;
  }

  // Each strip ordered is one physical strip. In two-up mode the sheet
  // carries two, so N strips need ceil(N/2) sheets.
  const strips = Math.max(1, Number(order.quantity) || 1);
  const copies = config.twoUp ? Math.ceil(strips / 2) : strips;

  const buffer = await renderOrder(order);

  await fs.mkdir(config.workDir, { recursive: true });
  const file = path.join(config.workDir, `${id}.jpg`);
  await fs.writeFile(file, buffer);

  log('info', 'Submitting print job', { orderId: id, strips, copies });
  const jobId = await submitJob(file, { copies });

  // Record BEFORE waiting. If the process dies during the print, the
  // ledger already knows, so the retry reconciles rather than reprints.
  ledger.add(id);
  await saveLedger(ledger);
  await reportResult(id, 'printing', { jobId });

  const result = await waitForJob(jobId);
  if (!result.ok) {
    throw new Error(`Print job did not complete: ${result.reason}`);
  }

  await reportResult(id, 'printed', { jobId });
  await fs.unlink(file).catch(() => {});
  log('info', 'Order printed', { orderId: id, jobId });
}

async function tick(ledger) {
  if (config.requirePrinterReady) {
    const status = await getPrinterStatus();
    if (!status.ready) {
      log('warn', 'Printer not ready; holding queue', { reason: status.reason });
      return config.errorBackoffMs;
    }
  }

  const order = await claimNextOrder();
  if (!order) return config.pollMs;

  log('info', 'Claimed order', { orderId: order.id, quantity: order.quantity });

  try {
    await processOrder(order, ledger);
    // Work was found; check again immediately in case more is waiting.
    return 1_000;
  } catch (err) {
    const attempts = (Number(order.attempts) || 0) + 1;
    const dead = attempts >= config.maxAttempts;

    log('error', 'Order failed', {
      orderId: order.id,
      attempts,
      dead,
      error: err.message,
    });

    await reportResult(order.id, dead ? 'dead_letter' : 'failed', {
      attempts,
      error: err.message,
    }).catch((e) => log('error', 'Could not report failure', { error: e.message }));

    return config.errorBackoffMs;
  }
}

async function main() {
  assertConfigured();

  const status = await getPrinterStatus();
  log('info', 'Print agent starting', {
    printer: config.printerName,
    printerReady: status.ready,
    printerState: status.reason,
    twoUp: config.twoUp,
    api: config.apiBase,
  });

  const ledger = await loadLedger();
  let running = true;

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log('info', 'Shutting down after current job');
      running = false;
    });
  }

  while (running) {
    let delay = config.pollMs;
    try {
      delay = await tick(ledger);
    } catch (err) {
      // Network blips and API outages must not kill the agent — orders
      // queue server-side and drain when connectivity returns.
      log('error', 'Poll cycle failed', { error: err.message });
      delay = config.errorBackoffMs;
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  log('info', 'Print agent stopped');
}

main().catch((err) => {
  log('fatal', 'Agent crashed', { error: err.message });
  process.exit(1);
});
