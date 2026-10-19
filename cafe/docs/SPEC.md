# Daily Grind (working title): Café Sim Build Spec (v0.2)

A personal-project hospitality sim. You set up a café, staff it with people you made up or recognise from work, and watch it run. The tone is set by RimWorld's emergent drama and the Sims' everyday autonomy, drawn in the "Pawn" art style.

This spec takes its inspiration from two clean-room design reports (RimWorld 0.19 and The Sims 2 GameCube). No code or text from either game is used. Every system below is described in my own words and rebuilt from scratch.

> **How to read this spec.** You asked me not to assume anything, so every statement is tagged:
> - **[CONFIRMED]**: you decided it.
> - **[PROPOSED]**: my recommendation, waiting on your OK. Each one links to a question in §12.
> - **[OPEN]**: no default; I need your answer before building that part.
>
> Nothing tagged PROPOSED or OPEN will be built until you've answered.

---

## 0. Decisions log (round 2)

Every question in §12 now has an answer. You answered four; for the rest you said "your call", so each one takes the proposed default below. These answers override any **[PROPOSED]** or **[OPEN]** tag later in this document.

| Q | Decision | Who |
|---|---|---|
| 1 | The six pillars in §2 stand | Claude |
| 2 | Plan → open → close daily loop | Claude |
| 3 | 1 in-game hour ≈ 1 real minute at 1×. When nobody is on site, time fast-forwards to the next arrival | Claude |
| 4 | Vite + plain Canvas 2D + Vitest, no game engine | Claude |
| 5 | PWA install: later, not in the first milestones | Claude |
| 6 | **Code lives in a new folder: `cafe-sim/` in this repo** | You |
| 7 | Local autosave plus export/import | Claude |
| 8 | One 16 × 24 portrait lot for now | Claude |
| 9 | Room factors start with cleanliness and beauty; light and noise come later | Claude |
| 10 | Starting object list as in §5.4 | Claude |
| 11 | Special visitors: critic and inspector first; supplier and friends of staff later | Claude |
| 12 | Character editor starts with name + looks; traits and skills editing follow | Claude |
| 13 | Needs as in §6.4. The first milestone uses Energy, Hunger, Bladder and Comfort; Social and Break come with relationships and the rota | Claude |
| 14 | **Needs carry over between days.** Life off site is simulated abstractly (evening, sleep, commute), so a close-then-open turnaround arrives tired | You |
| 15 | **It can get dark, but lean towards funny.** Quitting, walking out and arguments are in; the writing goes for comedy over misery | You |
| 16 | Keep the starter traits; add your real archetypes whenever you like | Claude |
| 17 | Work types as in §6.8 | Claude |
| 18 | The manager is you, the player, off screen. No manager character yet | Claude |
| 19 | Workplace romance is in, played for comedy, arriving with relationships (M3) | Claude |
| 20 | Wants come later (M6) | Claude |
| 21 | Emergencies start with spills and a broken machine; fire later | Claude |
| 22 | **Counter service first.** Table service may come with venues that need it (restaurant) | You |
| 23 | Tips go to staff and feed their mood | Claude |
| 24 | Stock is abstract "supplies" at first; individual items maybe later | Claude |
| 25 | Simple daily rent is in | Claude |
| 26 | If money runs out: no game over. Wages go unpaid, which hits staff mood hard; they may quit | Claude |
| 27 | Default day: open 07:00, morning rush 07:30–09:30, lunch 12:00–14:00, afternoon lull, close 17:00. Adjust to your real café whenever you like | Claude |
| 28 | Starter events as in §9.2; your real stories welcome any time | Claude |
| 29 | In-world noticeboard: later | Claude |
| 30 | A starter layout is given; changes and new objects cost money | Claude |
| 31 | Two direct orders: "take a break now" and "go home early" | Claude |
| 32 | Portrait layout as in §11.2 | Claude |
| 33 | A slight bob while walking (already in) | Claude |
| 34 | No sound at first | Claude |
| 35 | Working title "Daily Grind" | Claude |

### Progress
- **M0 Skeleton: done.** A phone page with the café grid and pan/pinch zoom. Seeded, deterministic simulation with tests.
- **M1 Pawns on a floor: done.**
  - Staff arrive for their shifts and choose what to do from object offers.
  - Offers have autonomy thresholds: an offer is only considered once its need has fallen low enough.
  - Characters pick among the top few, and the choice narrows as they get desperate.
  - They walk with A* pathfinding, reserve spots, and go home at the end of their shift.
  - Needs carry over the night. Tap anyone to see their needs and mood.
- **M2 Work & guests: done.** Counter service:
  - Guests queue, order at the till, wait, collect from the pickup point, then sit or take away. Patience drains while they queue and wait; at zero they walk out and want a refund.
  - Staff work types are Counter (orders, cake), Barista, Floor (clearing tables) and Dishes. Each person has a 1–4 or off priority per type, set in a tappable table, and takes the nearest task at their highest priority. Urgent needs still win.
  - Skills speed work up and slowly improve with practice. Made-item skill feeds guest satisfaction.
  - Money comes from sales, minus wages per minute and daily rent. Tips go to whoever took the order.
  - Reputation is a rolling average of guest satisfaction (walkouts count as zero) and drives how many guests come.
  - Deployed to GitHub Pages by a GitHub Actions workflow.
- **M3 Mood & people: done.**
  - **Mood ledger:** mood = 45 + named reasons, drifting toward that target. Reasons are situational (needs, long shift, overdue a break, slammed, a messy café, the café being broke, working with a mate, a rival or a partner, early bird or night owl) or fading memories (tips, rude customers, walkouts, lunch, chats, insults, rows, flirting). Repeats stack with diminishing effect. Tap anyone to read the list.
  - **13 traits:** Chatty, Introvert, Perfectionist, Lazy, Hard worker, Hot-headed, Calm under pressure, Flirt, Coffee snob, Clumsy, People person, Early bird, Night owl. They affect speed, quality, tips, social behaviour and break thresholds.
  - **Relationships:** opinion is the sum of social memories plus a fixed per-pair compatibility, so grudges and friendships fade naturally. Nearby staff chat, banter, vent, compliment, insult and flirt. Insults can become rows about the rota or who left the milk out. Repeated mutual flirting makes a couple, and partners notice flirting.
  - **Low-mood breaks** in three bands, each needing 30 minutes below the line and then a random roll:
    - minor: sulk, slow-walk, snappy
    - major: walk out, cry in the walk-in, argue with a customer
    - severe: quit
  - Every break logs its final straw. A quit is replaced by a new hire two days later (a stand-in until hiring arrives in M5).
  - **Inspirations** at high mood: latte art streak, charm offensive.
  - **Event toasts** (tap to select the person) and a Recent list in the Staff panel.
- **M4 Storyteller & recap: done.**
  - **Storyteller:** busy stretches (2 days) alternate with quiet ones (1 day). Events arrive at random intervals averaging 2.5 open hours when busy and 7 when quiet.
    - Pressure: coach party, espresso machine breaks (staff fix it), late cake delivery, someone calls in sick, health inspector, restaurant critic, heatwave.
    - Social: busker.
    - Good: free pastries, blog shout-out, quiet spell.
  - Coach parties scale with reputation. A hidden adaptation counter rises through calm days and drops after walkout-heavy days, breaks and quits; it scales pressure and tilts the mix toward good events after a disaster.
  - **Stories:** notable log entries carry a story kind and an interest score. A kind that has already featured in a recap scores lower each time, so recaps keep finding new stories.
  - **Recap:** when the café shuts and empties, a card pauses the game with a generated headline, served, walkouts, reputation change, takings, wages, net, the three best stories, a guest or critic review and the star of the day. It can be reopened from the Staff panel.
  - **Reviews:** some guests leave one (1–5 stars, generated from what actually happened), and walkouts often do. The critic always does, and their verdict counts ten times over.
- **M5 Your café: done.**
  - **Saving:** autosaves on this device every in-game day, every real minute and when the page is hidden. Save now, Export save (a JSON file), Import save and New café are in the Café panel. A `?seed=` URL always starts fresh. Saves are versioned and validated on load.
  - **Staff panel, Team section:** edit each shift in 30-minute steps (06:00–20:00, at least 2 hours), **Break now** (lunch if peckish, otherwise feet up), **Send home** early (a small mood boost) and **Edit**.
  - **Character editor:** name, skin, hair colour, hair style and up to three traits, with clashing traits refused. Let them go (fire) is also in the editor.
  - **Applicants:** three at a time, one new face a day, each with traits, skills and a backstory. **Hire** them (up to 8 staff). Quitting no longer auto-hires a replacement.
  - **Menu and prices:** ±10p per item (50–200% of the usual price) and an on/off switch per item. Dearer prices bring fewer customers and dent their value-for-money satisfaction; cheaper brings more.
  - **Build mode:**
    - Tap furniture to select it, tap a tile to move it, or sell it for half price. Buy from a palette, with prices from £40 (plant) to £900 (second espresso machine).
    - Rules: furniture only goes on the right floors (guest furniture out front, kit behind the counter, the sofa in the staff room). It can never sit on doors or on queue, pickup or waiting spots, can't be dropped on anyone, and can't block the way to the counter or to any object. The counter is fixed, and you can't sell your last espresso machine, sink or toilet.
    - Staff use any espresso machine, take dirty cups to the nearest sink, and wash at any sink. A sink by the floor is a real upgrade.
- **M6 Regulars & depth: done.**
  - **Regulars (up to 20):** happy strangers sometimes become regulars. Each has a unique name, a usual, comes back every 1–4 days, and keeps a fondness score for each staff member ("asking after Mia"). They hold grudges about being kept waiting or argued with, can make up over an excellent coffee, and leave for good if wronged too often. Visit milestones bring biscuits, and a birthday event has the staff singing.
  - **Wants (Sims-style), two per person:** get better at a job, be put first on a job, a shorter shift, get let off early, £10 in tips in a day, a proper lunch, a compliment, work with a friend. Many need you to act. Meeting one gives +6 mood for a day. Wants are shown on the staff sheet.
  - **Spills and a Cleaning job:** seated guests occasionally knock drinks over and clumsy staff drop them, and people can slip. Cleanliness (cups, spills, washing-up pile) and looks (plants and armchairs out front) shape guest satisfaction and staff mood ("Lovely place to work" or "This place is a tip").
  - **Café panel:** how it feels, top regulars, a scrapbook of every recap (tap to reopen) and a hall of fame (couples, raves, critic walkouts, 25th visits, birthdays, quits, lost regulars).
  - **Saves are version 2**, and version 1 saves are upgraded automatically.
  - **Installable:** web app manifest, Pawn-style icons and a service worker (works offline; pages network-first so updates arrive).
- **M7 Venues: done.**
  - Venues are data (`src/sim/venues.ts`): map, starting furniture, service positions, drink station, menu, opening hours, hourly busyness, default shifts, uniform, job labels and all the story wording.
  - Item kinds are generic (drink and food), and saves are version 3 with automatic upgrade.
  - **The Pub:**
    - open 12:00–23:00, with a lunch bump and the after-work and evening rush
    - five default shifts, black t-shirts, Bar and Till job labels
    - beer taps (the barrel runs dry and someone changes it), crisps and toasties, pints and lemonade
    - burgundy carpet, kegs in the cellar, a pool table and a dartboard (both improve looks)
    - stag dos instead of coach parties, quiz night instead of a busker, the pub guide's reviewer, pub rude customers
  - **New café** now asks what you're opening (café or pub); `?venue=pub` starts a pub directly. The corner button is named after the venue.
- Next candidates: a cinema (concessions plus screenings) or a restaurant (table service, per Q22).

---

## 1. Confirmed decisions

| Decision | Your answer |
|---|---|
| Genre | Hospitality management sim, watched more than played [CONFIRMED] |
| Who builds it | Claude writes the code; you direct and playtest [CONFIRMED] |
| Tech | Web: TypeScript + HTML canvas [CONFIRMED] |
| Target device | Mobile [CONFIRMED] |
| Art style | "Pawn": outlined capsule bodies, floating heads, no faces or arms, role shown by colour plus one prop [CONFIRMED] |
| First venue | Café. Later venues: restaurant, bar/pub, cinema and other hospitality, but **not hotels** [CONFIRMED] |
| Control model | Indirect, like RimWorld: you set priorities, zones and the rota, and staff decide moment to moment [CONFIRMED] |
| Time | Continuous, RimWorld-like, with pause and speed buttons; play as long as you like [CONFIRMED] |
| Ending | Endless sandbox [CONFIRMED] |
| Characters | Procedurally generated **and** player-created/editable **and** recurring regular guests [CONFIRMED] |
| Release | Just for you [CONFIRMED] |

What "just for me" changes:
- no accounts, analytics or monetisation
- no app-store packaging
- no tutorial polish beyond what helps you
- saves stay on your device

---

## 2. Pillars

These are proposals drawn from the design pillars in the clean-room reports, filtered for a café [PROPOSED → Q1]:

1. **Staff are people, not throughput.** Each staff member has needs, a mood made of named reasons, traits, skills and relationships. A slow shift is a story about *why* it was slow.
2. **You set intent; they decide.** The player never moves a character. The gap between what you planned and what happened is the fun.
3. **Every feeling has a readable cause.** Tap anyone to see exactly why they feel the way they do ("Got a big tip +5", "Working with someone they dislike −8").
4. **The café remembers.** Notable events are recorded and retold: in an end-of-day recap, in regulars' memories, and in reviews.
5. **Success creates its own pressure.** A busier, fancier café brings bigger rushes, pickier guests and higher staff expectations.
6. **Fits on a phone.** One screen, portrait orientation, readable at a glance, playable with one thumb.

---

## 3. The core loop

This is a proposed rhythm [PROPOSED → Q2]:

```
Plan (any time, game paused or running)
  build/arrange · set the rota · set work priorities · edit the menu & prices
        ↓
Open hours (time runs)
  guests arrive in waves → staff autonomously serve, cook, clean, take breaks
  the storyteller drops events (rush, delivery late, a regular's birthday, a broken machine)
        ↓
Close (time keeps running at night, or fast-forwards: Q3)
  staff go home or rest · cleaning · day recap built from today's tales
        ↓
Next day: money, reputation and relationships carry forward
```

---

## 4. Technical architecture

### 4.1 Stack [PROPOSED → Q4]
- TypeScript, built with **Vite** (a fast dev server; it bundles the game into one static web page).
- **Plain Canvas 2D**, no game engine. The Pawn style is just circles, rounded rectangles and outlines, so a library adds weight without much benefit.
- No UI framework for the first version. Menus are plain HTML laid over the canvas, which keeps text crisp and accessible on phones.
- Unit tests for the simulation with **Vitest**, so behaviour can be checked without opening the game.
- Runs offline once loaded. Optionally installable to the home screen as a progressive web app (PWA) [PROPOSED → Q5].

### 4.2 Where the code lives [OPEN → Q6]
The current repo (`deco`) holds the two decompilations. The game could go in a new folder there, a new repo, or somewhere else. I need your call.

### 4.3 Simulation and rendering are separate
- The **simulation** is pure TypeScript with no drawing code. It can run headless in tests and step forward deterministically from a seed.
- The **renderer** reads the simulation state each frame and draws it, but never changes it.
- **Input** turns taps into *player orders*, such as "set Alex's Barista priority to 1". The simulation applies them on its next tick.

### 4.4 Data-driven definitions
Inspired by RimWorld's "definition + behaviour" pattern and the Sims' tuning tables.
- Every noun is a **definition** in a JSON or TypeScript data file: objects, menu items, traits, thoughts, needs, work types, incidents and text rules.
- A definition can name a small **behaviour function** for logic, such as "can this incident happen now?".
- Adding content means adding data, not changing systems. This is also how future venues (bar, cinema) get added.

### 4.5 One stat pipeline
Inspired by RimWorld.
- Any number about a person or object (work speed, mood, tip size, cleanliness spread) is computed as: **base value**, then **+ offsets**, then **× factors**, then a **curve**.
- Traits, mood, room quality, tiredness and skill all plug into the same pipeline. That makes interactions emerge without special cases. For example: a tired barista with the "perfectionist" trait in a messy café makes coffee slowly.
- Tuning is done with **curves**: simple point-to-point graphs stored in the data files.

### 4.6 Time and ticks [PROPOSED → Q3]
- A fixed simulation tick, with work spread across ticks so that 30+ characters stay cheap on a phone.
- Proposed scale: **1 in-game hour ≈ 1 real minute at 1× speed**. Speeds are pause, 1×, 3× and 6×.
- Random events are expressed as "on average once every N hours". This gives natural, unpredictable timing.

### 4.7 Saving [PROPOSED → Q7]
- Autosave to the browser's on-device storage (IndexedDB) every in-game day, plus a manual save.
- Export/import a save file, so a cleared browser can't wipe your café.

---

## 5. The world: grid, rooms and objects

### 5.1 Grid
- The café is a tile grid. For phone size, I propose about **16 × 24 tiles in portrait** [PROPOSED → Q8].
- Each tile has a floor type, an optional wall, and up to one object, or a slot for one.

### 5.2 Rooms
Inspired by both games.
- Rooms are detected automatically from walls and doors.
- Each room tracks size, cleanliness, beauty (from floors, decor and plants), light and noise [PROPOSED → Q9].
- Rooms get a **type** from what's in them: seating area, counter, kitchen/back, staff room, toilet, storage.
- **Room quality** feeds staff and guest mood. It's pulled toward the weakest factor, so a gorgeous room that's dirty still feels bad.

### 5.3 Objects advertise
Inspired by the Sims. This is the core AI trick.
- Each object lists the **things it offers** and to whom. For example:
  - Espresso machine: "make coffee" (work, needs the Barista skill).
  - Staff-room sofa: "sit and rest" (+Energy, +Comfort; staff only).
  - Window table: "sit and eat" (guests; +Comfort, +View).
- Each offer **promises** need changes. The promise is scaled by personality and reduced by distance.
- New objects automatically create new behaviour. Characters don't need new code to use them.

### 5.4 Starting object list
The café's first objects [PROPOSED → Q10]:
- **Front of house:** counter + till, espresso machine, cake display, two-top, four-top, sofa/armchair, plant, rug, menu board.
- **Back:** fridge, oven, prep counter, sink/dishwasher, bins, storage shelf.
- **Staff:** staff-room sofa, lockers, staff toilet.
- **Guests:** toilet.

---

## 6. Characters

### 6.1 Who's in the world
| Kind | Description |
|---|---|
| Staff | Hired, work shifts, persist across days [CONFIRMED that they persist] |
| Guests (one-off) | Generated on arrival, leave forever [PROPOSED] |
| Regulars | Guests who return, remember past visits, and have relationships with staff [CONFIRMED that they exist] |
| Special visitors | Critic, inspector, supplier, friend of a staff member [PROPOSED → Q11] |

### 6.2 Character data
For everyone:
- name, appearance (body colour, skin, hair shape and colour, one prop)
- 1–3 traits
- a skill per work type, with an optional passion
- a short backstory line
- needs, a mood ledger, memories and relationships

### 6.3 Making and editing characters [CONFIRMED that you can]
- A character editor for name, appearance, traits, skills, passions and backstory.
- Every generated character can be edited too.
- [OPEN → Q12] How much of the editor do you want in the first version? Is it name + appearance only at first, or everything?

### 6.4 Needs
Inspired by both games; trimmed for a workplace [PROPOSED → Q13].
- **Staff (at work):**
  - Energy (tiredness across a shift)
  - Hunger
  - Bladder
  - Social
  - Comfort (feet and back: standing too long)
  - Break (time since the last break)
- **Guests:**
  - Hunger/thirst (why they came)
  - Patience (falls while waiting)
  - Comfort
  - Ambience (room quality and noise)
- Needs are 0–1 meters. Low values add mood reasons and make the matching behaviour more urgent.
- [OPEN → Q14] Do staff have a life outside work, such as needs that carry over overnight? Or does each shift start fresh?

### 6.5 Mood as a ledger
Inspired by RimWorld's thoughts and the Sims' weighted needs.
- Mood = baseline + the sum of active **reasons**.
- Reasons come in two kinds:
  - **Situational**: re-checked constantly. "Feet hurt", "Kitchen is filthy", "Working with my best friend".
  - **Memories**: they happen, then fade. "Got a huge tip", "Was shouted at by a customer", "Coworker covered my shift".
- Repeats of the same reason stack with diminishing effect.
- Tapping a character shows the full list of reasons with their values. This is pillar 3.
- **Expectations:** a fancier, more successful café slowly raises how much it takes to please staff. This is pillar 5.

### 6.6 When mood gets low
Inspired by RimWorld's mental breaks, tuned for a workplace [OPEN → Q15: how dark can it get?]. Proposed bands from mild to severe:
- **Minor:** sulks in the staff room, slow-walks orders, snaps at a coworker.
- **Major:** walks out mid-shift, cries in the walk-in, argues with a guest.
- **Severe:** quits on the spot.

Rules:
- A break only happens after the mood has stayed low for a while. It always names the **"final straw"** reason.
- **High mood** can trigger **inspirations**, such as a perfect latte-art streak or a charm offensive that earns double tips.

### 6.7 Traits
Starter set [PROPOSED → Q16; I'd love your real-workplace archetypes]: Chatty, Perfectionist, Lazy, Hard worker, Night owl, Early bird, Hot-headed, Calm under pressure, Flirt, Coffee snob, Clumsy, People person, Introvert.

Each trait works through the stat pipeline and through mood reasons. For example, *Introvert* gets "Too many people" during a rush.

### 6.8 Skills and work types
Proposed café work types [PROPOSED → Q17]:
- **Barista:** coffee and drinks.
- **Counter:** taking orders, the till.
- **Floor:** running food, clearing tables.
- **Kitchen:** prep and baking.
- **Dishes**
- **Cleaning**
- **Stock:** receiving deliveries.
- **Manager:** sorting out complaints. Only if a manager character exists; see Q18.

Skill rules:
- Skills rise with practice and set speed and quality.
- A passion speeds learning and gives a small mood boost while doing that work.
- Backstories can rule out some work, for example "Won't do dishes".

### 6.9 Relationships
Inspired by both games.
- Opinion of someone is **the sum of remembered interactions** with them, so it fades naturally over time.
- Pairs have a fixed **compatibility**, so some people just click.
- Named levels come from banding the opinion score: rival, dislike, neutral, friend, close friend.
- Romance states also need enough romantic memories [OPEN → Q19: is workplace romance in?].
- Interactions while working or on break: chat, banter, vent, insult, compliment, flirt.
- **Feedback loop:** low opinion leads to more insults, which lowers opinion further. Keep that loop, but give it ways out, such as a shared bad shift creating bonding.

### 6.10 Wants (optional system)
Inspired by the Sims' want trees.
- Each staff member shows one or two **wants**: learn latte art, get the weekend off, work with their friend, get promoted.
- Meeting a want gives a lasting mood boost. Chained wants tell a small arc.
- [OPEN → Q20] In the first version, or later?

---

## 7. AI: how characters decide

### 7.1 Staff decision order
Two layers, inspired by RimWorld's behaviour trees. Checked top to bottom:

1. **Emergencies, checked every moment:** a fire, a spill someone could slip on, a guest who has fallen ill [PROPOSED list → Q21].
2. **Mood-break behaviour,** if one is in progress.
3. **Urgent needs:** desperate for the toilet, about to collapse.
4. **Needs vs. work:** a contest between them. The rota decides how much work weighs:
   - on shift and not on break: work weighs a lot
   - on a scheduled break: needs win
5. **Idle:** tidy something, lean on the counter, chat.

### 7.2 Work selection
Inspired by RimWorld.
- Each staff member has a **priority per work type**: 1 to 4, or off. You set it in a priorities table.
- They try their highest-priority work first. Within a priority level, they take the **nearest** available task.
- Tasks are **reserved**, so two people don't grab the same cup.

### 7.3 Choosing what to do with needs
Inspired by the Sims.
- The character scores the offers of nearby objects by how much they'd improve their mood, then picks **randomly among the top few**.
- The more desperate they are, the narrower that pick gets: comfortable characters are quirky, stressed ones are rational.

### 7.4 Jobs are made of steps
- A job such as "make a flat white for table 3" is a list of small steps: walk to the machine, reserve it, work for N seconds, pick up the cup, walk to the pass, put it down.
- If a step fails because the machine broke or the order was cancelled, the job ends cleanly and the character chooses again.

### 7.5 Guests follow a visit script
Inspired by RimWorld's group "lord" state machines.
- A guest group moves through states:
  1. arrive
  2. queue or wait to be seated (needs Q22 answered)
  3. order
  4. wait
  5. eat/drink
  6. maybe order more
  7. pay and tip
  8. leave
- **Triggers** change the state. For example, if patience runs out while waiting, they "leave angry".
- The same state-machine framework later covers deliveries, an inspector visit, a birthday party or a cinema screening.

---

## 8. Economy

These are mostly open; I need your industry knowledge here.
- **Money in:** sales and tips [PROPOSED]. [OPEN → Q23] Do tips go to staff, so they're mood/want fuel, or to the café?
- **Money out:**
  - wages [PROPOSED]
  - ingredients/stock [OPEN → Q24: track individual stock like milk, beans and cake, or keep it abstract?]
  - rent/bills [OPEN → Q25]
  - repairs [PROPOSED]
- **Menu and prices:** you set them. Guests compare price with quality, and that comparison affects satisfaction.
- **Reputation:**
  - a café-wide score from guest satisfaction, plus written reviews
  - it drives how many guests come and what kind
- **Endless sandbox and debt** [OPEN → Q26]: since there's no game over, what happens if money runs out? Options: a soft floor with a loan, staff stop being paid and leave, or nothing at all.

---

## 9. The storyteller

Inspired by RimWorld's storyteller, adapted for a café.

### 9.1 What it does
- It picks events on a schedule, not purely at random.
- **Rhythm:** busy and quiet stretches, plus a daily rush curve (morning coffee, lunch, afternoon lull) [PROPOSED → Q27: what's the real daily rhythm at a café you know?].
- **Event budget scales with success:** more reputation and a bigger café mean bigger rushes and pickier guests. This is pillar 5.
- **Eases off after a disaster:** after a walkout or a terrible day, a hidden counter makes the next stretch gentler. After a long calm spell it gets stronger.

### 9.2 Starter events [PROPOSED → Q28; your real-life stories welcome]
- **Pressure:**
  - a coach party rush
  - a broken espresso machine
  - a supplier who is late or brings the wrong order
  - a staff member calls in sick
  - a power cut
  - a health inspector visit
  - a critic
  - a spilled drink chain reaction
  - a heatwave that brings iced-drink demand
- **Social:**
  - a regular's birthday
  - an ex comes in
  - a staff member's friend visits
  - two regulars have a spat
  - a first-date couple
- **Good:**
  - a local celebrity visit
  - a glowing review
  - a quiet sunny afternoon
  - a job applicant walks in

### 9.3 How events surface
- **Cards:** short notifications, colour-coded good, bad or neutral, with a "show me" button.
- **Alerts:** ongoing problems such as "Queue too long", "Bins full" or "Nobody on dishes".

---

## 10. Stories: tales and the day recap

Inspired by RimWorld's tale and text-grammar system.
- Notable events are recorded as **tales**. Each one snapshots who was there, what happened, when and where. Examples:
  - first latte art
  - a walkout
  - a regular's 50th visit
  - a fight over the rota
  - a perfect rush
- Each tale has an **interest** score that drops each time it's retold, so the recap keeps finding fresh stories.
- **End-of-day recap:** a short, generated summary of the day's top tales, plus takings and reputation change.
- **Reviews:** guests and the critic write short reviews from what actually happened to them.
- **Regulars' memories:** a regular remembers being snapped at and mentions it next visit.
- Text comes from a small rule grammar: templates with swappable phrases filled with real names.
- [OPEN → Q29] Should it also be in-world, like a staff noticeboard or photo wall that shows tales?

---

## 11. Player controls and mobile UI

### 11.1 What you can do
All indirect [CONFIRMED style]:
- **Build/arrange:** place walls, floors and objects. [OPEN → Q30] Is building free in the first version, or does it cost money?
- **Rota:** who works when, plus break times.
- **Work priorities:** a table of staff × work types.
- **Zones:** staff-only, guest seating, storage.
- **Menu & prices.**
- **Hire/fire:** from generated applicants, or your own creations.
- **Time:** pause, 1×, 3× and 6×.
- [OPEN → Q31] Any direct "manager calls" at all? For example: "go home early" or "take a break now". RimWorld has a few such forced orders.

### 11.2 Screen layout
Portrait [PROPOSED → Q32]:
- **Top:** a slim bar with time, money, reputation and speed buttons.
- **Middle:** the café, which you can pan and pinch to zoom.
- **Bottom:** a tab bar with Build · Staff · Rota · Menu · Log.
- **Tap a character:** a bottom sheet opens with mood reasons, needs, current job, skills and relationships.

### 11.3 Art in code
- Pawn sprites are drawn from shapes in code, not image files. A pawn is a body capsule, head, hair shape, hat or prop, and outline.
- Appearance is data, so the editor and the generator just pick values.
- Mood bubbles use small icons drawn in code.
- [OPEN → Q33] Do characters have any walking animation, such as a slight bob? Or do they glide like RimWorld?

### 11.4 Sound
[OPEN → Q34] None at first, simple sound effects, or background ambience?

---

## 12. Questions for you

Please answer as many as you like. "Your call" is a fine answer, and I'll then use the proposed default.

**Vision & loop**
1. Are the six pillars in §2 right? Should any be cut or added?
2. Is the plan → open → close daily loop right?
3. Time scale: is 1 in-game hour ≈ 1 real minute OK? At night, should time run with nobody there, or fast-forward to the next morning?

**Tech**
4. OK with Vite + plain Canvas 2D + Vitest?
5. Should it be installable on your phone's home screen (PWA)?
6. **Where should the code live?** A new folder in `deco`, a new repo, or elsewhere?
7. Is local autosave plus export/import enough?

**World**
8. Is about 16×24 tiles in portrait the right café size? Or do you want small, medium and large lots?
9. Room factors: cleanliness, beauty, light, noise. Add or cut any?
10. Is the starting object list right? What's missing from a real café?

**Characters**
11. Which special visitors are in: critic, inspector, supplier, friends of staff, others?
12. Character editor in the first version: name + looks only, or everything?
13. Are the staff and guest needs right?
14. Do staff have life outside work, with needs and mood carrying over between days? Or does each shift start fresh?
15. How dark can low-mood breaks get? Is quitting OK? Shouting at guests?
16. Traits: which of the starter set to keep, and what real archetypes should we add?
17. Are the work types right for a café?
18. Is the manager a character in the café? Is that character you?
19. Is workplace romance in or out?
20. Wants: in the first version, or later?

**AI & economy**
21. Which emergencies exist: fire, spills, ill guests, others?
22. **Counter service, table service, or both?** (This changes the guest visit script.)
23. Do tips go to staff or the café?
24. Detailed stock (milk, beans, cake) or abstract "supplies"?
25. Rent and bills: in or out?
26. What happens if money runs out?

**Storyteller & stories**
27. What's the real daily rhythm of a café you know (opening, rushes, lulls, close)?
28. Which events do you want? Please add real stories from work.
29. Should tales also appear in-world (noticeboard, photo wall)?

**Controls & presentation**
30. Is building free or paid in the first version?
31. Any direct manager orders, or purely indirect?
32. Is the portrait layout right?
33. Should characters bob when they walk, or glide?
34. Sound: none, effects, or ambience?
35. What's the working title?

---

## 13. Build plan

Milestones are proposed, and each one is playable on your phone. Each starts only once the questions it depends on are answered.

| # | Milestone | You can… | Done when | Needs answers |
|---|---|---|---|---|
| M0 | Skeleton | Open a page on your phone showing an empty café grid that you can pan and zoom | It loads on your phone, tests run, and a seeded simulation steps forward identically every time | 4, 6 |
| M1 | Pawns on a floor | See Pawn-style staff walk around a fixed layout and use objects to satisfy needs | Characters choose actions from object offers and never get stuck | 8, 10, 13, 33 |
| M2 | Work & guests | Watch guests arrive, order, get served, pay and leave; set work priorities | A full day runs without a stall, and money changes correctly | 17, 22, 23, 24 |
| M3 | Mood & people | Tap anyone to see their mood reasons; traits and relationships matter; low-mood behaviour | Every mood change has a named reason, and breaks cite the final straw | 14, 15, 16, 19 |
| M4 | Storyteller & recap | Events arrive with a rhythm, and an end-of-day recap tells the day's best stories | Recaps don't repeat the same story type day after day | 27, 28 |
| M5 | Your café | Build/arrange, rota, menu & prices, character editor, save/load | You can recreate a version of your workplace and coworkers | 12, 25, 26, 30, 31 |
| M6 | Regulars & depth | Regulars return and remember; wants; reviews | A regular refers to something that happened on an earlier visit | 11, 20, 29 |

**Later:** new venue types (restaurant, bar/pub, cinema), each as a set of data definitions on the same systems.

---

## 14. What each system borrows

All of this is clean-room inspiration only: ideas are reimplemented, and no code or text is copied.

| Our system | Idea from RimWorld report | Idea from Sims 2 report |
|---|---|---|
| Data definitions + behaviour functions | Definitions with plug-in workers | Loadable tuning tables |
| Stat pipeline + curves | Base, offsets, factors, curves | Piecewise-linear tuning curves |
| Mood ledger | Situational + memory thoughts, stacking, expectations | Low needs weigh more heavily |
| Low-mood breaks / inspirations | Break bands, sustained time below, final straw | (none) |
| Object offers | (none) | Object advertisements, personality-scaled, distance-attenuated |
| Pick among top few | (none) | Random among top N, narrowing when desperate |
| Work priorities + nearest task | Work types, priorities, nearest-target scanners, reservations | (none) |
| Jobs as steps | Jobs broken into toils with fail conditions | Bounded action queue |
| Guest visit state machine | Group controller state graph with triggers | (none) |
| Relationships from memories | Opinion = sum of social memories, compatibility | Banded levels, romance gated by memory count |
| Wants | (none) | Want trees, weighted lottery, chained wants |
| Storyteller | Rhythm cycles, budget from wealth, adaptation easing | (none) |
| Tales + recap | Tale snapshots, interest decay, text grammar | (none) |
| Room quality | Room stats pulled toward the weakest factor | Room score from size, light, floors, decor |
