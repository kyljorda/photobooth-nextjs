// Local print agent configuration.
// Every value is overridable by environment variable so the agent can be
// pointed at staging without editing code.

const env = (key, fallback) => process.env[key] ?? fallback;

export const config = {
  // Where to pull work from. The agent reaches OUT to your app; nothing
  // reaches in. That means no open ports on your home network.
  apiBase: env('VSC_API_BASE', 'https://vintagestrip.club'),
  // Shared secret. Generate with: openssl rand -hex 32
  // Set the same value as PRINT_AGENT_TOKEN in your Vercel env vars.
  agentToken: env('VSC_AGENT_TOKEN', ''),

  // How often to look for new work, and how long to wait after an error.
  pollMs: Number(env('VSC_POLL_MS', 15_000)),
  errorBackoffMs: Number(env('VSC_ERROR_BACKOFF_MS', 60_000)),

  // CUPS queue name. Find yours with:  lpstat -p
  // It will look something like DS620 or DP-DS620.
  printerName: env('VSC_PRINTER', 'DS620'),

  // CUPS media option for a 2x6 strip on 4x6 media.
  // Discover the real values for your printer with:
  //   lpoptions -p <printer> -l
  // The DNP driver exposes cut modes as PPD options; the name below is a
  // sensible default but MUST be verified against your unit before you
  // print a paid order.
  mediaOption: env('VSC_MEDIA', 'media=w288h432'),
  extraLpOptions: env('VSC_LP_OPTIONS', '').split(' ').filter(Boolean),

  // Print two strips per 4x6 sheet and let the cutter split them.
  // Set false to print a single strip centred on the sheet.
  twoUp: env('VSC_TWO_UP', 'true') !== 'false',

  // Retry policy. After maxAttempts a job is parked in dead-letter and
  // you are alerted — it is never silently dropped, because by this
  // point the customer has paid.
  maxAttempts: Number(env('VSC_MAX_ATTEMPTS', 3)),

  // Local working directories.
  workDir: env('VSC_WORK_DIR', './.work'),
  stateFile: env('VSC_STATE_FILE', './.work/state.json'),

  // Refuse to claim new work unless the printer reports ready. Prevents
  // burning retries against a printer that is out of media.
  requirePrinterReady: env('VSC_REQUIRE_READY', 'true') !== 'false',

  dpi: Number(env('VSC_DPI', 300)),
};

export function assertConfigured() {
  const missing = [];
  if (!config.agentToken) missing.push('VSC_AGENT_TOKEN');
  if (!config.printerName) missing.push('VSC_PRINTER');
  if (missing.length) {
    throw new Error(
      `Missing required configuration: ${missing.join(', ')}. See agent/README.md.`
    );
  }
}
