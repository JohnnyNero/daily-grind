# What other games do with layout, tenants and buildings

Research for Landlord as it moves to make **layout** the core decision, with cards second.
The question each time: what is the decision, why is it a real trade-off, and would it survive
being shrunk to a five-flat block on a phone screen held upright.

Read this alongside what we already have. Landlord already scores flats RimWorld-style
(`src/sim/impressiveness.ts`: eight factors, the weakest drags the score down, space is a
ceiling, named tiers), already passes noise through shared wall and floor tiles with insulation
cutting it to about a sixth (`src/sim/environment.ts`), and already has one temperature per
flat leaking through outside walls. So a good part of what follows is "you're on the right
lines, here's the next step" rather than "do this from scratch".

A note on sources. Fandom wikis and some publisher pages refused automated reading, so a few
mechanics below come from secondary write-ups, forum threads and memory of the games. Where a
detail is from players rather than the developer, it says so. Numbers in other games are
illustrations, not targets.

---

## Part 1. The games

### Side-on towers

#### SimTower (1994) and The Tower II / Yoot Tower (1998)

**Core loop.** Build a skyscraper floor by floor from a lobby: offices, condos, hotel rooms,
shops, restaurants. Money comes in (offices and hotels pay over time, condos sell once),
stars unlock new things, and five stars plus a cathedral on top makes it a "Tower". Yoot Saito
built it round an elevator simulation, and it shows ([Wikipedia](https://en.wikipedia.org/wiki/SimTower)).

**Layout decisions.**
- **Lifts are the game.** Standard lifts span up to 30 floors, express lifts the whole
  building, and sky lobbies every 15 floors let people change. Each lift has modes by time of
  day. Long waits make people stressed (shown by their colour going black, pink, red) and
  stressed tenants leave for good ([Wikipedia](https://en.wikipedia.org/wiki/SimTower)).
- **What sits next to what.** Offices are noisy and busy; homes and hotel rooms want quiet.
  The Tower II made this explicit: lifts, stairs and escalators create foot traffic and noise
  that bother neighbours, and offices want a quiet place to work
  ([Giant Bomb on Yoot Tower](https://www.giantbomb.com/wd/3030-4881/)).
- **Rent level per unit.** You can charge more or less per unit, trading income against the
  tenant's evaluation of the place.
- **Services.** Medical centres, parking, recycling, housekeeping for hotel rooms. Uncleaned
  hotel rooms get cockroaches.

**Matching people to spaces.** Indirect. You build a type of unit and a tenant of that type
arrives; their evaluation of the unit (noise, lift wait, rent, services) decides if they stay.

**Information.** Colour-coded people (stress) and colour-coded units (evaluation), plus a
click-to-inspect panel. No hand-holding and, critics said, not much documentation either.

**Pacing and reception.** Generally liked, a CODiE winner, but slow: Next Generation's 2/5 said
"SimTower sees you standing around waiting for cash reserves to grow in order to add more
floors" ([Wikipedia](https://en.wikipedia.org/wiki/SimTower)). The Tower II added locations,
rented flats, toilets for food courts and electricity, and tied stress to nearby foot traffic
([Wikipedia](https://en.wikipedia.org/wiki/Yoot_Tower)).

**For us.** The idea that *circulation is a neighbour* (the stair, the landing, the front door
make noise for whoever is next to them) is the bit worth keeping. The lift timetabling is not:
a five-flat block has a staircase, not a traffic problem.

#### Project Highrise (SomaSim, 2016; iOS and Android 2018)

**Core loop.** A modern SimTower. Build floors, lay out offices, flats, shops and restaurants,
run utilities to them, and keep tenants satisfied enough to stay and pay. Later tenants pay
more but want more: more utilities, more services, more prestige
([Wikipedia](https://en.wikipedia.org/wiki/Project_Highrise),
[GamingTrend review](https://gamingtrend.com/reviews/towering-above-project-highrise-review)).

**Layout decisions.**
- **Emitters and sensitivities.** Units produce noise, smell and foot traffic; other units
  dislike them. Small offices produce no noise or smell and don't mind them, so players use
  them as a buffer between restaurants and sensitive tenants. Larger and posher flats hate
  noise and smell; the Fancy two-bedroom also dislikes high traffic; the Expansive Loft is
  the exception that doesn't mind. Top HQs want silence, cleanliness and no traffic
  ([Steam guide to units and services](https://steamcommunity.com/sharedfiles/filedetails/?id=760874380);
  [search summary of the official wiki pages](https://projecthighrise.fandom.com/wiki/Large_Two-Bedroom)).
- **Floor preference.** Most flats and offices prefer upper floors, so the top of the
  building is worth more and the ground floor goes to shops.
- **Utilities.** Early tenants need electricity and water; phone, cable and gas arrive later.
  Utilities run through the building and must reach each unit, which slows you down: one
  review notes it pushes a patient build pace rather than stacking offices
  ([GamingTrend](https://gamingtrend.com/reviews/towering-above-project-highrise-review)).
- **Prestige gates.** Better tenant types need a building prestige level (a Large
  two-bedroom needs 5, a Fancy two-bedroom 8), raised by art, services and the like.
- **Grime and maintenance spread.** Restaurants spread grime to nearby units; players compare
  maintenance to pollution in SimCity: you can reduce it, never remove it
  ([Steam thread](https://steamcommunity.com/app/423580/discussions/0/2272575584118682762)).

**Matching.** You choose the unit type; a tenant of that type moves in; their list of likes
and dislikes is what you're satisfying. One telling bug report: luxury flats complained about
noise from their own foot traffic, and the developer said they might be "hypersensitive"
([Steam thread](https://steamcommunity.com/app/423580/discussions/0/343786195669049630)). A
warning about sensitivities with no floor.

**Information.** Each unit shows its needs and complaints; overlays show utilities. Rock,
Paper, Shotgun called its biggest achievement letting you follow what's happening "despite the
deep levels of complexity" ([Wikipedia](https://en.wikipedia.org/wiki/Project_Highrise)).

**Pacing and reception.** Metacritic 73 on PC but 84 on iOS: it plays well on a touch screen
in short sittings, and Android Police thought sim games port to touch well because their mouse
controls convert cleanly ([Android Police](https://www.androidpolice.com/2018/04/12/kalypso-medias-skyscraper-construction-sim-project-highrise-android/)).
The common complaint is sameness: rooms look alike, and big towers get monotonous.

**For us.** The closest existing game to what Landlord wants to be, scaled up. The noise and
smell emitter/sensitivity table, buffers, and "the better the tenant, the fussier" are
directly borrowable. Its monotony warning matters: if every flat is a box with a score, it'll
feel like a spreadsheet. Ours must stay about *these* people.

#### Tiny Tower (NimbleBit, 2011)

**Core loop.** Add a floor, it becomes a home or a shop; residents ("bitizens") work in
shops; shops restock and sell; buy more floors. Free-to-play, built for checking in.

**Layout decisions.** Very few, deliberately. A floor is a unit. The decision is which kind
of floor, and the lift moves visitors. It proves a vertical stack reads beautifully on a phone
held upright.

**Matching.** The good bit. Each bitizen is rated per kind of shop and has a **dream job**;
put them there and you get a bonus (double stock, bux)
([Wikipedia](https://en.wikipedia.org/wiki/Tiny_Tower),
[Pocket Gamer guide](https://www.pocketgamer.com/articles/031220/r/)). Matching people to
places is the whole of the management, and it's visible on each person.

**Reception.** Loved for charm and the phone fit; the restocking and waiting are chores.
Stevivor calls the dream job a pleasant trap: you start trying to align everyone and can't
stop ([Stevivor](https://stevivor.com/reviews/tiny-tower/)).

**For us.** The upright phone stack and "each person has an obvious best fit" are good. The
restocking timers are not.

#### Fallout Shelter (Bethesda, 2015)

**Core loop.** Dig a vault downwards. Build rooms that make power, food and water; assign
dwellers by their SPECIAL stats; deal with fires, radroaches and raiders. Over 150 million
downloads ([Wikipedia](https://en.wikipedia.org/wiki/Fallout_Shelter)).

**Layout decisions.**
- **Merging.** Up to three identical rooms (same type, same level) side by side merge into one
  bigger room, which produces more than three separate ones would. Players point out the
  trade: merged rooms are efficient, small rooms keep the plan flexible
  ([Steam discussion](https://steamcommunity.com/app/588430/discussions/0/1319962683447287197)).
- **Lift shafts** connect floors; rooms must touch them or each other.
- **Moving and demolishing are restricted.** You can only remove a room at the end of a row;
  there's no converting one room into another. Early choices stick.
- **Incidents spread** to the next room if not dealt with, so which rooms sit next to which
  matters. Players put strong dwellers and defence near the door, because raiders enter at
  the top.

**Matching.** Drag a dweller into a room; the room's letter (S for power, P for water...)
says which stat matters, and dwellers are happier in jobs that suit them. Readable at a glance.

**Information.** The whole vault is a side-on cutaway; each room shows a resource bar and a
"collect" icon. Nothing is hidden in menus.

**Reception.** Loved for the loop and the look; criticised for shallowness, no ending and
microtransactions ("desperately in need of a set of endgame goals").

**For us.** The most important reference for *side-on on a phone*. It proves a cell-row
layout can be read and edited by thumb if rooms snap to a coarse grid and the vocabulary is
small. Merging is a clean, visible "bigger is better per cell, but locks you in" trade, and
it's our splitting temptation run backwards.

#### Unholy Heights (Petit Depotto, 2012)

A side-on block of flats let to monsters, crossed with tower defence. Tenants arrive, you tap
to let them in, buy furniture for their rooms, change their rent; they get jobs, fall in love,
have children and sometimes don't pay, and you can evict them
([Pure Nintendo review](https://purenintendo.com/review-unholy-heights-3ds-eshop/),
[Giant Bomb](https://giantbomb.com/unholy-heights/3030-43473/)). Steam "Very Positive".

**For us.** Shows that a tiny side-on block with a handful of named tenants is enough to carry
a game. The tower defence is the half to ignore.

#### Beholder (Warm Lamp, 2016)

A side-on cutaway block where you're the state-appointed manager spying on tenants. Not a
layout game, but the clearest example of "a side-on block is a dolls' house: you watch lives
through the walls". It's the tone of watching we already have.

#### Kairosoft: Dream House Days (2012, phones)

**Core loop.** A Kairosoft apartment block on phones. Build flats, furnish them, let them,
collect rent each season, research better things, grow the population.

**Interesting bits** ([Pocket Gamer guide](https://www.pocketgamer.com/articles/048297/how-to-be-the-worlds-best-landlord-in-dream-house-days-hints-tips-and-tricks/)):
- **Upkeep grows with furniture**, so stuffing a flat costs you every season, not once.
- **Tenants can't pay more than they earn.** A tenant whose salary is below their housing
  costs pays short. Rent is fixed at move-in and rises a little each year.
- **Special rooms**: specific combinations of furniture and flooring (bed, lamp and wooden
  floor; a telly and a console; a piano and a painting) raise the flat's rent more than its
  upkeep. Listed in an Info tab.
- **Benches in hallways** let tenants meet, which leads to couples moving in together. Shared
  space makes social life.

**For us.** Two strong ideas in a phone game: shared space as the place stories start, and
"the tenant's means caps the rent". The combination recipes are a weaker idea (see Part 3).

### Landlord and renovation sims

#### Landlord's Super (Minskworks, 2023)

**Core loop.** 1980s West Berklands. Scavenge, do odd jobs, eat, sleep and wash in a short
day, build an extension on your house with your own hands, then let rooms to tenants to pay
off debt ([Giant Bomb](https://giantbomb.com/wiki/Games/Landlords_Super)).

**Layout decisions.** First-person brick-by-brick construction. Tenant classes are gated by
floor area, value and features: per a forum reply, 200 m² plus a second floor and staircase
plus £20k property value unlocks "Grafters", 300 m² and £30k "Yuppies"; value depends on size,
how it's built, which doors and windows, and furniture
([Steam discussion](https://steamcommunity.com/app/1127840/discussions/0/3833171151454985258)).
Building shoddily saves money and shows.

**Tenants.** Early "Louts" and "Oafs" damage the place and repairs eat the income; better
tenants need a better house, but the current lot won't leave
([Laura Michet](https://blog.lauramichet.com/played-a-bunch-of-landlords-super/)).

**Reception.** Construction "very good" but "incredibly fiddly" (Michet). A DiGRA paper calls
building "complex, tedious" and says it encourages cutting corners because you also have to
sleep, eat, wash and go to the loo in a short day
([DiGRA Australia 2025](https://ray.yorksj.ac.uk/id/eprint/15067/1/DiGRA-Australia-2025-AmyBrierleyBeare-ExtendedAbstract-AM.pdf)).
Michet also notes the politics slide from satire of slumlords towards sympathy with them.

**For us.** Same country, same dry tone. Worth stealing: tenant tiers unlocked by plain
physical facts (floor area, a second bedroom, proper stairs), and bad tenants who won't leave
being the trap you built. Not worth stealing: building brick by brick in person, and survival
needs for the landlord (see the parked live-in spec: it already says "lighter than a tenant").
And the politics warning is real: the game has to stay "nice or ruthless, both playable" and
not drift into celebrating either.

#### The Tenants (Ancient Forge, 2021; full release 2022)

**Core loop.** Renovate and furnish flats, find tenants, collect rent, handle tenants,
expand to new districts; side jobs decorating for clients
([LadiesGamers](https://ladiesgamers.com/the-tenants-review/),
[Eurospider](https://www.eurospider.com/media/articles/tenants.html)). Mostly Positive on Steam.

**Layout decisions.** Mostly interior decoration: budget, space, and the client's taste (one
wants vintage, one blue walls, one hates retro). A tenant who likes the style pays more.

**Tenants and neighbours.** Tenants have habits you learn by watching (the one who drinks and
sings in the evening and pays late). Noise is a *tool*: you can hire a trumpeter to make a
problem tenant's life a misery until they go. Good tenants get longer leases and gifts. Rent
is haggled with a slider.

**Complaints.** Ratings are "too easy to maximise once you learn their wishes and spend more";
decorating becomes routine; tenant messages get ignored (Eurospider). A Tampere Playlab review
found landlord mode slow and grindy ([Tuni Playlab](https://tuni.fi/playlab/tag/thetenantsgame)).

**For us.** Noise as something the landlord can *use*, not just suffer, is a good ruthless
option. The lesson from the complaints: if a tenant's wishes are a checklist, the puzzle is
solved once and then it's chores.

#### House Flipper (Empyrean, 2018) and House Flipper 2

Buy, clean, repair, redecorate, sell. Buyers have stated preferences (rooms, styles, sizes),
and offers reflect how well the house fits them. Satisfying as a tidying game; the layout
decisions are mostly cosmetic and the buyer matching is a checklist. Borrow only the
*feel* that tidying a grotty flat is pleasant to watch.

#### Landlord Simulator (various) and Landlord Go

Landlord Simulator (BeyondPlanet) is a casual buy-fix-let game with thin reviews; players
complain repair costs ignore the worker's skill and you can't inspect before buying
([Steam discussion](https://steamcommunity.com/app/803310/discussions/0/1698294337777850634)).
Nothing to take.

Landlord Go (Reality, 2020) and similar "Landlord: Real Estate Tycoon" apps are location-based
Monopoly: buy virtual versions of real buildings, earn when people visit
([Bisnow](https://www.bisnow.com/index.php/national/news/other/augmented-reality-game-lets-players-buy-and-sell-actual-cre-properties-105331),
[WealthManagement hands-on](https://www.wealthmanagement.com/investment-news/a-new-ar-game-allows-regular-folks-to-play-landlord-we-decided-to-test-it)).
No layout, no tenants as people. Irrelevant apart from the name clash.

**Name clash to check.** One aggregator lists a 2026 PC game called *Landlord* (Wallfacer), a
grid-and-cards property game where you fix leaks, raise rents and evict with action cards
([Playpile](https://playpile.gg/games/landlord)). Unverified, but worth a look before we
settle on the name, and it's a near neighbour in design.

### Room-design management games

#### Theme Hospital (Bullfrog, 1997) and Two Point Hospital (2018)

**Core loop.** Build rooms to diagnose and cure, hire staff, manage queues and money.

**Layout decisions.**
- **Rooms have minimum sizes and required objects** (GP's office 4x4, X-ray 7x7), and you
  drag the size ([StrategyWiki](https://strategywiki.org/wiki/Theme_Hospital/Rooms)).
  Bigger rooms cost more space but fit more extras.
- **Heating by radiators** whose effect depends on room size; corridors and rooms heat
  separately (player guides).
- **Walking distance and queues.** Benches outside rooms, rooms near each other in the
  order patients need them, handymen and their famous pathfinding.
- **Two Point adds room prestige**: a score from room size and what's in it, giving +10% to
  +30% happiness at levels 3 to 5 ([Ludo.guide](https://www.ludo.guide/guide/two-point-hospital/room-prestige)).

**Complaint.** Players reach top prestige by "item spamming" (gold stars, cabinets crammed
into minimum-size rooms) ([Steam discussion](https://steamcommunity.com/app/535930/discussions/0/3335371283875523924)).
The score rewards clutter, not good rooms.

**For us.** "A room is what's in it, with a minimum size" is right. The spam problem is the
warning: any score built from adding things must have diminishing returns or a cap, and
space must stay a ceiling (which we already do).

#### Prison Architect (Introversion, 2015)

**Core loop.** Build a prison, run it: cells, canteen, showers, yard; staff; regime; security.

**Layout decisions.**
- **Rooms are zones made valid by objects.** An office must be 4x4 with desk, chair and filing
  cabinet; a shower needs a shower head on the water supply
  ([Prison Architect wiki via search](https://prison-architect.fandom.com/wiki/Category:Rooms)).
- **Utilities with falloff.** Water comes from a pump; large pipes carry pressure far, small
  pipes lose it quickly, so taps must stay near a main. Cookers and fridges need their own
  cable; two generators on one circuit short out
  ([Paradox guide of guides](https://admin-forum.paradoxplaza.com/forum/threads/the-prison-architect-guide-of-guides.1502294)).
- **Regime.** An hour-by-hour timetable for prisoners: sleep, eat, shower, yard, work. Layout
  and timetable interact: one canteen and one shower block create a crush at mealtimes.
- **Deployment** assigns guards to zones; sectors set who may go where.

**Information.** Overlays for utilities, a needs bar per prisoner, reports per area.

**For us.** The regime is the clever bit for a block of flats: *everyone wants the bathroom
at 07:30*. A shared bathroom or one stair is a timetable problem, not just a space problem,
and our tenants already have schedules. The pipe-laying is the part to avoid (see Part 3).

### Colony sims with room value

#### RimWorld (Ludeon, 2018)

**Room stats.** Impressiveness from wealth, beauty, space and cleanliness, "weighted towards
the lowest" so one weak stat drags the room down. Named levels from "Awful" to "Wondrously
impressive", and the level, not the number, gives the mood: an impressive bedroom is +3 to +8
when slept in; an awful one is -2. Role (bedroom, dining room, rec room, barracks) comes from
whatever furniture scores highest; moods only apply when a pawn actually uses the room for
that role. Sharing: a bedroom with unpaired beds becomes barracks, which pawns dislike;
traits change it (Greedy wants an impressive bedroom, Jealous minds if someone's is better,
Ascetic dislikes luxury). Toggle the room-stats overlay with G
([RimWorld wiki: Room](https://rimworldwiki.com/wiki/Room)).

**Why it works.** The player sees two plain words ("Dull bedroom") and knows what to fix. The
weakest-link rule means you can't paper over a cramped room with gold.

**For us.** We already borrowed most of this. The two bits we haven't: **role from contents**
(a room becomes a bedroom by having a bed, so a box room with a bed counts, which is exactly
how you tempt someone into splitting a flat), and **traits that bend the reading** (Jealous,
Ascetic). Jealousy between neighbours over who got the better flat is a story generator.

#### Dwarf Fortress

Room value is the total value of floor, walls and furniture, with named tiers from "Meager
Quarters" to "Grand Bedroom"; nobles demand a minimum tier with specific furniture or get
stressed; overlapping rooms lose value
([DF wiki v0.34: Room](https://dwarffortresswiki.org/index.php/v0.34:Room)). The same idea as
RimWorld, with one extra: **a demanding tenant states a demand in tiers**, and you either meet
it or they fester. Overlap penalties are the interesting oddity: a space can't count twice.

#### Oxygen Not Included (Klei, 2019)

Side-on, cell-based, and the best reference for **things that travel through cells**. Heat
moves tile to tile through solids, liquids and gases; insulated tiles slow it; vacuum stops it;
hot pipes through living areas need insulating
([ONI wiki: Base cooling](https://oxygennotincluded.wiki.gg/wiki/Base_Cooling)). Plumbing and
gas pipes are drawn cell by cell. Rooms are recognised from walls and contents (a "Barracks"
with beds, a "Private bedroom" with one bed and some decor) and give bonuses. Every system has
an overlay: temperature, oxygen, liquids, power, decor, and you live in them.

**For us.** The proof that heat and damp moving through a side-on cell grid is readable *if*
there's a one-tap overlay for it. Also the warning: ONI's depth comes from per-tile physics
that would swamp a five-flat phone game. We should do it per room, not per tile (we already
do warmth per flat).

### People, placement and coverage

#### The Sims (build mode)

Rooms are whatever walls enclose. Build mode and live mode are separate; walls can be shown
up, cut away or down so you can see in. The Sims 1 had a "Room" need that décor and space
fed; The Sims 4 has an environment score from decorative objects, with Snobs more affected
([Steam discussion](https://steamcommunity.com/app/1222670/discussions/0/3088898048357930599/?l=koreana)).

**For us.** The walls-cutaway view is exactly the side-on problem solved: you need to see
inside rooms without walls hiding people. The separation of "build" from "live" (time can
run, but building is its own calm mode) is the pacing lesson.

#### RollerCoaster Tycoon and Planet Coaster

Guests have **thoughts** you can read ("I'm not paying that much to go on...", "This queue is
too long") which tell you what's wrong without a manual. In Planet Coaster, scenery near a
ride raises its rating; duplicate props show diminishing returns and value counts for more
than quantity ([Steam discussion](https://steamcommunity.com/app/493340/discussions/0/152391995416370261)).
Overlong queues turn guests away.

**For us.** Thoughts that name a cause are how we already speak. Diminishing returns on
duplicate items is the cure for Two Point's spam problem.

#### Cities: Skylines and SimCity

Zoning plus service coverage. Place a service and its coverage previews on the roads before
you commit; 19 info views show electricity, noise, pollution and the rest
([Paradox dev diary 9: info views](https://admin-forum.paradoxplaza.com/forum/developer-diary/cities-skylines-dev-diary-9-info-views.833752/post-18849702)).
Players learn buffers: keep homes away from industry, use offices as a buffer because they
neither make nor mind noise ([TrueAchievements tips](https://www.trueachievements.com/game/Cities-Skylines/walkthrough/2)).
SimCity before it taught a generation that land value comes from neighbours.

**For us.** The coverage preview while placing. The buffer zone as a deliberate tactic
(a bathroom or a cupboard between a bedroom and next door's living room is a buffer). Not the
19 overlays.

#### Islanders (Grizzly Games, 2019)

Place a building and the points it would score from its neighbours show as you move it, before
you commit ([Wikipedia](https://en.wikipedia.org/wiki/Islanders_(video_game))). Metacritic
82. The complaint: the best spot is often hidden a few cells from the obvious one, so you
hunt with the cursor ([Checkpoint Gaming](https://checkpointgaming.net/reviews/2025/07/islanders-new-shores-review-a-whole-new-world/)).

**For us.** The cleanest answer to "show information without hand-holding": the game says what
this placement would do, in its own terms, and you decide. The hunting complaint is avoided
by a coarse grid (few possible spots), which we have.

#### Mini Metro and Mini Motorways (Dinosaur Polo Club)

Scarce tools handed out a few at a time; each week you pick one upgrade from two. Restraint as
design: the team set hard rules up front (no hand-built levels, nothing art-heavy) and found it
"ironically liberating"; if they couldn't prototype a concept in two days it was too much
([Postmortem](https://www.gamedeveloper.com/audio/postmortem-dinosaur-polo-club-s-i-mini-metro-i-),
[GDC 2017: When Less Is More](https://www.gamedeveloper.com/design/attend-gdc-2017-and-learn-the-value-of-less-is-more-from-a-i-mini-metro-i-dev)).
The game is the map and the map is the interface.

**For us.** The building is the interface: overlays on the drawing, not panels about it. And
the habit of saying no to a mechanic unless it earns its place.

#### Overcrowd: A Commute 'Em Up (SquarePlay, 2019)

Side-on, multi-floor underground station on a grid; one item per cell; stairs and escalators
whose direction you choose; crowd flow
([Wikipedia](https://en.wikipedia.org/wiki/Overcrowd:_A_Commute_%27Em_Up)). Critics praised
the multi-floor ingenuity (which staircase goes up or down); players complained of arbitrary
constraints, fiddly placement and no undo
([VaporLens summary](https://vaporlens.app/app/726110/overcrowd_a_commute_em_up)).

**For us.** A side-on grid with stairs is legible and makes the stair a real decision. And:
**have undo**, and make constraints feel like the building's, not the game's.

#### Spiritfarer (Thunder Lotus, 2020)

Stack houses and workshops on a boat like Tetris; each spirit gets a house; put the kitchen
next to the garden to save walking
([Game Informer](https://gameinformer.com/review/spiritfarer/spiritfarer-review-the-long-way-home),
[TheGamer](https://www.thegamer.com/spiritfarer-best-boat-layouts-tips/)). Praised for warmth;
Game Informer found the loop has "an unfortunate amount of busywork". Each resident's house
is theirs and they say what they think of it.

**For us.** Residents with homes they comment on, in a tight stacked space, works. The
busywork warning again.

#### Block'hood (Plethora Project, 2017)

A vertical neighbourhood of blocks, each with inputs and outputs; a block that doesn't get its
inputs decays and is abandoned ([Wikipedia](https://en.wikipedia.org/wiki/Block%27hood)).
Decay from neglect, made visible on the block itself, is a nice idea; the input/output
economy is a factory game, which we aren't.

#### Sheltered, This War of Mine

Side-on cutaway shelters with people inside. Mentioned for the visual grammar only: a side-on
section through a building is instantly readable as "people's lives in rooms".

---

## Part 2. What's borrowable

Eleven mechanics, roughly in order of how much they'd do for layout as the core decision. Each
says what it is, where it's from, why it makes a real trade-off, how it fits a small side-on
block on a phone, the risk, and whether it's **agreed** (one of the ideas already decided) or
**new**.

### 1. A room's purpose comes from what's in it, and rent comes from the purposes

- **From:** RimWorld (role from furniture), Prison Architect (room valid only with its
  objects), Theme Hospital (minimum size), Landlord's Super (tenant class gated by area,
  bedrooms, stairs).
- **What:** No "room type" menu. A room with a bed is a bedroom; with a hob and sink it's a
  kitchen; with a loo it's a bathroom. Each purpose has a minimum size in cells and must have
  a window to count as a bedroom. The asking rent is read off the flat: number of bedrooms,
  a living room or not, total space.
- **Trade-off:** Every wall you put up decides what a space can be. A second bedroom raises
  the rent but takes the living room; a box room counts as a bedroom only if it's big enough
  and has a window, which is the honest/dodgy line.
- **Phone fit:** Good. The player places furniture they already understand; a small label
  ("bedroom", "box room", "not a bedroom: no window") appears on the room. No menus.
- **Risk:** Ambiguous rooms (a bed in the kitchen). Keep purposes few (bedroom, living,
  kitchen, bathroom, hall/store) and pick by a simple priority. Edge cases become jokes in
  thoughts, not rules.
- **Status:** **Agreed** (rooms take purposes, rent from bedrooms and space). The
  window-and-size test for "counts as a bedroom" is new and gives the council something to
  check.

### 2. Splitting and merging, with a payoff that isn't linear

- **From:** Fallout Shelter (three merged rooms beat three single rooms), Project Highrise
  (unit sizes for different tenants), Landlord's Super (bigger and better unlocks better
  tenants).
- **What:** Two small flats bring in more rent than one big one in the same space. But
  smaller flats attract poorer, younger, shorter-staying tenants, wear faster, share more
  walls (so more noise passes), need a second kitchen and bathroom on the wet stack, and
  past a line the council wants a licence and an inspection. A big flat gets families or
  professionals who stay.
- **Trade-off:** Income now against churn, wear, noise and the council later. It's the
  original sin of British landlording, which suits the tone.
- **Phone fit:** Splitting is "add a wall and a door"; merging is "knock through". Both are a
  couple of taps on the existing grid.
- **Risk:** A dominant strategy (split everything). The counterweights must be real and
  visible: the council, the stair noise, people leaving. Tune with the soak tests.
- **Status:** **Agreed** (splitting as a temptation). Merging as the reverse move, and
  churn/wear as the cost, are the new details.

### 3. Emitters, sensitivities and buffers

- **From:** Project Highrise (noise, smell, traffic; small offices as buffers), Cities:
  Skylines (offices as buffer zones), Yoot Tower (stairs and lifts make noise), The Tenants
  (noise as a weapon).
- **What:** Activities and fixtures make noise (telly, washing machine, the stair, the
  front door, a teenager's drum kit); rooms differ in how much it matters (a bedroom at night
  is the worst place, a hall or bathroom barely cares). Tenants differ in sensitivity (light
  sleeper, night worker sleeping by day, deaf old Bill). The layout move is the buffer: put
  the bathroom or a cupboard between your bedroom and next door's living room, stack
  bedrooms over bedrooms and kitchens over kitchens.
- **Trade-off:** The quiet layout and the most rentable layout are rarely the same. A stair
  next to a bedroom saves space and costs sleep.
- **Phone fit:** Excellent, because it's room-to-room and the block is small. We already
  pass noise per shared tile; the step is making *room purpose* set the sensitivity, so where
  you put the bedroom matters, not just which flat.
- **Risk:** Hypersensitive tenants (Project Highrise's own bug). Give every tenant a floor of
  tolerance, and let familiarity and liking a neighbour soften complaints.
- **Status:** **Agreed** (noise travels). Room-purpose sensitivity and buffer rooms are the
  new parts. "Noise as a ruthless tool" (The Tenants' trumpeter) fits the nice-or-ruthless
  rule and could be a card.

### 4. Heat and damp that move between rooms, and materials that stop them

- **From:** Oxygen Not Included (heat through tiles, insulation), Theme Hospital (radiators
  per room size).
- **What:** Heat leaks through outside walls and the roof and is shared between neighbours
  (the flat over a warm flat is cheaper to heat). Damp comes from bathrooms and kitchens
  without ventilation, from the ground floor, and from a leaking riser, and creeps into the
  next room. Insulation, an extractor fan, a window, or a damp-proof course stops it.
- **Trade-off:** Where the bathroom goes decides who gets the damp. An internal bathroom
  saves the window for a bedroom but needs a fan. The top flat is the coldest; the ground
  flat the dampest.
- **Phone fit:** Keep it per room, not per cell; one number per room shown by colour in an
  overlay. We already do warmth per flat; going to per room is the step, and probably as far
  as it should go.
- **Risk:** Simulation cost and illegibility. ONI-style per-tile fields would be too much to
  read on a phone. Damp should move slowly (days), so it's a creeping consequence, not a
  twitch.
- **Status:** **Agreed** (heat and damp travel). Per-room rather than per-cell resolution is
  a recommendation.

### 5. The wet stack

- **From:** Prison Architect (pressure falls off away from a main), Project Highrise
  (utilities reach units floor by floor), ONI (plumbing).
- **What:** One soil stack and riser running up the building. Kitchens and bathrooms must be
  within a short run of it (say two or three cells); further costs a pump or isn't allowed.
  The stack can be moved or a second added, at real expense and mess.
- **Trade-off:** It pins the wet rooms to one column, so it decides the plan of every floor.
  Stacking bathrooms over bathrooms is cheap; putting one where the tenant wants it is not.
  A leak in the stack wets every flat below, so it's also a risk you share out.
- **Phone fit:** Very good. It's a visible vertical line in a side-on view, which a phone
  shows naturally. No pipes to draw: the stack is a fixed feature and wet rooms near it
  "connect" automatically.
- **Risk:** Turning into pipe-laying. Never let the player draw pipes; never ask about
  pressure. One rule (distance to the stack), one visible line.
- **Status:** **Agreed.**

### 6. Placement preview: show what a change would do before you make it

- **From:** Islanders (score preview while placing), Cities: Skylines (coverage preview).
- **What:** While dragging a wall, door or piece of furniture, the affected rooms show small
  deltas in our own words and icons: "+£15 a week", "Flat 2 bedroom: louder", "no window:
  not a bedroom", "too far from the stack". Commit or cancel.
- **Trade-off:** It doesn't create one, it reveals them. It makes layout a decision instead of
  a guess, so the player argues with the building, not with hidden maths.
- **Phone fit:** Good if limited to two or three badges near the finger. Must not cover what
  you're placing.
- **Risk:** Turning the build into number-chasing (the Islanders "hunt the best spot"
  complaint). Show words and arrows, not exact scores; show at most three effects; let some
  things (who'll actually complain) only show once people live there.
- **Status:** **New.** Probably the single most useful addition for making layout the core.

### 7. One-tap lenses on the building

- **From:** Oxygen Not Included overlays, Cities: Skylines info views, RimWorld room stats
  (G), Prison Architect utilities.
- **What:** A small set of overlays drawn on the side-on view: noise (last night), warmth,
  damp, rent per room. Tap to toggle, tap a room to see the two or three things behind its
  colour.
- **Trade-off:** None in itself; it's how the player sees the trade-offs of 3, 4 and 5.
- **Phone fit:** Good. The block is small and fits one screen; colour per room is legible.
- **Risk:** Overlay sprawl (Cities has 19). Cap it at four. If a fifth seems needed, one of
  the systems is probably too fiddly.
- **Status:** **New** as a feature, supporting agreed ideas.

### 8. Who lives where: visible fit between a person and a flat

- **From:** Tiny Tower (dream job), Fallout Shelter (SPECIAL letter on the room), Project
  Highrise (tenant likes and dislikes), Dream House Days (rent capped by salary).
- **What:** Applicants carry a few readable needs that interact with layout and neighbours:
  works nights, has a baby, plays an instrument, light sleeper, needs ground floor, has a dog,
  can't do stairs. And a ceiling: what they can afford. A flat's fit for a person shows on the
  applicant card as a few icons against that flat ("quiet bedroom", "over a telly", "four
  flights").
- **Trade-off:** The best-paying applicant may be the worst neighbour for the people already
  there. The night worker is perfect under the musician and terrible over the baby.
- **Phone fit:** Already how applicants work; the change is that their fit is read off the
  layout, so building and letting become one decision.
- **Risk:** The Tenants' complaint: once wishes are known the puzzle is solved and it's
  chores. Keep needs few, reveal some only after moving in (the habit you learn by watching),
  and let lives change (a baby arrives, a job changes to nights).
- **Status:** **Agreed** (who lives where matters). The affordability ceiling and the
  revealed-later habits are new details.

### 9. Shared spaces as timetables, and as where stories start

- **From:** Prison Architect (regime: everyone eats at once), Dream House Days (benches in
  hallways lead to couples), Theme Hospital (queues).
- **What:** Anything shared (one bathroom between two bedsits, the stair, the bins, a shared
  washing machine) has a rush hour, because tenants have schedules. A shared bathroom at 07:30
  is a queue and a row. A landing with room for a chair is where neighbours chat and
  friendships or feuds begin.
- **Trade-off:** Shared facilities save space and money and cost goodwill at rush hour; a
  generous landing costs a cell of rentable space and buys community.
- **Phone fit:** Good. We already have schedules and moments; this just makes layout feed
  them. The queue is visible as people standing on the landing.
- **Risk:** Becoming a scheduling puzzle the player must solve. The landlord never sets
  anyone's timetable ("landlord, not puppeteer"); the clash is something you design round or
  live with.
- **Status:** **New**, and it ties layout to the minute-to-minute work.

### 10. Named grades with a weakest link, and diminishing returns on stuff

- **From:** RimWorld (weighted to the lowest, named levels), Dwarf Fortress (tiers a demanding
  tenant asks for), Two Point Hospital (prestige, and its item-spam problem), Planet Coaster
  (duplicate props count for less).
- **What:** Keep our named tiers, and add: the second, third and fourth of the same
  decoration in a room count for less; a demanding applicant asks for a tier in plain words
  ("a decent double", "a proper kitchen").
- **Trade-off:** You can't buy your way to "impressive" with a skip-load of plants; you have
  to fix the weak factor, which is usually space, light or quiet, which is to say layout.
- **Phone fit:** Already in place; it's tuning.
- **Risk:** Little. The spam fix is a curve in `tuning.ts`.
- **Status:** Mostly **already done**; diminishing returns and stated demands are new.

### 11. Circulation is a neighbour

- **From:** SimTower and Yoot Tower (traffic noise and stress), Overcrowd (stairs as a real
  choice), Fallout Shelter (lift shafts, raiders come in at the door).
- **What:** The stair, the front door, the landings and the bins are places, not just paths.
  They make noise and traffic for the rooms beside them, they let in the cold, the burglar
  comes in through them, and the flat at the top of four flights is worth less to some
  tenants and more (quieter, a view) to others.
- **Trade-off:** Where the stair goes decides which bedrooms hear it. A second stair or a
  better front door costs space or money and buys quiet and safety.
- **Phone fit:** Good. In a side-on block the stair is the most visible thing on screen.
- **Risk:** Turning into lift management. No lifts, or one lift as a late, expensive, noisy
  luxury. No timetables.
- **Status:** **New** as a framing, though noise from stairs exists in part already.

---

## Part 3. What not to borrow, and why

- **Lift timetabling (SimTower).** It's the heart of SimTower and the reason it was slow. A
  small block has a stair; traffic is not the interesting problem.
- **Drawing pipes and cables (Prison Architect, ONI, Project Highrise).** Satisfying on a
  mouse, miserable by thumb, and it turns layout into plumbing. One fixed riser, one distance
  rule.
- **Per-tile physics fields (ONI).** Per room is enough resolution to read on a phone and to
  make stories. Per tile adds cost and noise, in both senses.
- **Score-by-clutter (Two Point Hospital prestige, The Sims 4 environment points).** It
  rewards cramming objects into minimum rooms, the opposite of good layout. Space stays a
  ceiling; repeats count less.
- **Taste checklists (The Tenants, House Flipper).** "Likes blue walls" is solved once, then
  it's chores. Prefer needs that interact with neighbours and layout, which change as people
  move in and out.
- **Furniture recipes (Dream House Days special rooms).** Hidden combinations you look up in
  an info tab are a wiki game, not a layout game.
- **Timers, rushing, collecting and restocking (Tiny Tower, Fallout Shelter).** They fill
  attention with chores, and they're there to sell speed-ups. The minute-to-minute spec's
  rule stands: no time tricks.
- **Survival needs for the landlord, and building brick by brick in person (Landlord's
  Super).** Fiddly and tedious by its fans' own account. If the live-in landlord comes back,
  "jobs, not steps" and light needs.
- **Prestige stars and long gates (SimTower, Project Highrise).** "Waiting for cash to grow"
  was the main complaint about SimTower. Let better tenants follow from the flat being better,
  not from a building-wide star.
- **Contracts, consultants, multiple buildings, sky bridges, districts (Project Highrise,
  Yoot Tower, The Tenants).** More of the same at a larger scale. Five flats that matter beat
  fifty that don't.
- **Dozens of overlays (Cities: Skylines).** Four lenses at most.
- **Tower defence and combat (Unholy Heights, Fallout Shelter raiders).** Off-tone.
  Burglaries already cover "something comes in through the front door".
- **Location-based anything (Landlord Go).** No.

## Short version

The games that make layout matter all do the same three things: a room's worth comes from its
neighbours as much as its contents (Project Highrise, Cities, Islanders); some fixed feature
pins the plan (the lift core in SimTower, the riser for us); and the player can see what a
change will do before and after making it (Islanders' preview, ONI's overlays, RimWorld's two
words). Landlord already has the scoring and the noise; the biggest gains are the **placement
preview**, **room purposes setting sensitivity** (so noise, heat and damp land on the bedroom,
not just the flat), **the wet stack** as the one fixed line, and **splitting** with real
costs. The games that went wrong went wrong by adding chores (pipes, timers, restocking,
clutter scores) or by making tenants a checklist. Keep the tenants people.
