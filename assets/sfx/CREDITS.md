# Sound effect credits

Every file in this folder was generated for VEXOLITH // SURVIVOR with **ElevenLabs Sound Effects**
(model `eleven_text_to_sound_v2`, October 2026) from the prompts below. Hero sounds were generated twice
and the take closest to the target length was kept. All clips were then trimmed (leading/trailing
silence, length cap, fade-out), peak-normalized to -1 dBFS and encoded as 44.1 kHz mono 96 kbps MP3.
Per-sound playback level, pitch variation and voice limits live in `SFX_SAMPLES` in `js/audio.js`.

| File | Prompt | Notes |
| --- | --- | --- |
| `rocket_launch.mp3` | Small rocket launching, short bright whoosh with an ignition pop, retro sci-fi arcade | |
| `missile_launch.mp3` | Quick homing missile launch, airy rising whoosh with a soft low thump, sci-fi arcade, short | |
| `explosion_small.mp3` | Small punchy retro arcade explosion, crunchy noise burst with a short low thump | |
| `explosion_large.mp3` | Big deep sci-fi explosion, heavy sub boom with a crunchy debris crackle tail, 90s arcade style | |
| `missile_impact.mp3` | Tight missile impact, short crunchy blast with a sharp crack transient and quick decay | cut to 0.70 s |
| `arc_zap.mp3` | Short electric arc zap, crackling high voltage tesla discharge, bright and snappy | first burst only |
| `blade_hit.mp3` | Short metallic energy blade slice hit, bright ringing shing with a sharp attack | cut to 0.45 s |
| `turret_shot.mp3` | Mechanical sci-fi turret firing a single heavy laser bolt, punchy synth zap with a metallic clack | |
| `mine_drop.mp3` | Small metal mine dropping onto a hard floor with a clank, then a quick rising electronic arming beep | |
| `grenade_throw.mp3` | Quick short whoosh of a small glowing grenade being thrown, light electronic hum, sci-fi | |
| `grenade_blast.mp3` | Plasma grenade explosion, punchy electric burst with a crackling sizzle tail, retro sci-fi | |
| `singularity_launch.mp3` | Deep wobbling sci-fi energy orb launch, low pulsing synth vwomm with a falling pitch | |
| `implosion.mp3` | Sci-fi implosion, reversed whoosh sucking inward then a deep sub bass thump | |
| `enemy_hit.mp3` | Short crisp hit on a hard crystal shell, bright digital tick impact, very short | used for critical hits |
| `enemy_death.mp3` | Retro arcade enemy destroyed, short glassy crystal shatter with a digital pop | |
| `player_hit.mp3` | Spaceship hull taking damage, harsh distorted electric crunch with a low thud, short | |
| `xp_pickup.mp3` | Tiny bright crystal chime pickup, single high sparkly synth blip, very short | pitched up a scale per streak |
| `gold_pickup.mp3` | Bright coin pickup chime, two quick rising metallic dings, retro arcade | |
| `level_up.mp3` | Retro synth level up jingle, fast rising bright arpeggio ending on a shimmering major chord | take 1 of 2 |
| `cache_open.mp3` | Triumphant fantasy adventure item get jingle, four quick rising major notes on bright chiptune synth then a held victorious chord with sparkle | take 2 of 2 (take 1 ran 16 s) |
| `breakthrough.mp3` | Sci-fi discovery sting, shimmering synth swell resolving into a bright triumphant major chord with sparkling chimes | take 2 of 2 |
| `boss_warning.mp3` | Sci-fi alarm klaxon, three loud falling two-tone siren blasts over a low rumble | one blast; the game repeats it 3x |
| `boss_arrival.mp3` | Massive boss arrival impact, huge deep boom with a dark distorted synth brass chord hit | take 1 of 2, first 2.3 s with a fade |
| `lieutenant_arrival.mp3` | Ominous sci-fi warp-in, short rising synth brass stab landing on a heavy low thud | |
| `elite_charge.mp3` | Rising sci-fi energy charge-up, low electric hum climbing steadily in pitch and intensity, two and a half seconds | time-stretched to 2.3 s |
| `dash.mp3` | Fast sci-fi thruster dash, short airy swoosh with a bright rising synth sweep | first swoosh of a longer take |
| `supernova.mp3` | Huge bright energy nova blast, shimmering synth explosion with a glittering crackle tail | |
| `ui_select.mp3` | Short soft digital menu blip, clean synth click, very short | |
| `ui_confirm.mp3` | Bright digital menu confirm sound, two quick rising synth tones, clean and short | |
| `game_over.mp3` | Retro arcade game over jingle, slow descending sad synth notes ending on a low minor chord | take 2 of 2 |
