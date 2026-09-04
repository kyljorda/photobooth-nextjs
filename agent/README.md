# Print Agent — Mac Mini Setup

Pulls paid orders from vintagestrip.club and prints 2×6 strips on a DNP
printer via CUPS. The agent reaches **out**; nothing reaches in, so no
ports are opened on your network.

## Why the payload carries frames, not the screen strip

The app's on-screen strip is 680×1970 (1:2.897) with each frame already
downsampled to 600×450. A 2×6 print is 600×1800 (1:3.000). Sending the
screen composite to the printer would distort it by 3.4% **and** throw
away most of the captured detail.

So the order payload carries the four original 1400×1050 frames plus the
background and filter choice, and this agent composes at print geometry.
`renderFromComposite()` exists as a fallback for older orders and
letterboxes rather than stretching.

## Before hardware arrives

```bash
cd agent
npm install
npm run dryrun
```

Writes `dryrun-strip-{white,black,pink}.jpg` and `dryrun-sheet-4x6.jpg`.
Open them and check the geometry, the date band, and the colours. This
needs no printer.

## Once the DS620A is connected

**1. Install the DNP macOS driver.** Download v5.2.7 from dnpphoto.com.
Install it with the printer **disconnected**, then plug in the USB cable.
That order matters — the installer misbehaves if the printer is attached.

**2. Find your queue name.**

```bash
lpstat -p
```

Something like `DS620` or `DP-DS620`. Put it in `VSC_PRINTER`.

**3. Find the real media option.** This is the step you must not skip.

```bash
lpoptions -p DS620 -l
```

This lists the PPD options your driver actually exposes, including cut
modes. The default in `config.js` (`media=w288h432`) is a reasonable
guess at 2×6 in points, but **verify it against your unit before
printing a paid order**. Set the confirmed value in `VSC_MEDIA`.

**4. Test one strip by hand** before letting the agent drive anything:

```bash
lp -d DS620 -o scaling=100 -o media=w288h432 dryrun-sheet-4x6.jpg
```

Adjust until a sheet comes out correctly cut into two clean strips.

## Configuration

```bash
export VSC_API_BASE=https://vintagestrip.club
export VSC_AGENT_TOKEN=<same value as PRINT_AGENT_TOKEN in Vercel>
export VSC_PRINTER=DS620
export VSC_MEDIA=media=w288h432
export VSC_TWO_UP=true
npm start
```

Generate the token with `openssl rand -hex 32` and set the identical
value in your Vercel environment variables.

## Keeping it alive

The Mac Mini must stay awake or orders sit in the queue until it wakes.

```bash
sudo pmset -a sleep 0 disksleep 0
```

Then install as a launchd service so it starts at boot and restarts on
crash. Create `~/Library/LaunchAgents/club.vintagestrip.agent.plist`
with `KeepAlive` true, `RunAtLoad` true, your env vars in
`EnvironmentVariables`, and `StandardOutPath` pointed at a log file.
Load it with `launchctl load -w <plist>`.

## What happens when things break

| Situation | Behaviour |
|---|---|
| Out of media / jam / offline | `lpstat` reports a blocking state, agent holds the queue and does not claim work. Orders wait server-side. |
| Machine off or asleep | Nothing is claimed. Orders queue on the server and drain when it wakes. |
| Network down | Poll fails, agent backs off and retries. It does not exit. |
| Crash mid-print | Order id is in the local ledger before waiting, so the retry reconciles instead of reprinting. |
| Print fails repeatedly | After `VSC_MAX_ATTEMPTS` the order moves to `dead_letter`. |

**Dead letter needs a human.** The customer has paid by that point. Wire
an alert on that status — an email to yourself is enough at first, but
do not leave it silent.

## Still to build server-side

This agent expects two endpoints that do not exist yet:

- `POST /api/print-queue/claim` — atomically claims the oldest paid,
  unprinted order and returns it with a lease expiry, so a dead agent
  releases the order instead of stranding it.
- `POST /api/print-queue/status` — records `printing` / `printed` /
  `failed` / `dead_letter`.

Both must check `Authorization: Bearer <PRINT_AGENT_TOKEN>`. They need a
database, which is the next piece of work.

## Capacity

One 4×6 media kit is 800 sheets. Two-up, that is **1,600 strips per kit**
at roughly 8¢ per strip. A print cycle is about 8 seconds, so a sheet
carrying two strips is roughly 4 seconds per strip. Media changes will
be far more of a constraint than throughput.
