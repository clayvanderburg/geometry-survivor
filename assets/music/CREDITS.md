# Soundtrack

Generated with Suno by the game's author from prompts written for VEXOLITH (instrumental synthwave /
darksynth), then loudness-matched (-16 LUFS) and re-encoded to 128 kbps MP3 for streaming.

| File | Title | Use |
|---|---|---|
| menu-vexolith-drift.mp3 | Vexolith Drift | Title screen (loops) |
| run-geom-harvest.mp3 | Geom Harvest | In-game playlist, 1st (opens every run) |
| run-asteroid-fields.mp3 | Asteroid Fields | In-game playlist, 2nd |
| run-neon-wake.mp3 | Neon Wake | In-game playlist, 3rd (breather) |
| run-singularity.mp3 | Singularity | In-game playlist, 4th (late waves) |
| boss-theme.mp3 | Boss Theme | Boss fights (loops) |

The playlist plays in this order every run, then cycles from the 2nd track (js/audio.js SOUNDTRACK). If a file can't load, the game falls
back to its procedural synthwave score.
