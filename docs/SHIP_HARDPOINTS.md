# Ship hardpoints (v0.46 design)

Clay: "It would be cool if all the weapons you choose actually **mounted a visible part on the ship** that they
launch from." Every equipped weapon (5 slots max) shows a small part on the hull in its weapon colour, and its
shots, lobs and deploys leave from that part.

The hull is small: `shipRadius` is 15 px, so `r` below is 15 px and a part is about 5–8 px long. Parts are
accents on the hull, not new hull.

## 1. Where parts go

Two kinds of mount:

**Built-in mounts.** These weapons already fire from a fixed place on the ship, so they keep it and use no
hardpoint:

| Weapon | Mount | Part |
|---|---|---|
| Autocannon | central turret | twin barrels (the turret that's drawn today; hidden if you discard it) |
| Rail Lance | central turret | one long rail between the barrels; it glows violet as it charges |
| Drill Driver | the drills | unchanged |
| Rocket Pods | wingtips (−0.5r, ±1.7r), where rockets already launch | a two-tube pod on each wingtip |
| Flame / Cryo / Acid Sprayer | the hull rim at 0.95r, where the nozzles already spin | a nozzle head that rides the rim at its real angle, with a heat glow while it sprays |
| Orbit Blades | ring under the turret hub | a toothed ring that turns with the blades |

**Five hardpoints** for everything else, in hull space. Wing points squash with banking, like the wings.

| Hardpoint | Position | Notes |
|---|---|---|
| SPINE | (−0.6r, 0) | rear of the carapace, over the inner facet; the turret draws on top of it |
| PORT / STBD ROOT | (0.3r, ±0.98r) | on the carapace's wide shoulders, just behind the drill arms |
| PORT / STBD WING | (−0.3r, ±1.2r) | on the wing rib, inboard of the rocket pods |

Each weapon has a preferred hardpoint type. Weapons fill hardpoints in slot order. Each takes the side with fewer parts (port on a tie), so the ship stays
balanced, then uses the fallback order below if its type is full. Five hardpoints cover the worst case of five weapons with
no built-in mount. The layout is worked out from `p.loadout`, so a discarded weapon's part disappears and the
remaining weapons stay put; only a new weapon fills the free spot.

| Prefers | Weapons | Fallback |
|---|---|---|
| SPINE | Tesla coil, Vortex projector, Graviton Mortar tube, Mine dropper, Gas vents | ROOT → WING |
| ROOT | Grenade launcher, Glaive launcher, Turret cradle, Shock Field emitter | WING → SPINE |
| WING | Swarm Missile rack, Drone bay, Nanite hive | ROOT → SPINE |

The parts:
- **Autocannon:** twin barrels (existing).
- **Rail Lance:** a long rail.
- **Missiles:** a 2×2 cell rack.
- **Tesla:** a coil with a spark at its tip.
- **Vortex:** a ring lens.
- **Mortar:** a short fat tube.
- **Grenades:** a stubby launcher.
- **Mines:** a chute with a mine in it, which vanishes on drop and slides back in.
- **Turret:** a cradle showing charge pips.
- **Drones:** a bay hatch.
- **Glaive:** a slot with a disc that spins up.
- **Gas:** three vent slits.
- **Nanites:** a hex hive.
- **Shock Field:** a dish whose glow follows the field's charge.
- **Orbit Blades:** a hub ring.

## 2. Feel (SATISFYING)

Each mount keeps three visual-only values in `p.mounts` (like `p.recoil` today). They are kicked by the weapon
when it fires and decay in `updateShipAnimation`:
- **flash** (decays in ~0.08 s): a white-hot muzzle bloom at the part's tip, using a cached additive sprite.
- **recoil** (~0.12 s): the part slides back about 2 px along its axis and springs back with an ease-out.
- **heat** (~0.6 s, builds with each shot): the part's core glows in the weapon colour, so fast weapons look
  hot. Sprayers stay hot while spraying.

Aimed launchers (grenades, glaive, mortar, nanites, vortex, missiles) **swivel** toward their target before they
kick (eased over about 0.1 s), then drift back to facing forward. Charge weapons show their charge:
- Rail Lance: the rail brightens.
- Shock Field: the dish glows with its charge.
- Turret: pips for charges left.
- Glaive: the disc spins faster as its cooldown ends.

**REDUCE EFFECTS:** no blooms, recoil halved, heat capped at a dim glow. Parts still swivel and show charge,
because that is information.

## 3. Readability

- Parts are solid weapon-colour bodies with dark (`#051024`) detail lines, drawn 1.25×: at 6–9 px a filled shape reads through the hull's glow where an outline is lost. They sit
  inside the hull outline, so the silhouette, the shield outline and the hitbox (`shipHull`) are unchanged.
- They draw after the hull and before the turret and drills, so the turret and drills always read on top.
- Wing hardpoints and rocket pods scale with the bank, so they lean with the wings.
- I'll check the ship at gameplay zoom with 1, 3 and 5 weapons, with screenshots in the PR. With 1 weapon the
  ship looks like today's, plus one part.

## 4. Performance

- Each part is drawn once into a small offscreen canvas per (weapon, render scale), cached like
  `glow-sprite.js`. Each frame costs one `drawImage` per part, plus one additive sprite when it's hot or
  flashing.
- No gradients or `shadowBlur` per frame. That's at most 5 hardpoints plus the built-in mounts, so about 12
  `drawImage` calls.
- The layout is cached and keyed on the loadout.

## 5. Spawn points (gameplay)

New module `js/hardpoints.js` holds the layout, the hull-space positions, `mountWorld(p, weaponId)` and
`kickMount(p, weaponId, aimAngle)`. Weapons ask it for their muzzle.

| Weapon | Change | Balance |
|---|---|---|
| Autocannon, Rail Lance, Rockets, Sprayers, Drill Driver | none; they already fire from their mount | none |
| Missiles, Grenades, Mortar, Glaive, Nanites, Vortex | spawn at the hardpoint instead of the ship centre (≤ 1.4r, about 21 px, off centre). Targets and landing points are unchanged. | negligible: lobs land in the same place; a homing missile starts up to 21 px off centre |
| Tesla Arc | the first arc is drawn from the coil; target search and range stay measured from the ship centre | none |
| Mines, Gas | still dropped behind your motion (the wake matters for placement); the part flashes and the mine visibly leaves the chute | none |
| Turret, Drones, Shock Field, Orbit Blades | deploy and orbit as today; the part flashes or kicks when a turret is planted, a drone launches, or the field discharges | none |

Aim lines and ranges are unchanged. A hardpoint that would launch from inside a rock falls back to the ship
centre, the same guard Rocket Pods already use (`rockOnSegment`).

## 6. Media and tests

- Re-record all weapon clips (`npm run weapon-media`), the tutorial stills (`npm run tutorial-media`) and the
  Field Guide previews.
- New `tests/hardpoints.test.js` covers:
  - every weapon has a mount;
  - five weapons always fit;
  - the layout is stable when a weapon is discarded;
  - `mountWorld` rotates with the hull;
  - REDUCE EFFECTS drops the blooms.
