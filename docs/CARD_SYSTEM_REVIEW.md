# Card system review (Oct 2026, v0.44–0.45)

How our level-up cards compare with Vampire Survivors (VS), Deep Rock Galactic: Survivor (DRG:S), DRG's weapon mods and overclocks, Brotato, Halls of Torment (HoT), Hades and Risk of Rain 2 (RoR2), and what to change. These are proposals only; nothing here is built. The accuracy fixes are in the same PR, and their table is in the PR description.

## What we have today

- **Weapon cards:** 20 weapons with 4–7 single-stat cards each. Each card adds +1 weapon level and raises one stat. Four weapons also take element cards (FIRE / FROST / CORROSIVE / SHOCK, locked on the first pick).
- **Breakthroughs:** at weapon LV 6 / 12 / 18 you get 1 fixed transform *or* Across the Board.
- **Global cards:**
  - Reactor Overdrive and Replicator Array (v0.45)
  - 2 crit cards
  - 4 tag cards (KINETIC / EXPLOSIVE / ELECTRIC / AREA)
  - 8 STATUS cards
  - 1 passive (Volatile Shatter)
- **Utility cards:** Luck, Magnet, Ion Drive, Thrusters, Dash Extender, Blink Drive, Shield Capacitor and Rotary Claw.
- **Evolutions:** 6, one-shot.
- **Rarity** is the rolled level jump (+1 … +5).
- **Gold** buys reroll, lock and banish. There is no skip.

## How the others do it (only what matters for us)

| | Level-up offer | Global stats | Evolutions / build-definers | Rarity means | Reroll / banish / skip |
|---|---|---|---|---|---|
| **VS** | 3–4 items: weapons *or* passives | ~20 passives (Might, Area, Speed, Duration, Amount, Cooldown, Growth, Greed, Luck, Curse…), 6 passive slots | 1 evolution per weapon: max weapon + a named passive, then open a chest. Arcanas are run-defining rule changes. | none (items have levels) | limited charges of each, bought in the meta shop; Seal pre-banishes |
| **DRG:S** | 3 cards (4 with perks): weapon stat or general stat | General cards (damage, reload, crit, move, pickup, mining…) on the same hand as weapon cards | **Overclocks** at weapon LV 6/12/18: pick 1 of a few, drawn from a per-weapon pool. Flat "balanced" and tradeoff "unstable" options. Artifacts come from drops. | **size of the bonus** (common → legendary scales the % on the same stat) | rerolls are a limited, perk-boosted count |
| **DRG (mods)** | per tier, 2–3 mutually exclusive mods | n/a | Overclocks: *clean* (small, no cost) vs *balanced* vs *unstable* (big change plus a drawback) | n/a | n/a |
| **Brotato** | 4 stat choices per level, a shop each wave | ~15 primary stats, every item a stat stick | Legendary items. Tradeoff items (+X / −Y) are the identity. | tier I–IV scales the size | gold reroll with an escalating price, lock |
| **HoT** | 3–4 cards from each ability's upgrade tree | Traits and Blessings (permanent) | Tree end-nodes change behaviour. Items drop from enemies and wells. | tier per node | limited reroll, banish and skip charges |
| **Hades** | 3 boons from one god | Boons *are* the globals (attack, cast, dash slots) | **Duo boons** (2 gods), **Legendaries** (prereqs shown in the codex) | Common / Rare / Epic / Heroic scales the size | Fated Authority, rerolls bought in the meta |
| **RoR2** | none: items from chests, stacking | Stacking items (white/green/red) | Reds are build-definers. Lunars trade a big upside for a real downside. | color = power tier | printers and scrappers convert items; no banish |

**Takeaways:**
1. Everyone has a broad set of **global stats**, and VS/Brotato build whole runs around them. We have three.
2. DRG:S and Hades use rarity to scale **how big** a bonus is, not "how many levels". Ours mixes both.
3. Build-defining picks (VS evolutions, Arcanas, Hades duos and legendaries, RoR2 reds) are tied to *combinations*, and the game **shows the recipe**. We have 6 evolutions for 20 weapons, and 14 weapons have none.
4. Skip exists almost everywhere, and banish is limited. Our gold economy is closest to Brotato's, which works.

## Prioritized proposals

Effort: S ≈ a day, M ≈ a few days, L ≈ a week+. Risk is balance risk.

| # | Pitch | Why | Effort | Risk |
|---|---|---|---|---|
| 1 | **Fix dead ranks** (list below): shrink a card's cap by the Across the Board ranks it already gets, and drop the useless ranks. | Picks that do nothing feel bad. Cheap and invisible otherwise. | S | none |
| 2 | **Broader global cards** (Clay's ask): *Tempo Core* (all attack rates), *Cooldown Matrix* (cooldown-based weapons and dash), *Velocity Coils* (projectile speed), *Persistence Field* (durations: clouds, pools, singularities, swarms, turrets), with Field Amplifier promoted to a plain global *Area*. Steps about half a weapon card's (+8–10%), max 5 ranks, `GLOBAL` outline. | VS and Brotato make builds out of these. They also give non-weapon picks meaning once weapons hit LV 18. | M | **High**: rate × weapon rate cards × Replicator multiplies. Price with the bench and keep the weapon-floor decision intact (that was the "two LV 18 + stacked globals" problem). |
| 3 | **Breakthrough pools** (Clay's DRG:S plan): each milestone offers **3 of a pool**: 1–2 transforms plus 1–2 flat options (*Damage*, *Damage + Rate*, *Size + Damage*). Across the Board becomes one of the flats. Our 60 transforms seed the pools; a transform may show up at its own tier or later. Later, add DRG's **unstable** flavour: a bigger transform with a drawback. | Every LV 6 currently plays the same, and pools add replay value. DRG:S prices its flat options a little under the transforms, which we already do (×1.18 vs ×1.22). | L | Medium: needs a per-option DPS pin like `BT_TRANSFORM_DPS`. |
| 4 | **SKIP button** on level-up and caches: take nothing, get a little gold (or XP toward the next level). | Every comparison game has it. It saves runs from forced junk once the pool is thin, and it pairs with banish. | S | Low |
| 5 | **Split the bundled cards.** Geom Attractor (radius + XP + bomb) becomes *Attractor* (radius) and *Growth* (XP%, VS's Crown); the bomb moves to its own rare drop. Phase Nova Thrusters (dash cooldown + nova) puts dash cooldown in #2's Cooldown Matrix and keeps the nova. | One card, one effect, which is the rule our weapon cards already follow. Growth is also a classic global. | S–M | Low (XP pacing: re-check the level-up timing) |
| 6 | **Show synergy recipes on cards.** A small "⚗ toward Pulsar Helix" chip on a card that advances an evolution, and an "EVOLUTION READY" toast. | Hades and VS both surface prerequisites. Today the recipes only live in the Field Guide. | S | none |
| 7 | **Rarity wording.** On non-weapon cards "+3 LEVELS" means "+3 ranks", so say RANKS. Replicator Array is pinned RARE (`rarityFloor`), which breaks "rarity = jump". Either give it its own tier like EVOLUTION, or drop the floor. Longer term (with #3), consider DRG:S-style rarity = bigger step instead of more levels. | "Rarity = level jump" is unusual and confuses players coming from DRG:S or Hades. | S | none (S); High (long-term) |
| 8 | **Evolutions for every weapon**, VS-style: weapon LV 18 + a named global card (from #2) gives an evolution offered in the next cache. One per weapon, in waves of 4–5. | 14 weapons have no evolution. It ties globals to weapons and gives late runs a goal. | L | Medium |
| 9 | **Run-defining relics** (VS Arcana, Hades legendary, RoR2 red): a major boss's Super Cache offers 1 of 3 rule-changers, e.g. "status spreads on kill", "dash fires every weapon", "crits chain". | Gives the mid-run the "this run is *the* X build" moment. | M–L | High |
| 10 | **Trim per-weapon utility cards to one each.** Move the rest into Across the Board or the flat Breakthroughs (DRG:S keeps utility inside overclocks). Weapons go from 4–7 cards to ~4: Damage, Rate, Count, one Utility. | Hands are clogged with low-value utility (dead-pick list), and 7 sprayer cards dilute the good ones. | M | Medium (refund-free, but changes hand odds) |
| 11 | **Hand composition guard.** Once 4+ weapons are carried, keep ≥1 non-weapon card in most hands. Weapon stat cards weigh 6 per weapon against ~1 per general, so with 5 weapons globals almost never show. | Pacing: globals vanish exactly when builds should broaden. Needed before #2 lands. | S | Low |
| 12 | **Card text rule:** keep summaries ≤ ~100 characters, put numbers in the preview rows, and keep the "Only X." pattern but never on a card that changes more. Supercritical and Tectonic Bore should show the GLOBAL / UTILITY outline (today they show the weapon scope). | The longest cards (Tidal Shear, Turret, Pulsar) wrap past the fold, and players skim. | S | none |
| 13 | **A few tradeoff cards** (Brotato, RoR2 lunars, DRG unstable), e.g. *Glass Reactor*: +damage, −max shield. Low weight, banishable. | Spice and expert choices. | M | Medium |

### Dead or weak picks found in the audit (#1, #10)
- **Do nothing past a point:**
  - Claw Harpoon *Grapple Hooks* ranks 4–6: the largest hookable hull is reached at rank 3.
  - Rail Lance *Penetrator Core* rank 5 with an Across the Board.
  - Sticky Gel / Deep Freeze / Etching Agent / Stun Coils rank 4 with an Across the Board: the element rank caps at 5.
  - Proximity Mine *Capacity* past ~+2 without Drop Rate.
- **Barely matter:**
  - Escort Drone *Range*: +4.5% on a 784 px reach, and drones already shoot off-screen.
  - Tesla Arc *Reach*: jumps already reach 420 px.
  - Proximity Mine *Fuse*: a longer fuse keeps slots full, so fewer new mines drop.
  - *Spin Rotor* ×3 (sprayers), Orbit Blade *Spin*, Glaive *Spin*, Rail Lance *Flux Lens*.
- **Cosmetic:** Storm Protocol's "+1 STORM" missile level raises nothing; the level itself adds no stats.

### Bundled cards (split, or at least say everything they do)
- Geom Attractor (radius, XP and a bomb)
- Phase Nova Thrusters (dash cooldown and nova)
- Shield Capacitor (max shield and repair)
- Vortex Implosion Damage (grind and collapse)
- Element rank cards (stacks, slow, freeze, stun and cap together)
- Repulsor Surge (knockback, damage and dash refund)
- Pulsar Helix (spiral bolts and +15% Autocannon fire rate)

## Suggested order
1. **#1, #4, #6, #7, #11, #12** first: small, safe, and they make the next steps read well.
2. **#2 and #5**: global cards, priced on the bench.
3. **#3**: Breakthrough pools, already queued.
4. **#8 and #10**, after #2 and #3 settle.
5. **#9 and #13** last.
