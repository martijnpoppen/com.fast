# Fast.com Speedtest for Homey

Run internet speed tests powered by [Fast.com](https://fast.com) (Netflix) directly from your Homey flows.

## Flow cards

### Actions
- **Run speedtest** — Runs a full download + upload test (~20s). Returns `location`, `download` (Mbps), and `upload` (Mbps) as flow tokens.

### Triggers
- **A speedtest was completed** — Fires after any speed test finishes (including ones triggered by the action card). Returns the same `location`, `download`, and `upload` tokens.

### Conditions
- **Last download speed is/is not above [X] Mbps**
- **Last upload speed is/is not above [X] Mbps**
- **Last speedtest location is/is not [city]** — partial match, case-insensitive (e.g. "Amsterdam" matches "Amsterdam, NL")

## Notes
- Only one speed test can run at a time. Starting a second will throw an error.
- Condition cards will throw if no test has been run yet in the current session.
- Speed test results use Fast.com's Netflix CDN servers — the same backend as fast.com.
