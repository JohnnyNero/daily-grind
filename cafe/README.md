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

The start screen offers **Continue** (your saved place), **New game** and **Import save**. A new game asks what you're opening and how to start (see *Empty lot* below), then shows your starting team in the **character creator**: tap someone to change their name, skin, hair and up to three traits with a live preview, or use *New face* for a random person, *Add someone* (up to 8), *Remove* and *Shuffle everyone*. *Open the doors* starts day one.

## Venues

There are three: **the café** (mornings, flat whites, cake, a kitchen), **the pub** (evenings, pints, crisps, quiz night, stag dos) and **the cinema** (films on a timetable, tickets, popcorn, a lounge). To switch, open the venue panel's **Save** tab and tap *New game*. Or add `?venue=pub` or `?venue=cinema` to the address to skip straight in. Venues live in `src/sim/venues.ts`, so adding one is mostly data.

## Empty lot

Pick **Empty lot** instead of *Ready to open* to start from bare ground (a bigger lot than the ready-made buildings: 36 by 32 tiles), the pavement and £10,000 (the standard start has £500 and everything fitted). There are no walls and no front door: build them wherever you like (or don't), right up to the pavement and the edges of the plot, which aren't fixed on an empty lot. Customers arrive anywhere along the pavement and find their own way in. The game opens paused in build mode. Lay out the rooms with walls and doors, mark what they're for with zones, then buy everything. Nobody comes in, gets paid or orders anything until there's a **till, a pickup counter and a drinks machine**; a red alert lists what's still missing, and the build bar suggests what to do next (queue and pickup areas, a staff-only area, a food counter, sink, toilet, seats, staff sofa). Furniture can go on any floor. Rent still runs while you build. Add `?layout=empty` to the address (with `?venue=`) to skip straight in.

## The counter, the queue and pickup

The counter comes in pieces, each one tile, so it can be any shape or split into separate stations:

- **Till** (£400): staff stand behind it, the customer at the front of the queue stands in front.
- **Pickup counter** (£150): drinks and food are put out here, and customers collect from the front.
- **Food counter** (£250, optional): where cake and food are plated. Without one, food is plated at the pickup.
- **Counter / bar sections** (£80): plain lengths to join it all up.

There's one till, one pickup and one food counter per place. In build mode, dashed squares show where people stand: green for staff, amber for customers. Service pieces need open floor on both sides and can only be moved while no customers are in.

## Floors and zones

**Floors are only for looks**: wood, carpets, lino, tiles, steel or boards, £5 a tile, under furniture too. What a room is *for* comes from **zones**, painted for free in build mode's **Zones** tab. A tile is in one zone at most:

- **Staff only**: the back of house (behind the counter, the kitchen, the staff room). Customers never walk in, and their seats don't count. Staff hang about here when there's nothing to do, and sulk here when they're upset. You can't mark the customer side of a till or pickup as staff only, or fence customers off from them.
- **Screen**: a cinema screen room (see *The cinema*).
- **Queue** and **Pickup area**: below.
- **Clear** removes any zone.

The ready-made places and older saves get their zones from what the floors used to mean: kitchen, behind-the-counter and staff room floors became staff only, screen floor became a screen. Furniture stands in staff-only and screen zones as normal, but not on the queue or pickup.

The queue and pickup zones:

- **Queue**: the queue starts at the spot in front of the till and runs back along joined-up queue floor, nearest first. Numbers show each place in line; faded tiles aren't joined up to the till, so nobody queues there. A longer queue lets more people wait (up to 16), but they still lose patience.
- **Pickup area**: where customers wait for their order, nearest the pickup first. If it's full or missing, people stand off to the side, clear of the queue.

Furniture and walls can't go on the queue, the pickup area or service spots. Older saves are converted automatically: the old one-piece counter becomes pieces in the same places, with the old queue and waiting spots marked as zones.

**Rotating**: select furniture (or something you're buying) and tap **Rotate**, or press **R**. Where people sit or stand to use it turns with it, so a till turned sideways serves from the side.

## The kitchen

The café cooks hot food to order: **bacon rolls** and **cheese toasties** from the start, **eggs on toast** at two stars and a **full breakfast** at four. A cook preps each dish at a **prep counter**, cooks it in an **oven**, then carries it out to the pickup. That's the **Kitchen** job, with its own skill, priority and station (frying-pan badge).

- The opening team includes a cook (7:30 to 14:30, stationed in the kitchen, kitchen skill 5 or better). When the kitchen is quiet they help out front like any station.
- Hot food takes a few minutes, so customers who order it are more patient while they wait. It costs more, and pulls people off the floor if nobody's stationed in the kitchen.
- One oven and one prep counter cook one dish at a time. Buy more to have two cooks going at once.
- No oven or prep counter (sold, or not built yet on an empty lot): hot food comes off the menu automatically. The Menu tab marks hot dishes "Cooked in the kitchen" or "Needs an oven and prep counter". An alert shows if hot food is on and nobody on shift can cook.
- Older saves get the new dishes, and everyone gets a kitchen skill and priority 3.

## The cinema

Two screens of 16 seats each, a lobby with the box office and snacks, and a lounge.

- **Films run on a timetable.** Each screen shows films back to back, with 20 minutes between one ending and the next starting. Screen 2 starts 40 minutes after Screen 1, so their rushes don't land at the same time. Today's films are listed at the top of the **Menu** tab with how many seats are booked; the top bar shows when the next one starts.
- **Film-goers swell in before each start.** They start arriving about 50 minutes before, busiest 10 minutes before the start. Each buys a **ticket** at the till (no making, the till prints it), and about half add popcorn, nachos or a drink to collect from the pickup. Then they wait in the lobby until the **doors open** 12 minutes before the start, once the last audience is out. They go in, watch, and **all leave together** when it ends.
- **Miss it and they walk.** Anyone still queuing or waiting for snacks 10 minutes after the start gives up and wants their money back. A red alert warns when a film is about to start with people still not served. The queue out the door before a big film is the puzzle: who's on the box office, who's on drinks, and how long the queue zone is.
- **Clearing up between films.** People leave cups and tubs on the seats. Floor staff take it to the nearest litter bin (there's one in each screen) or sink. The next audience grumbles if they sit in it.
- **Some people just come for the lounge**: a drink and a sit-down, like café customers.
- **Money:** a ticket is £9.50, but the film's distributor takes 60% of it. Snacks are where the margin is. Rent is higher than the café's.
- **Building screens**: a screen is a room marked as a **Screen** zone (Zones tab) with a **cinema screen** in it (£1,500). Every **row of seats** (£600, four seats) in that zone is its audience. More screens or seats means more showings and bigger audiences; the timetable adapts on its own. An empty-lot cinema starts with none.
- The opening team has a box office person on the morning and afternoon shifts, and drinks in the evening.

## How it plays

You run the place; your staff decide what to do. The puzzle is keeping it running as it gets busier, and the people are both the problem and the reward.

- **Fame and stars.** Happy customers spread the word, walkouts, queues out the door and bad reviews undo it, and it fades a little each night. Fame brings more customers; fame times reputation gives the 1–5 star rating in the top bar. A good café gets busier until the layout and the team are the limit.
- **Money.** Takings in; wages (each person's own, rising with skill and raises), ingredients (18% of the usual price of everything made), rent and business rates (which rise with the value of your fit-out), repairs and services out. People pay up to 8% more per star without minding. In the red you pay overdraft fees, wages go out late below £250 overdrawn, and below £500 the bank stops lending for furniture and building work. Nothing ends the game; recovering takes days.
- **Skill and passions.** Skill sets speed (0.4× to 1.6×) and quality, grows slowly with practice, and much faster in what someone loves (an orange dot on the Jobs grid). Switching between kinds of work costs a little settling-in time, so specialists win.
- **Machines** wear with every drink: worn ones make worse drinks and break down more. A service (£60, Place tab) makes them new; a bodge repair doesn't.
- **Stress and days off.** Shifts, rushes, low mood and long days build stress; time off eases it. Past 60 it shows in mood, past 85 people are burnt out and sometimes off sick with it. Everyone has a day off a week (set them in the shift editor); the top bar shows the weekday.
- **Rushes** are announced 15–30 minutes ahead and grow with fame. Coach parties in the café, stag dos in the pub.

## Controls

- Drag to pan, pinch (or scroll wheel) to zoom; the corner button fits the café back on screen.
- **Time**: pause, 1×, 3× and 8× in the top bar. At 1× an in-game minute takes 2.5 seconds, slow enough to watch who's doing what; a ten-hour day is about 25 minutes at 1×, 8 at 3× and 3 at 8×. While nobody's working the clock skips ahead to the morning. Big moments (a letter or decision, a rush on its way, a meltdown) drop fast-forward back to 1× so you see them.
- **Stories** pop up at the top one at a time, each long enough to read (+N shows how many are waiting); tap one to jump to that person and move on to the next.
- **Alerts** under the top bar say what's wrong right now (nobody on the till, a rush coming, someone close to breaking, washing up piling up, in the red...). Tap one to jump to the person or panel.
- **Inbox**: big news and decisions (a raise request, a rival trying to poach someone, a friend thinking of following someone out). Decisions wait until closing time the next day, then take their first option.
- **Calls**: three direct orders for a crisis, each with a cost and a cooldown. *All hands* (20 minutes of nobody waiting at their post; a little stress), *Close the doors* (no arrivals for 20 minutes; a little fame), *Comp a round* (everyone waiting gets patience back; costs money, earns fame).
- Tap a person to see what they're doing: traits, mood and its biggest reasons, stress and needs; *Show more* adds every reason, how they feel about each colleague and what they want. Guests show their order and patience.
- When the place shuts, the day's recap appears.
- **Staff** has four tabs. **Team**: today's numbers; each card has a **Station** and an **In a rush** station, *Shift* (hours and days off), *Break now*, *Send home*, *Edit* (name, looks, traits and catchphrases) and *Lead* (one shift lead, +£1.50/h: a lead in good spirits steadies the team, one in a foul mood drags it down). **Jobs**: work priorities, and walking time per task (long walks mean the layout is costing you). **Hire**: applicants, with their passions and asking wage. **Log**.
- **Who's on what:** every member of staff at work has a badge over their head and a ring at their feet in the colour of what they're doing: green till (counter), brown cup (barista), blue tray (floor), teal suds (dishes), purple mop (cleaning). Solid means their own station, a white badge with a dashed ring means they're helping out, and faded means they're waiting at their post. The person sheet shows the same as a coloured chip (On / Helping / Waiting), the Jobs columns carry the colours, and the station pickers on Team cards are edged in theirs.
- **Who does what:** staff stick to their station: when it's quiet they wait at their post, and only help elsewhere after about 8 in-game minutes with nothing to do, straight away if another area is in a rush (4+ queuing, 4+ drinks waiting, 3+ dirty tables, 8+ cups by the sink, 2+ spills) or nobody covers it, or when a need gets urgent. Without a station they settle into whatever they start (4 minutes before drifting; a better-priority job wins after a 20-minute stint). Helping shows as "(helping out)".
- **Name tags**: every staff member has a small name tag under them (gold when selected).
- **Café** has **Menu** (prices and on/off switches), **Place** (stars and capacity, how it feels, *Build and rearrange*, machines, running costs, regulars), **Goals** (goals, the diary, weekly reports, scrapbook, hall of fame) and **Save**. The game also saves itself on this device every day and when you leave.
- **Build mode**: **Furniture** (drag to move, tap to sell, pick from the row to buy, *Footfall* shows where people walk), **Walls** (straight walls £25 a tile, doors £60, knock out for free) and **Floors** (£5 a tile, just for looks) and **Zones** (free: queue, pickup, staff only, screen). The outer walls, shop front and pavement stay put, and anything that would cut people off is refused. *Undo* takes back the last stroke. Two fingers (or right-drag) move the view.

## Goals and big days

- Three **goals** at a time (serve N in a day, a day with hardly any walkouts, the next star, more regulars, train someone up, a week's profit, close with everyone happy), each with a deadline and a cash reward.
- The **diary**, announced a few days ahead: the **food festival** every two weeks (about 1.7× customers all day), the **health inspection** every three weeks at 11:00 (pass for fame and a council payment), and **Café of the Year** judging every four weeks (three stars, almost no walkouts and a clean room wins £500).
- **Stars unlock** new menu items (a bigger menu draws a few more people), critics (from 2★), office catering orders (from 2★) and influencers (from 4★).
- A **weekly report** in the Inbox and on the Goals tab.

## People

- Rows and meltdowns upset whoever sees them. Couples who fall out split up, and exes on shift together are miserable. Couples sometimes vanish from the floor together.
- When someone leaves, a close friend who isn't happy either may follow (unless you talk them round). Good people ask for raises, and from two stars rivals try to poach them. Work anniversaries every 30 days.
- **Catchphrases**: up to three lines per person in the character editor, for recreating real colleagues. They come out in conversation.

## The back plot

Every venue has an empty plot alongside, 20 tiles wide: room for a bigger building or a second screen. Older saves get theirs widened when loaded, and the view only takes in the plot once something's built on it. (The staff flat and living in have been taken out: older saves lose any beds and tellies, and live-ins go home like everyone else.)

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
    business.ts  fame, stars, demand, capacity, prices, costs, machine wear
    books.ts     the overnight books: rent, the week, and the morning's checks
    stakes.ts    stress, burnout, days off and debt
    letters.ts   the inbox: big news and decisions
    alerts.ts    standing alerts, worked out from the state
    calls.ts     the manager's direct orders
    careers.ts   raises, poaching, shift leads, anniversaries, friends following
    goals.ts     goals, the diary of big days, star unlocks, weekly reports
    normalize.ts fills in new fields for new games and older saves
    structure.ts building work: walls, doors and floors, and what keeps the layout usable
    regulars.ts  guests who come back, remember, and hold grudges
    wants.ts     what each staff member would like to happen
    ambience.ts  cleanliness, looks, spills and slips
    venues.ts    each venue as data: map, furniture, menu, hours, rhythm, wording; the empty shell
    kitchen.ts   hot food: whether the kitchen can cook, and its backlog
    cinema.ts    screens, the film timetable and the swell of film-goers before each start
    service.ts   where service happens: till, pickup and food counter pieces, queue and pickup zones
    fitout.ts    what a place needs before it can open
    path.ts      A* pathfinding
  render/    canvas drawing in the Pawn style
  ui/        touch input, the HUD, the start screen and the character creator
test/        simulation tests
```

The simulation never reads the renderer, and the renderer never changes the simulation.
