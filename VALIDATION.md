# Extended engineering validation — 2026-10-16

PR #1 merged as 620f6ad. Antigravity's original checkout was fast-forwarded cleanly; its existing preview on port 8095 served the merged clock module (HTTP 200). The following checks ran against the subsequent boss-admission and audio-output corrections.

## Automated regression and browser checks
- 35 Node regression tests pass.
- Actual headless Chrome smoke passes boot, play, pause/resume, volume-slider shortcuts, restart, game tuner, standalone Studio, both canvas renderers and storage-blocked startup. No page errors.
- Browser assets are fulfilled from local files because sandbox browser loopback networking is blocked. External fonts are not part of these checks.

## Long run and crowded rendering
- Seed 49374; 36,000 fixed updates = 600 simulated seconds, accelerated with test-only invulnerability and automatic upgrade selection.
- Reached wave 28, level 20, 11,282 kills and 35 mined rocks. All checked state remained finite, population stayed within budget, no runtime errors.
- Separate wave-20 workload at 200 enemies, 60 update/draw samples per resolution:

| Viewport | Update median / p95 | Draw submission median / p95 |
|---|---|---|
| 1280 x 720 | 1.3 / 2.0 ms | 0.9 / 4.4 ms |
| 3840 x 2160 | 1.4 / 1.8 ms | 1.3 / 5.9 ms |

These are headless-browser CPU timings from one machine, not display FPS, GPU completion latency, or portable performance guarantees. Screenshots inspected; the simulation did not render every accelerated tick. It is not a ten-minute real-time soak or a memory-leak proof.

## Actual audio render
- Chrome OfflineAudioContext, 48 kHz, stereo. Eight scenarios cover music, muffled music, mute, combined SFX, 32 simultaneous explosions, maximum legal gains, maximum gains plus explosion burst, and real audio-clock scheduling recovery.
- Before output protection, the burst exceeded full scale and maximum gains reached approximately 3.415. The corrected extreme scenarios peak at approximately 0.980000019 (float32 rounding), with zero full-scale excursions and zero non-finite samples.
- Muted output is exactly zero. One-second clock gap schedules one future step rather than replaying expired steps.
- This verifies technical output only. It does not establish subjective sound quality, inter-sample true peak on physical playback hardware, or speaker/headphone comfort. Overload protection intentionally saturates extreme gains.

## Remaining practical checks
- Listen on the intended speakers/headphones and tune musical balance in Studio.
- Test a physical controller and mobile viewport/input on actual devices.
- Check real-time high-refresh/4K GPU frame pacing during a longer human-played run. Headless draw submission is not sufficient evidence for that layer.

The next product phase can start from this baseline: define a small playable slice of mining/progression and music-reactive combat with clear acceptance criteria. No new game design has been implemented in this engineering pass.
