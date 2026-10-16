# Daily Grind (working title)

A café sim for phones. You set up the café, staff it with characters you made up or recognise from work, and watch it run. Inspired by RimWorld's emergent drama and the Sims' everyday autonomy; drawn in the "Pawn" style.

The full design and the decisions behind it are in [`docs/SPEC.md`](docs/SPEC.md).

## Run it

```sh
npm install
npm run dev        # serves on your network; open the printed address on your phone
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Runs the simulation and stress tests (headless, no browser, about 5 seconds) |
| `npx vite-node test/soak.ts 6 30 4` | Long soak: 6 seeds × 30 days per venue with 4 random manager actions an hour, saving and reloading every 6 hours, checking every invariant |
| `npm run typecheck` | TypeScript checks |
| `npm run build` | Builds a static site into `dist/` that works from any folder |

Add `?seed=123` to the URL to skip the start screen and open a fresh café from that seed (it ignores the saved one).

## Play online

Every push to `main` is tested, built and deployed to GitHub Pages by `.github/workflows/deploy.yml`:
https://johnnynero.github.io/daily-grind/

## Install on your phone

Open the site, then use your browser's *Add to Home Screen* (Share → Add to Home Screen on iPhone; the menu → Install app on Android). It then opens full screen and works offline.

## Starting a game

The start screen offers **Continue** (your saved place), **New game** and **Import save**. A new game asks what you're opening, then shows your starting team in the **character creator**: tap someone to change their name, skin, hair and up to three traits with a live preview, or use *New face* for a random person, *Add someone* (up to 8), *Remove* and *Shuffle everyone*. *Open the doors* starts day one.

## Venues

There are two so far: **the café** (mornings, flat whites, cake) and **the pub** (evenings, pints, crisps, quiz night, stag dos). To switch, open the venue panel's **Save** tab and tap *New game*. Or add `?venue=pub` to the address to skip straight in. Venues live in `src/sim/venues.ts`, so adding one is mostly data.

## Controls

- Drag to pan, pinch (or scroll wheel) to zoom; the corner button fits the café back on screen.
- Tap a person to see what they're doing. Staff show their traits, mood and its biggest reasons, and needs; *Show more* adds every reason, how they feel about each colleague and what they want. Guests show their order and patience.
- Events (rows, romances, meltdowns, quitting, coach parties, a broken machine, the critic) pop up at the top; tap one to jump to that person.
- When the café shuts, the day's recap appears: the numbers, the best stories, a review and the star of the day. Tap **Next day** to carry on.
- **Staff** (bottom right) has four tabs: **Team** (today's numbers; edit shifts, *Break now*, *Send home*, *Edit* names, looks and traits, or let someone go), **Jobs** (work priorities: tap a cell to cycle 1 first to 4 last, or off; staff take the nearest job at their highest priority unless a need is urgent), **Hire** (applicants) and **Log** (recent events and the last recap).
- **Café** has **Menu** (prices and on/off switches), **Place** (how it feels, *Build and rearrange*, and your regulars), **Story** (scrapbook and hall of fame) and **Save** (*Save now*, *Export*, *Import*, *New game*). The game also saves itself on this device every day and when you leave.
- **Build mode** has three tabs. **Furniture**: drag anything to move it (it shows green where it fits, red where it doesn't), tap it to sell, or pick something from the row to buy, drag it into place and tap *Buy*. **Walls**: drag to draw a straight wall (£25 a tile), tap a wall to put a door in it (£60), or drag a box to knock walls and doors out (free). **Floors**: drag a box to lay wood, carpet, counter, kitchen, staff room or toilet floor (£5 a tile); kitchen, staff room and toilet floors decide where the oven, staff sofa or toilet can go. The outer walls, shop front and pavement are shaded and stay put, and anything that would cut people off from the counter or a piece of furniture is refused. *Undo* takes back the last stroke and refunds it. Two fingers (or a right-drag on a computer) move the view.
- Pause, 1×, 3×, 6× in the top bar. While nobody is on site the clock skips ahead to the morning.

## Layout

```
src/
  sim/       simulation only, no drawing; runs in tests
    defs.ts      content: needs, objects and what they offer, names, looks
    layout.ts    the starter café map and furniture
    sim.ts       the tick loop, shifts, jobs and life off site
    ai.ts        choosing what to do from object offers
    work.ts      staff work: finding tasks by priority, taking orders, making items, clearing, washing
    guests.ts    the guest visit: queue, order, wait, collect, sit or take away, leave
    thoughts.ts  the mood ledger: situational reasons, memories, opinion
    social.ts    staff interactions: chats, insults, rows, flirting, couples
    breaks.ts    low-mood breaks and high-mood inspirations
    storyteller.ts  when events happen and which: rhythm, scaling, adaptation
    tales.ts     the recap: picking fresh stories, headlines, reviews
    manage.ts    everything the player changes: rota, hiring, menu, furniture, saving
    structure.ts building work: walls, doors and floors, and what keeps the layout usable
    regulars.ts  guests who come back, remember, and hold grudges
    wants.ts     what each staff member would like to happen
    ambience.ts  cleanliness, looks, spills and slips
    venues.ts    each venue as data: map, furniture, menu, hours, rhythm, wording
    path.ts      A* pathfinding
  render/    canvas drawing in the Pawn style
  ui/        touch input, the HUD, the start screen and the character creator
test/        simulation tests
```

The simulation never reads the renderer, and the renderer never changes the simulation.
