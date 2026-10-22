# Breakthrough pools (design, Oct 2026)

Clay's ask, item #3 of `docs/CARD_SYSTEM_REVIEW.md`: at weapon LV 6 / 12 / 18 you pick **1 of 3** options drawn
from a pool, the way Deep Rock Galactic: Survivor offers overclocks, so LV 6 isn't the same pick every run.
Today the pick is 1 fixed transform or Across the Board.

## The pool

Each weapon's pool holds two kinds of option:

- **Transforms** (a new way the weapon works). The 60 we have, plus new ones from the content PRs. Each has a
  *home* milestone (today's `TRANSFORMS[id][6|12|18]`); new ones declare theirs.
- **Flats** (shared by every weapon, no new mechanic; DRG's "clean/balanced" overclocks):
  - **Across the Board**: ×1.18 damage and +1 rank in every UTILITY stat (unchanged).
  - **Overtuned Core**: ×1.20 damage, nothing else. Pure numbers, a little under a transform.
  - Later (content PRs): weapon-specific flats, such as *Damage + Rate* or *Size + Damage*, where a weapon's own
    stats make them meaningful.

## The draw (3 cards)

1. **Card 1: a transform.** Weighted: home milestone ×3, another milestone ×1. A transform can show up at any
   milestone (all transforms are worth the same ×1.22, see Balance), so LV 6 has variety from day one.
2. **Card 2: another transform or a flat** (50/50, transforms weighted as above).
3. **Card 3: a flat.**

Rules:
- Every hand has at least 1 transform and 1 flat, and never the same option twice.
- A transform that builds on another one (`requires: [...]`) is never drawn before it, and `notBefore: <milestone>`
  keeps one at its home tier or later. None of today's 60 needs either.
- A transform taken earlier in the run never comes back. Flats can be taken again at a later milestone
  (they stack, as Across the Board does today).
- With 3+ transforms per weapon there is always one left (you take at most 2 before LV 18). If a pool ever runs
  short, the draw fills with flats.
- The cards are shuffled, so the transform isn't always on the left.
- No reroll, banish or lock on a Breakthrough hand (yet). The slot-6 bonus Breakthrough uses the same draw at LV 6.

## Balance

The potential-DPS model already treats every transform the same: each one multiplies the build's budget by
`BT_TRANSFORM_DPS` (×1.22) and rescales its hit damage to land there (`tfScale` in `js/weapon-scaling.js`).
So moving a transform to another milestone keeps the model intact. Flats are priced as DRG:S does it, a little
under a transform, so the transforms stay the exciting pick (Director, Oct 22):

| Option | Potential DPS | Plus |
|---|---|---|
| any transform | ×1.22 (`BT_TRANSFORM_DPS`) | a new mechanic |
| Overtuned Core | ×1.20 (`BT_OVERTUNED_DPS`) | nothing |
| Across the Board | ×1.18 (`BT_BOOST_DPS`) | +1 every UTILITY rank |

`tests/breakthroughs.test.js` pins every option's `dpsGain` to its row.

**Realized calibration (card bench).** The model holds every transform at ×1.22, but what one *realizes* depends on
how its attacks land, so before calibration the options ranged from 0.4× to 1.95× Across the Board. `js/bt-calibration.js`
`TF_REALIZED` scales each transform's damage per milestone so it realizes **1.05–1.30× Across the Board** (control
transforms 0.95–1.30×, sprayers 0.85–1.0×), measured with `node tools/balance/bt-bench.mjs` (pack + chase, targets at
the wave a weapon reaches that level: 6 / 20 / 30). Potential DPS counts the value back in, so the ×1.22 rows above
still hold. Values stay within 0.6–1.7 (a transform's boss damage never moves more than that); cases damage can't
fix are listed in `BT_BENCH_EXEMPT` with a reason. **A new transform needs a `TF_REALIZED` entry**
(`tests/bt-calibration.test.js`): bench it and tune its hit share or value into the band. New transforms keep the class rule
(`WEAPON_CLASS` / `CLASS_TARGET`): bench numbers go in each content PR.

## Data and saves

- `p.breakthroughs[weapon][milestone]` stores the **option id** taken: a transform id (`'flak'`), `'boost'`
  or `'overtuned'`. The old value `'transform'` still means the home transform of that milestone, so old
  saves, tests, clips and the balance tools keep working.
- `makeBuild` keeps its `t4` / `t8` / `t12` flags, which now mean "transform 1 / 2 / 3 of this weapon is
  installed", wherever it was taken. The 148 weapon reads of those flags don't change. New transforms read
  `b.tf.has(id)`.
- Run stats and the balance harness record the option id (`bt:<weapon>:<level>:<option>`).

## UI

- Three Breakthrough cards; Dr. Pixie docks in the fourth column (hands already go up to 4 cards). On
  narrow screens she docks above the cards, smaller.
- Keys `[1]` `[2]` `[3]`. A transform card shows its clip (`assets/weapons/<weapon>-<home>.webp`, or
  `<weapon>-<id>.webp` for new ones). Flat cards keep the BOOST look.
- Pixie: her pick lines key on the option id, so a line written for a transform plays wherever it's taken.

## Phases

1. **Framework PR:** pool data, the draw, 3-card UI, option-id saves and stats, Overtuned Core, tests.
2. **Content PRs:** 1–2 new options per milestone for Autocannon, Rocket Pods, Swarm Missiles, Rail Lance,
   Escort Drones, Sentry Turret (each with its clip and Pixie line), then the rest. Later: DRG's *unstable*
   overclocks (a bigger transform with a drawback).
