# Layout

A spec for making layout the core decision in Landlord. Cards stay, turned down to second
place (the drip-down branch). Numbers are starting points for `tuning.ts`. Part 1 is built
on branch `layout-1`; the rest is design.

## The problem

The owner's words: "The core interesting decisions should be layout ones, which the game
currently isn't."

Today a flat's rent comes from a furniture total and a tier. Walls decide which flat a cell
belongs to and little else. Where the bedroom goes, how big a flat is, who it suits, what's
on the other side of the wall: none of it matters much. So build mode is shopping, and the
interesting part of the game is answering cards.

## The hook

> Every wall you build changes someone's life, and you get to watch it.

Three ideas carry it, plus a fourth that ties them to people:

1. **Carving it up.** Rooms take a purpose from what's in them. A flat's going rate comes
   from its bedrooms and space and how good it is. Different households want different
   sizes. Squeezing in more bedrooms or more flats earns more, and costs.
2. **Walls carry things room to room.** Noise, heat, damp and smells pass from room to
   room, not just flat to flat. A bedroom by a bedroom is quiet; a bedroom by the stairs or
   a telly is not.
3. **The wet stack.** Kitchens and bathrooms want to be near a riser. Near is cheap; far
   costs more and leaks more.
4. **Who lives where.** The night worker, the musician, the family, the old man who won't
   climb: their needs read off the layout and the neighbours, and show on the map.

Rules this spec keeps to:

- **Proven mechanics, few rules, deep consequences.** Every rule here is in a game that
  shipped (Project Highrise, SimTower, Theme Hospital, Prison Architect, RimWorld).
- **Facts, not formulas.** The UI says what is ("Flat 3: one-bed → two-bed", "+£40 a week",
  "Bedroom: louder"), never how it's worked out, and never what you ought to do.
- **No meta layout.** At least two clearly different layouts of the start building should
  score about the same. If one layout wins everywhere, a rule is too strong.
- **Landlord, not puppeteer.** You build, let and answer; tenants live.
- Dry, British, plain words.

---

## 1. Carving it up (part 1: built)

### 1.1 Rooms take their purpose from what's in them

A room is a patch of air closed in by walls and doors (`layout.ts`, unchanged). What's in it
gives it purposes:

| Purpose | Pieces |
| --- | --- |
| Sleep | single bed, double bed |
| Cook | cooker, fridge, sink, counter, dishwasher |
| Sit | sofa, armchair, telly, big telly, console, dining set |
| Wash | toilet, shower, bath, basin |

Broken pieces still count: a broken bed is still a bed.

Names, first match:

- Sleep only, and at least **3 floor tiles** (a single bed and somewhere to stand):
  **Bedroom**.
- Sleep only, smaller: **Box room**. It sleeps someone; it isn't a bedroom.
- Sleep and anything else: **Bedsit**. Somewhere to sleep, not a bedroom.
- Otherwise the purposes joined: **Kitchen**, **Living room**, **Bathroom**, **Kitchen and
  living room**, **Kitchen and bathroom**.
- Nothing: **Empty room** (or **Spare room** if there's furniture with no purpose in it).

**No window rule.** The owner's decision. In a side-on block only the end rooms (and the top
floor) can have windows, so a window rule would pin every bedroom to the ends: a meta layout.
A bedroom needs a bed and the minimum size, nothing else. Light stays a factor in how good a
flat is.

### 1.2 What kind of flat it is

- **Bedrooms**: rooms named Bedroom.
- **Sleeps**: bed places anywhere (single 1, double 2), bedsits and box rooms included.
- **Type**: no bedrooms and a bed somewhere is a **Studio**; no bed at all is
  **Unfurnished**; else **One-bed**, **Two-bed**, **Three-bed**, **Four-bed** (four or more).
- **Sitting**: somewhere to sit that isn't a bedroom (a bedsit's sofa counts).

Worked out from the building whenever it changes (`rooms.ts: flatKind`), never saved.

### 1.3 The going rate

> going rate = a studio's rate for its tier × the size factor, to the nearest £5

| Tier | Studio rate (unchanged `TIER_RENT`) |
| --- | --- |
| Grim | £60 |
| Shabby | £85 |
| Plain | £110 |
| Decent | £140 |
| Nice | £175 |
| Smart | £215 |
| Impressive | £260 |

| Size | Factor |
| --- | --- |
| Studio, Unfurnished | 1.0 |
| One-bed | 1.15 |
| Two-bed | 1.75 |
| Three-bed | 2.3 |
| Four-bed | 2.8 |

**The tier behind the rate is a property of the flat**, not of who's in it: the flat is
scored (impressiveness, eight factors, unchanged) with **one person per bedroom** (one for a
studio). Squeezing a family into a one-bed doesn't make it a worse one-bed; it makes them
cramped (their own thoughts, and the council). An empty flat is scored the same way, so what
the flat panel shows matches the going rate.

Why these numbers: the start building's rents barely move (the studios still go for £140,
the one-bed shells for about what they did), and the same eleven tiles carved from a one-bed
with a living room into a two-bed without one goes from about £70 to £105 a week at the same
quality. That's the temptation.

The tier still catches up straight away going up and after three days going down
(`TIER_GRACE_DAYS`).

### 1.4 Households

Applicants come as one of four households:

| Household | People | Needs |
| --- | --- | --- |
| Single | 1 | a bed |
| Couple | 2, partners | a double bed |
| Sharers | 2 or 3 | a bedroom each |
| Family | 3 or 4: partners and one or two children (students) | two bedrooms and a double bed |

Who applies depends on the flat (weights, then any it can't sleep are dropped):

| Flat | Single | Couple | Sharers | Family |
| --- | --- | --- | --- | --- |
| Studio | 85 | 15 | | |
| One-bed | 45 | 55 | | |
| Two-bed or more | 5 | 15 | 45 | 35 |

Never more people than it sleeps; sharers never more than its bedrooms. A couple and a
family's parents move in as partners (the romance code carries on from there: they can
split up). A family has a second child 40% of the time, if it has the beds.

What they think of the fit (live thoughts, labelled like every other):

- **Not enough bedrooms** (−6): sharers with fewer bedrooms than sharers, a family with
  fewer than two. Only happens once you've rebuilt round them, as applicants always fit.
- **Nowhere to sit but the bed** (−3): two or more people and no sitting anywhere but a
  bedroom.
- **Cramped** (−5, existing): fewer than five tiles each.
- Their own tier thought (existing) uses their actual numbers, so a crowded flat feels
  shabbier to them even though its going rate hasn't moved.

The council's "overcrowded" (existing: under three tiles each) also counts **more people
than the beds sleep**.

### 1.5 What shows on screen

- **The map**: each flat's label says what it is: "Flat 3 · Two-bed".
- **Build mode**: every room's name sits on its floor ("Kitchen", "Bedroom", "Box room").
  Bedrooms are tagged in blue.
- **The building preview** (owner's decision: yes). While placing a piece, and in the
  footer while a building plan is drawn, up to **three** short facts about what it would do:
  - "Going rates +£40 a week" (or −), the change in all going rates;
  - "Flat 3: one-bed → two-bed";
  - "Flat 3: box room, too small for a bedroom";
  - "Flat 3: nowhere to sit but the bed" / "somewhere to sit";
  - "A new flat: studio", "Flat 5 goes".
  Facts, coloured up or down; never advice, never a score. How people will take it only
  shows once they live there.
- **Flat panel**: "One-bed flat · 11 tiles" under the name; a **Rooms** row of chips
  ("Kitchen and living room", "Bedroom", "Bathroom") with "sleeps 2"; "Going rate for a
  nice one-bed".
- **Build checklist**: "Flat 3 · One-bed".
- **Applicant cards**: "Lives alone", "A couple", "Two sharers", "A family of four".
- **Denise's week-two letter** suggests the carve: a wall across the big room and a bed
  each side. (Her old idea, two studios with a front door each, can't be reached from the
  landing in a side-on block: see 1.7.)

### 1.6 Save

`SAVE_VERSION` 10 → 11. New saved fields: `Life.household`, `Applicant.household`. An old
save works them out from who lives with whom: one person is single, two partners a couple,
partners plus others a family, anyone else sharers. Nothing else is saved; rooms and flat
types are worked out from the building.

### 1.7 Splitting in a side-on block

A floor is a line. With one stair core, each floor has room for a flat either side of the
landing, and a flat beyond another can only be reached through it. So the ways to carve are:

- **More bedrooms in the same flat** (a wall across the living room; a box room). The
  commonest, and the one part 1 tests.
- **Where the stair goes**: at the end, one big flat a floor; in the middle, two smaller.
- **A ground-floor flat with its own street door** (the plinth's doorstep works today).
- **Up**, with planning permission (exists), and later down and into the shop (payoff d).
- **A second stair core**: dear, eats a column of every floor, buys two more flats a floor.

### 1.8 How part 1 proves it's a trade-off

`test/layout.test.ts`:

- Room purposes and names on the start building (one-bed, bedsit studio, unfurnished).
- A wall across the living room makes a two-bed; moved one cell along, the small side is a
  box room and the flat is a one-bed again.
- More bedrooms fetch more at every tier; the carved flat's going rate beats the one-bed's
  though its quality is no better; squeezing people in leaves the going rate alone.
- Households: a single-bed studio only draws singles; a two-bed draws sharers and families,
  never more than it sleeps; couples only with a double bed; couples move in as partners;
  sharers short of a bedroom say so; an old save gets households.
- The preview gives at most three facts, names the type change and the rent, and changes
  nothing.
- **The soak** (six weeks, seeds 1 to 3, the decent scripted landlord): flats 3 and 5 fitted
  as one-beds with living rooms, or carved into two-beds without. Carved: **+54% rent**
  (£5,825 against £3,782 over the three seeds) and **liking 46 against 58**. The test asks
  for more than 20% and more than 4 points. Neither side is free.

What part 1 doesn't yet have, and parts 2 and 3 add: the carved flat's extra cost is only
crowding, no living room and more people. Thinner walls between more households, the stair
by a bedroom, more wet rooms further from the riser: those are where splitting really
starts to hurt.

---

## 2. Walls carry things room to room

### 2.1 Noise by room

Keep `environment.ts`'s pass-through (per shared wall and floor tile, insulation about a
sixth, thicker walls less) but work it **between rooms**, not flats. Each room is an
emitter and a listener.

- **Emitters**: what people are doing in it (existing `noiseOf`), plus fixed ones: a
  **stair** cell (people on it: 0.6 each, at night ×1.5), the **street door** (0.8 a use),
  a **flat's front door** (0.4 a use), the street itself for ground-floor rooms facing it
  (0.5 by day, 0.3 at night), a washing machine running (0.6).
- **Listeners**: how much a room's noise matters by purpose. Bedroom at night 1.0, bedroom
  by day 0.4 (1.0 for a night worker), living room 0.5, kitchen 0.3, bathroom 0.1, hall or
  empty 0.
- **Within a flat** noise passes too, at half (your own telly is less annoying than next
  door's), and not at all between members of a couple.
- **Buffers**: a bathroom, a cupboard or an empty room between two flats' living spaces
  takes the noise, because the listener there doesn't care.
- **A floor of tolerance**: every tenant shrugs off the first 0.3 a minute whatever their
  traits; liking a neighbour halves what they hear from them (Project Highrise's
  hypersensitive tenants are the warning).
- A flat's **Quiet** factor becomes its bedrooms' quiet, at night.

### 2.2 Heat by room

One temperature per room, not per cell. Heat leaks through outside walls and the roof,
passes through internal walls to the room next door, and **rises**: a room gets a share of
the warmth of the room below. The top floor is cold without roof insulation; the ground
floor is cold (and noisy) from the street. Radiators heat their room; doors let heat through
at twice a wall. A flat's **Warmth** is its bedrooms' and living room's average.

### 2.3 Damp and leaks

Damp per room, moving slowly (over days): from a bathroom or kitchen without a window or an
extractor fan (new piece, £60), from the ground floor without a damp course (a building job),
from a leak. Damp spreads to the next room at a fifth a day and **drips down** to the room
below. A leaking shower over a bedroom is the classic. Damp over a line is mould: the
existing `mould` flag, now from the building rather than a card.

### 2.4 Smells

Kitchens make a cooking smell (a brief listener penalty in a bedroom next door or above,
0.2, a kebab-shop joke for a chip pan). Bins in the lobby smell to the ground-floor flat.
Kept small: a flavour on noise, not a new system.

### 2.5 On screen

**At most four overlays**: Noise, Warmth, Damp, Rent. Each colours **rooms**, not flats.
Liking moves off the overlay bar onto the tenant faces (it already shows there). Tapping a
room with an overlay on says the two or three things behind its colour ("Telly through the
wall", "Stairs", "Cold roof"). The preview adds facts: "Flat 2 bedroom: louder", "Flat 4
bathroom: damper".

---

## 3. The wet stack

The owner's decision: **not one fixed line**, because one riser would push every building
to the same best plan.

- The start building has **one riser**, a column of cells drawn as a pipe on the back wall
  through every floor (by the stair).
- You can **add more risers**: a building job (£600 a storey), with **council sign-off**
  (building control, three days, almost always yes). More risers, more freedom; dear, and a
  thing to look after.
- Kitchens and bathrooms **connect automatically** to the nearest riser on their floor. No
  pipes are drawn, ever.
- **Distance costs a little, never bans**: fitting a sink, cooker, loo, shower, bath, basin
  or washer costs +£20 a cell beyond two cells from a riser, and its leak chance (wear
  towards breaking, and the leak cards) goes up 10% a cell.
- A riser leak (rare) wets the room it's in on every floor below the leak.
- The preview says "Far from the pipes: dearer to fit". The Damp overlay shows the risers.

**The test**: at least two clearly different layouts of the start building (bathrooms
stacked at the riser, against bathrooms at the far ends with a second riser) end up within
5% of each other on money and liking over twelve weeks.

---

## 4. Who lives where

Applicants carry one or two readable needs that read off the layout and the neighbours,
from a short list:

| Need | Wants | Hates |
| --- | --- | --- |
| Works nights | a quiet bedroom by day | a telly through the bedroom wall, the stairs |
| Musician | (makes noise practising) | complaints |
| Family with a baby | two bedrooms, warmth | noise at night, damp |
| Won't climb | the ground or first floor | four flights |
| Light sleeper | a bedroom away from the stairs and the street | |
| Has a dog | the ground floor, a garden | |

- The applicant card shows a few icons of how the flat fits them ("quiet bedroom", "over a
  telly", "four flights"): facts, not a score.
- Some needs only show once they live there (the habit you learn by watching), and lives
  change (a baby arrives, a job goes to nights), so the puzzle never stays solved.
- An affordability ceiling: a household won't apply above what they can pay (singles less,
  sharers more in total).
- On the map: their icon over their flat, coloured by how well it fits.

---

## 5. How it changes rent and impressiveness

- **Rent**: part 1's size × quality. Parts 2 to 4 change it only through quality (quiet,
  warmth, damp) and who applies.
- **Impressiveness**: the eight factors stay. Quiet and Warmth become per-room (the
  bedrooms count most). Damp is a new drag on Cleanliness (or a ninth factor if it needs to
  be seen). **Repeated decorations count for less**: the second picture in a room counts
  half, the third a quarter, so impressive can't be bought with a skip of pot plants.
- Space stays a ceiling.

## 6. Payoffs

What makes the hook pay: you change a wall, and you get to watch it change someone's life.

- **(a) It worked.** The building preview (part 1), then a visible change when a fix lands:
  the overlay settles over a day or two, the complaints stop, the going rate ticks up with
  a small "+£15 a week" over the flat.
- **(b) Moving-in day.** A small ceremony after a flat is let: a van at the kerb, boxes
  carried up, the new tenants choosing where to sit, their first night (lights on late, a
  takeaway).
- **(c) Recap stories tied to layout.** Tales name the layout cause, good and bad: "Bev
  moved out. She'd been woken by the stairs since March." "The Okafors stayed on. They
  never hear a thing up there."
- **(d) Long term**: grow the building up (planning exists), down into a basement, and into
  the empty ground-floor shop, each with council sign-off.

## 7. Build order

Part 1 is done (branch `layout-1`). After it, these chunks can run in parallel; each says
the files it owns. Shared touch points are named so merges stay clean.

| Chunk | What | Owns | Touches lightly |
| --- | --- | --- | --- |
| **L2 Noise by room** | 2.1, the Noise overlay per room, "louder/quieter" preview facts | `environment.ts` (noise half), new `acoustics.ts` | `renderer.ts` overlay, `preview.ts` (one fact), `tuning.ts` own block |
| **L3 Heat and damp** | 2.2, 2.3, 2.4, Warmth and Damp overlays, extractor fan | `environment.ts` (warmth half), new `damp.ts`, `defs.ts` (one piece) | `renderer.ts`, `flags.ts` (mould reader), `preview.ts` |
| **L4 Risers** | 3: risers, sign-off, distance costs and leaks | new `risers.ts`, `build.ts`, `works.ts` | `furnish.ts` price, `upkeep.ts` wear, `preview.ts`, `buildUi.ts` tool |
| **L5 Who lives where** | 4: needs, applicant fit icons, map icons | `leases.ts` (applicants), `traits.ts`, `panels.ts` applicants | `thoughts.ts` (labelled thoughts), `renderer.ts` |
| **L6 Overlays and lenses** | the four-overlay bar, tap a room for its reasons, Rent overlay, liking off the bar | `hud.ts`, `index.html` overlay bar, `renderer.ts` overlay | none; reads L2 and L3 functions behind stubs |
| **L7 It worked** (payoff a) | settling overlays, rent tick-up popups, complaints stopping | `renderer.ts` popups, `ui/` | `economy.ts` (an event when a rate rises) |
| **L8 Moving-in day** (payoff b) | van, boxes, first night | `visitors.ts` (the van), `moments.ts` | `leases.ts accept` (one call) |
| **L9 Layout tales** (payoff c) | tales naming the cause | `tales.ts`, `outcomes.ts` | needs L2 and L3's "why" strings |
| **L10 Growing** (payoff d) | basement, the shop, sign-off | `start.ts` (the shop), `planning.ts`, `build.ts` | after L4 |
| **L11 Decor curve** | repeats count for less | `impressiveness.ts` | `tuning.ts` |

L2, L3, L4, L5, L6, L8 and L11 can start together. L7 and L9 want L2 and L3's interfaces
(stubbed first); L10 wants L4.

**Soaks to add**, one a chunk, each proving its decision is a real trade-off:

- L2: a bedroom on the stairwell against a bathroom on the stairwell: the first's tenants
  sleep worse and like it less; the second costs the bathroom's position (further from the
  riser once L4 is in).
- L3: the top flat with and without roof insulation: colder and cheaper against warmer and
  dearer.
- L4: the two-layouts test in section 3.
- L5: the same flat let to a night worker over a telly or under a quiet flat.
- And part 1's split soak keeps passing, with its gap growing as L2 to L4 land.

## 8. Research to fold in

From `docs/research/landlord-games.md`, with the owner's decisions:

- **Purpose from furniture, rent from purposes** (RimWorld, Prison Architect, Landlord's
  Super): built in part 1. **No window rule** (owner): a bed and a minimum size (3 tiles).
- **Splitting with a non-linear payoff** (Fallout Shelter, Project Highrise): part 1's size
  factors (each bedroom adds less than the last, but more bedrooms in the same space still
  fetch more). Merging is the same tools in reverse. Churn, wear, shared walls and the
  council are the counterweights (parts 1 to 3).
- **Emitters, sensitivities and buffers** (Project Highrise, Cities, Yoot Tower): section
  2.1, with the floor of tolerance against hypersensitive tenants.
- **Heat and damp per room, not per cell** (Oxygen Not Included, scaled down): 2.2 and 2.3.
- **The wet stack**: changed by the owner from one fixed riser to one at the start and more
  you can add (section 3), against a meta layout. No pipe drawing.
- **The placement preview** (Islanders, Cities): built in part 1 for flat type, box rooms,
  sitting and going rates; later chunks add their own facts. At most three; facts, not
  scores.
- **Four overlays at most** (against Cities' nineteen): Noise, Warmth, Damp, Rent (L6).
- **Who lives where with visible fit** (Tiny Tower, Fallout Shelter, Project Highrise):
  section 4, with needs revealed later and lives that change.
- **Shared spaces as timetables** (Prison Architect, Theme Hospital): a shared bathroom has
  a rush hour because schedules exist; later, with L5.
- **Diminishing returns on decoration** (Planet Coaster): L11.
- **Circulation is a neighbour** (SimTower, Overcrowd): the stair and doors as emitters in
  2.1; the top flat's four flights in section 4.

**Not borrowed**, and why (from the research): lift timetabling; drawing pipes or cables;
per-tile physics fields; score-by-clutter; taste checklists ("likes blue walls"); hidden
furniture recipes; timers, rushing, collecting and restocking; landlord survival needs;
prestige stars and long gates; contracts, districts and more buildings; dozens of overlays;
combat; anything location-based.

## 9. Decisions for the owner

1. **Size factors.** Carving a one-bed into a two-bed lifts the going rate about 50% at the
   same quality. Too tempting, or right while parts 2 to 4 aren't in?
2. **Households set at the door.** A couple is a couple from the day they move in (partners,
   so they can split up later). Fine, or should it still form in the building?
3. **Box room at under 3 tiles.** A single bed is 2 wide, so a box room is a 2-tile room.
   Right line?
4. **Studios with a double bed** draw couples 15% of the time. Keep, or singles only?
5. **Second stair core** as the way to more flats a floor: worth a dedicated tool, or leave
   it to the existing stair and door tools?
