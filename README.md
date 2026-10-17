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

There are two so far: **the café** (mornings, flat whites, cake) and **the pub** (evenings, pints, crisps, quiz night, stag dos). To switch, open the venue panel's **Save** tab and tap *New game*. Or add `?venue=pub` to the address to skip straight in. Venues live in `src/sim/venues.ts`, so adding one is mostly data.

## Empty lot

Pick **Empty lot** instead of *Ready to open* to start from four walls, a front door, bare floor and £8,000 (the standard start has £500 and everything fitted). The game opens paused in build mode. Lay out the rooms with walls, doors and floors, then buy everything, the counter included. Nobody comes in, gets paid or orders anything until there's a counter and a drinks machine; a red alert lists what's still missing, and the build bar suggests what to get next (sink, toilet, seats, staff sofa). Machines and sinks need counter or kitchen floor, toilets need toilet floor, and staff furniture needs staff room floor. Rent still runs while you build. Add `?layout=empty` to the address (with `?venue=`) to skip straight in.

The till, queue and pickup point are worked out from the counter, so they move with it (shown as dashed squares in build mode: green for staff, amber for customers). The counter needs open floor behind it for staff and in front for the queue, can only be moved while no customers are in, and you can't sell your only one. This works in the standard layouts too.

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
- **Staff** has four tabs. **Team**: today's numbers; each card has a **Station** and an **In a rush** station, *Shift* (hours and days off), *Break now*, *Send home*, *Edit* (name, looks, traits and catchphrases), *Live in* (once there's a staff flat) and *Lead* (one shift lead, +£1.50/h: a lead in good spirits steadies the team, one in a foul mood drags it down). **Jobs**: work priorities, and walking time per task (long walks mean the layout is costing you). **Hire**: applicants, with their passions and asking wage. **Log**.
- **Who's on what:** every member of staff at work has a badge over their head and a ring at their feet in the colour of what they're doing: green till (counter), brown cup (barista), blue tray (floor), teal suds (dishes), purple mop (cleaning). Solid means their own station, a white badge with a dashed ring means they're helping out, and faded means they're waiting at their post. The person sheet shows the same as a coloured chip (On / Helping / Waiting), the Jobs columns carry the colours, and the station pickers on Team cards are edged in theirs.
- **Who does what:** staff stick to their station: when it's quiet they wait at their post, and only help elsewhere after about 8 in-game minutes with nothing to do, straight away if another area is in a rush (4+ queuing, 4+ drinks waiting, 3+ dirty tables, 8+ cups by the sink, 2+ spills) or nobody covers it, or when a need gets urgent. Without a station they settle into whatever they start (4 minutes before drifting; a better-priority job wins after a 20-minute stint). Helping shows as "(helping out)".
- **Café** has **Menu** (prices and on/off switches), **Place** (stars and capacity, how it feels, *Build and rearrange*, machines, the staff flat, running costs, regulars), **Goals** (goals, the diary, weekly reports, scrapbook, hall of fame) and **Save**. The game also saves itself on this device every day and when you leave.
- **Build mode**: **Furniture** (drag to move, tap to sell, pick from the row to buy, *Footfall* shows where people walk), **Walls** (straight walls £25 a tile, doors £60, knock out for free) and **Floors** (£5 a tile; kitchen, staff room, toilet and staff flat floors decide what goes where). The outer walls, shop front and pavement stay put, and anything that would cut people off is refused. *Undo* takes back the last stroke. Two fingers (or right-drag) move the view.

## Goals and big days

- Three **goals** at a time (serve N in a day, a day with hardly any walkouts, the next star, more regulars, train someone up, a week's profit, close with everyone happy), each with a deadline and a cash reward.
- The **diary**, announced a few days ahead: the **food festival** every two weeks (about 1.7× customers all day), the **health inspection** every three weeks at 11:00 (pass for fame and a council payment), and **Café of the Year** judging every four weeks (three stars, almost no walkouts and a clean room wins £500).
- **Stars unlock** new menu items (a bigger menu draws a few more people), critics (from 2★), office catering orders (from 2★) and influencers (from 4★).
- A **weekly report** in the Inbox and on the Goals tab.

## People

- Rows and meltdowns upset whoever sees them. Couples who fall out split up, and exes on shift together are miserable. Couples sometimes vanish from the floor together.
- When someone leaves, a close friend who isn't happy either may follow (unless you talk them round). Good people ask for raises, and from two stars rivals try to poach them. Work anniversaries every 30 days.
- **Catchphrases**: up to three lines per person in the character editor, for recreating real colleagues. They come out in conversation.

## The staff flat

Every venue has an empty plot alongside. Build a flat there by hand (Staff flat floor, beds, a telly, sofas, a fridge) or in one go for £1,500 from the Place tab. Staff can then **live in** (one per bed): they stay on site off shift and live there (telly, snacks, each other, bed at bedtime), pay £8 a night, and never miss a shift to the commute. The view only takes in the plot once something's built on it.

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
    flat.ts      the staff flat and live-ins
    normalize.ts fills in new fields for new games and older saves
    structure.ts building work: walls, doors and floors, and what keeps the layout usable
    regulars.ts  guests who come back, remember, and hold grudges
    wants.ts     what each staff member would like to happen
    ambience.ts  cleanliness, looks, spills and slips
    venues.ts    each venue as data: map, furniture, menu, hours, rhythm, wording; the empty shell and counter-relative service spots
    fitout.ts    what a place needs before it can open
    path.ts      A* pathfinding
  render/    canvas drawing in the Pawn style
  ui/        touch input, the HUD, the start screen and the character creator
test/        simulation tests
```

The simulation never reads the renderer, and the renderer never changes the simulation.
