# Minute to minute

A spec for making Landlord worth playing between the big moments. Design only: no code
has changed. Numbers here are starting points for `tuning.ts`, not promises.

## The problem

Playtesting found the same thing every time. Denise finishes her walk round, and then
nothing happens. The player watches an empty building.

Why:

- **Nobody's in.** Two sitting tenants. Flat 1 works nine to half five. Bill's home, but
  Bill pottering is not a show. Three quarters of applicants have office hours
  (`LETTING.working` 0.75), so the building empties every weekday morning however full it is.
- **The storyteller sleeps on purpose.** Nothing from it until day 8 or Denise's list is done
  (`FIRST_DAY`, `quietFor`).
- **Decisions come hours apart.** Applicants every ~14 game hours a flat, chat requests about
  one a tenant a day (`REQUESTS.perHour` 1/24, and not in their first two days), letters
  daily at most. At 1x a game hour is 54 real seconds (`SECONDS_PER_GAME_MINUTE` 0.9), so
  that's a decision every several real minutes at best.
- **Little to spend early,** and nothing small to spend it on.
- **No small orders.** Control is indirect (you build, you set rents, you answer), which is
  right, but with no steady supply of little things to answer, there's nothing to do.
- **What does happen is invisible.** The cleaner doesn't exist as a person. Pets don't exist
  as animals. Post appears on the mat by magic.

## The target

Two jobs, kept apart:

> **Life worth watching** (section 2) keeps something on screen all the time: people about,
> doing readable things, with something new starting every 20 real seconds or so.
>
> **The drip** (section 1) asks for a real decision now and then: nought to two a game day,
> each with consequences you'll see again. It never fills a gap for the sake of it.

With the faster clock (section 0), at 1x a game day takes about 7 real minutes and its
waking hours (07:00 to 23:00) about 4.8. At 1x a game minute is 0.3 real seconds; at 3x,
0.1.

| Measure | Target |
| --- | --- |
| Drip cards a game day | 0 to 2; a mean of 1 to 1.6 over a week. 0 is fine on a day with a happening, a council visit, or letters and applicants waiting |
| Drip cards, real time | about one every 4 to 7 real minutes at 1x on an ordinary day; 1.5 to 2.5 at 3x |
| Decisions of any kind (drip cards, letters with choices, new applicants) | 2 to 5 a game day once there are flats to let |
| Open drip cards at once | never more than 2 |
| Every card's choices | pass the consequence rule (1.0) |
| People visible and awake (on the map, not away, not asleep), waking hours | at least 2 in 95% of sampled minutes |
| Something new starting on screen (a bubble, an arrival, a moment) | 90th percentile gap at most 20 real seconds at 1x (67 game minutes) |
| First week, days 1 to 7 | 2 to 3 scripted cards a day, plus applicants and letters; something to watch from minute one |

The feel: an ant farm with opinions. You can put the phone down and watch. Every few
minutes someone wants a word, and it's a word that matters.

**What 3x feels like:** a day in under two and a half minutes, a card every couple of
minutes, the building bustling; a good way to get through a quiet week. **What 1x feels
like:** calm. Seven minutes a day, plenty to watch, a decision now and then with time to
think about it.

Rules this spec keeps to:

- **No time tricks.** The player sets the pace with the speed buttons. Nothing skips or
  speeds up time by itself: the automatic quiet-night speed-up goes, and a **Skip to
  morning** button replaces it (0.2).
- **Stories over spreadsheets.** Cards come from the building as it is, and some of them grow
  into stories.
- **Few people who matter.** Recurring named visitors, not crowds.
- **Show a little, let them read a lot.** A face, a line and two buttons. Icons over words.
- **Landlord, not puppeteer.** You answer. You don't steer people round.
- **Nice or ruthless, never trivial.** Every card is a trade between two different things
  (1.0). Kind against cheap is one such trade, not the only one, and neither side is always
  right.

---

## 0. The clock

### 0.1 A faster clock, the same movement

Decided: **things move on screen exactly as fast as now, but the clock runs three times
faster.** At 1x a game day goes from 21.6 real minutes to about 7.2.

How: **`TICKS_PER_MINUTE` 60 → 20**, with ticks per real second unchanged (66.7 at 1x:
`SECONDS_PER_GAME_MINUTE` 0.9 → 0.3). A walk takes the same ticks and the same real time,
so it takes three times the game minutes it did (corrected in chunk 0: this said "a third";
from the top floor to the end of the street is now about 25 game minutes). Everything measured in game time (needs per
hour, durations in game minutes, schedules, cooldowns in days, rent every morning) stays in
game units and so happens three times sooner in real time.

Knock-on effects to check (chunk 0 does the change and its fixes; chunk 8 retunes):

- **Walks against schedules.** Getting to work, the shops or the pub now costs three times
  the game minutes (corrected in chunk 0: this said a third), so tenants set off at the old
  time and arrive later, with less spare game time. Check nobody misses a habit's slot or
  turns up at work at 08:25 for 08:00.
- **Needs per hour.** A trip to the loo or the fridge now costs more game minutes for the
  same need restored: check needs stay in their bands (the neighbours and landlord soaks).
- **Things you watch, timed in game minutes.** Bubbles, talks, poses and moments set as
  `n * TICKS_PER_MINUTE` would last a third of the real time (a 3-minute bubble: under a
  second). **Anything on screen is timed in ticks (real time), not game minutes:** add
  `TICKS_PER_SECOND` style helpers, and convert every bubble and talk length (events,
  social, crime, tenants). The renderer's 1.5-second hold (2.5) is a backstop.
- **Per-tick chances.** Anything rolled per tick (not per game minute or hour) now fires
  three times as often per game hour: audit and rescale.
- **Saves.** Ticks in old saves are worth three times as much. Save v10 divides every
  stored tick (state tick, `until`s, cooldown ticks, memory times) by 3 on load, so a v9
  save carries on at the same game time.
- **Tests.** Soaks run in game days, so they get cheaper. Tests that assert tick numbers or
  "after n ticks" need updating; seeded ledgers change once and are re-baselined in chunk 0.
- **The 10-real-second card minimum** (1.1) is 33 game minutes at 1x, 11 at 3x, about 4 at
  8x: it binds only at 8x and for follow-ups that arrive nearly due.
- **Game-time pacing numbers in this spec** (card lifetimes, moment gaps, visitor times) are
  written for the new clock.

### 0.2 Skip to morning

Decided: **the automatic quiet-night speed-up goes** (`NIGHT_BOOST` and its use in
`planTicks`). In its place, when `quietNight` is true (every tenant asleep or out, nothing
running, no card open, no visitor on the map, the cat asleep), a **Skip to morning** button
appears above the speed buttons. Tap it and the sim runs every tick to 07:00 as fast as the
phone can (the same ticks, so a seed plays the same as letting it run), then drops back to
the speed you were on. Anything that stops being quiet on the way (a burglar, a lockout
card) stops the skip there and shows you. Nothing else ever changes the speed.

---

## 1. The drip

A thin stream of real, two-choice decisions: nought to two a game day, each worth having.

### 1.0 The consequence rule

> The owner's rule: the decisions the player makes from the drip have unique and
> interesting consequences, and are never just frivolous.

A card is two lines and two buttons, so it's easy to write one that doesn't matter. This is
how we don't. Every card's two choices must:

1. **Differ in kind, not size.** Not "£20 or £40". Each button gives up something different
   that the player cares about: money against a tenant's goodwill; now against later; one
   tenant against another; safety against liberty; the building against a person; what you
   know against what you're trusted with.
2. **Leave something that lasts and can be seen later.** Each choice has at least one
   lasting effect (below). If the player can't find it again in a day or two (in someone's
   thoughts, on the map, in the post, in the risk words, in the Sunday recap), it doesn't
   count.
3. **Never be cosmetic only.** A colour, a line in the chat, a joke on its own: not a
   choice. Flavour belongs in moments (2.3), which cost nothing to watch.
4. **Belong to who and what is involved.** The same card plays differently with a
   complainer than with an easy-going tenant, in a Smart flat than in a Grim one, with locks
   than without. Every card names what it turns on, and changing that changes at least one
   outcome.

**Lasting effects** (1.5): a memory or opinion with a named person (`mem`, `soc`); a change
to the building (`mend`, `wear`, `flag`, `rent`); something that comes back (`thread`,
`promise`); a tale for the recap (`tale`); a shift in risk (`risk` for burglary, fights,
break-ups and parties; `inspect` for the council; `expect` for expectations); a trait
revealed (`reveal`). Not lasting on their own: `pay`, `chat`, a notice. Money is part of a
trade, never the whole of one side.

The ignored outcome is held to the same rule, and more (1.6): it's always the worst of the
three. The person remembers being ignored, and the world decides badly.

**The checklist.** A card goes in the catalogue only if it passes all of these:

- [ ] Each button, said aloud, sounds like a different kind of answer, not a bigger or
  smaller one.
- [ ] Each button has at least one lasting effect, and they aren't the same effect.
- [ ] Neither button is just money, just a chat line, or just a joke.
- [ ] Ignoring it is worse than either button, in kind: someone remembers being ignored or
  left to it, and the world decides badly. The notice says what the world did.
- [ ] It names what it turns on (a trait, a tier, a fitting, who's home, who likes whom),
  and changing that changes at least one outcome.
- [ ] Neither button is always right. A decent player and a ruthless one could each pick
  either.
- [ ] Something from it can come back: a person remembers, a thread fires, the risk word
  moves, the recap tells it.
- [ ] It fits: a hook of 40 characters, text of 80, labels of one to four words.
- [ ] It's worth one of the day's two places. If it wouldn't be missed, it's cut.

There's no filler pool to hide weak cards in: with nought to two a day, every card has to
earn its place.

**How we test it** (`test/cards.rule.test.ts`; helpers in chunk 0, run on each card file
in chunks 2a to 2c and 7):

- Each card def lists `turnsOn` and ships at least two **fixtures**: small seeded buildings
  where its `when` is true, differing in what it turns on (a complainer and an easy-going
  tenant; a Grim flat and a Nice one; locks and none).
- On each fixture, with a fixed seed, resolve A, B and ignored to effect lists. An effect's
  **signature** is its kind and subject without amounts (`mem:tookParcel@dave`,
  `risk:burglary`, `flag:bigBins`, `pay`).
- **Kind:** A's and B's signature sets differ, and the difference holds something other than
  `pay` and `chat`. (So "£20 vs £40" fails: both are `{pay}`.)
- **Lasting:** A, B and ignored each hold at least one lasting signature.
- **Not cosmetic:** no outcome is made only of `pay`, `chat` and notices.
- **Tied:** across the card's fixtures, at least one outcome's signatures differ.
- **Seen later:** every memory a card uses exists in `MEMORIES` or `SOCIAL` with a label;
  every `thread` names a real card; every `flag` has at least one reader (a registry, so no
  flag is write-only); every `tale` kind has text.
- **Ignored is worst:** on every fixture, ignored scores below both choices (1.6), and holds
  a bad lasting signature neither choice has (`ignored`, `leftToIt`, an outsider's grudge).
- **Leaves a mark, in play** (the pacing soak, chunk 8): of cards answered by a random
  policy over 21 days, at least 60% still show something three game days later (a live
  memory, a flag, a pending thread or promise, a tale in that week's recap).

### 1.1 Where and how decisions show

Designed for a 390 × 844 phone held upright (the common size); it scales to others. Two
parts: a slim **tray** of at most two cards just above the tenant bar, and a red **`!`**
over the person or place in the building. Tapping either opens the card.

**The screen, with one card in the tray:**

```
 390 px
┌──────────────────────────────┐
│ notch / safe area       ~47  │
├──────────────────────────────┤
│                    ┌───────┐ │
│   the building     │alerts │ │   about 500 px of building
│   (canvas)         │150 px │ │   with one card, 450 with two
│        [!]         └───────┘ │
│        Dave                  │
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │[☺] Parcel for Dave.    ◔ │ │   tray: one slim card, 44 px
│ └──────────────────────────┘ │
│ [☺][☺][☺]  tenant bar   58   │
│ Build Chat Post ...  tabs 58 │
│ Day 3 Wed 10:04 £1,240 ⏸1×3×8× │  status bar ~44
│ home indicator          ~34  │
└──────────────────────────────┘
```

**The tray.**

- In the bottom dock (`.dock`), directly above the tenant bar. 358 px wide (16 px gutters).
  Empty, it takes no space.
- **A slim card** is one row, 44 px tall: a 32 × 32 face (or an icon: the cat, the van, the
  bins); the card's **hook**, one line of at most 40 characters in 13 px ("Parcel for
  Dave.", "Man in a van: £40 cash"); and the countdown ring (20 px) at the right.
- **At most two**, stacked 4 px apart, **newest on top**. Two cards cost the building 92 px.
  Nothing queues behind them except a promised follow-up, which waits for a gap.
- **Tap a slim card** and it **opens** upwards over the building, to about 150 px: the name
  line in 13 px bold ("Dave · Flat 1"), the full text (at most two lines, 80 characters),
  and two buttons, 171 × 44 px each, 8 px apart. A button has a label of one to four words
  in 14 px bold and a hint note under it in 11 px, in the style of the chat `note` ("He'll
  be glad", "£80", "Might walk"). Notes hint; they never show liking numbers. Opening a card
  pans the camera to its subject (400 ms, zooming to the flat if you're zoomed right out).
  Only one card is open at a time.
- **Tap a button** to answer. The card goes; the existing top toast says what you did ("You
  took Dave's parcel in."), and where others would see it, a line goes in the chat
  ("Landlord took Dave's parcel in."). **Hold** a button to read its note in full if it was
  cut short. **Tap the building** or the open card's face to fold it back to slim.
- **The countdown ring** drains in game time. It shows how full it is, never seconds; screen
  readers get "about a minute left". For cards that wait (1.6) it drains in three steps,
  one for each time the tenant gets more fed up, and the step marks show on the ring.

**The subject in the world.**

- A red `!` bubble over the person, or over the place (the leaking ceiling, the van, the
  bins, the cat). It's top of the bubble budget (2.5), so nothing crowds it out. **Tap it**
  to open its card, the same as tapping the card.
- When a card arrives, the subject gets one pale pulse round its outline (half a second) so
  the eye finds it.
- If the subject is off screen, a small `!` chip sits on the screen edge on the side it's
  on, clear of the alerts column. Tap it to pan there and open the card.
- **The camera never moves by itself.** It moves when you open a card, because you asked.

**In Build, or with a panel open** (chat, post, an info sheet, the money breakdown, Denise
talking). The tray is hidden and **the countdown keeps going**. A red dot shows a card is
waiting: on the **Done** button in Build, on the **Close** button of a panel. Close the panel
or leave Build and the tray is back as it was. An info sheet opened on a card's subject
shows the card pinned at its top, so you can read about Dave and answer about Dave in one
place.

**At least 10 real seconds.** Whatever the speed, a card stays for at least 10 real seconds
from when it appears, wherever you are. The lifetimes below are well over that at 1x and 3x;
the floor matters at 8x, and for a follow-up that turns up nearly due. For the sim it works
like an input: the UI reports the tick at which 10 real seconds have passed, the card
resolves at the later of its own end and that tick, and saves and replays record it like a
button press. Headless tests run as if at 1x.

**Nothing pauses.** A card is small enough not to need to. A new card slides up in 150 ms
and is announced politely to screen readers (`aria-live`).

How long a card lasts, in game minutes, and in real time with the faster clock (0):

| Kind | Lifetime | At 1x | At 3x |
| --- | --- | --- | --- |
| A moment at the door (a courier, a van, an applicant on the step) | 120 | 36 s | 12 s |
| Other moments (a leak, the bins, the cat, shouting next door) | 240 | 72 s | 24 s |
| A tenant asking (it waits, 1.6) | 1,440 (three steps of 480) | 7 min | 2.4 min |
| A follow-up you promised something on | until the promised day | | |

Plus the 10-second floor.

### 1.2 Cadence

**Nought to two cards a game day, each one worth it.** Every morning at 07:00 the drip sets
the day's **budget**: 2, less 1 for each of these that's true, never below 0:

- a happening is running or due today (a party, a burglary's aftermath, a council visit, a
  fight);
- two or more letters with choices are waiting;
- two or more applicants are waiting;
- someone's moving in or out today;
- you've had three cards in a row resolve by being ignored (until you answer one).

A day with none is fine. A busy day is busy enough.

Then through the day:

1. **Spending it.** Every 30 game minutes in waking hours (07:00 to 23:00), if the day's
   budget isn't spent, the drip tries for a card: it gathers every card whose `when` is
   true, weighs them, and draws one with `rng.ts`. The chance of trying grows through the
   day so both cards aren't spent by ten in the morning: `DRIP.tryChance` 0.08 a try,
   doubled after 15:00 if nothing's come yet.
2. **Never filler.** If no card's conditions are met, nothing comes. There's no drought
   guard and no pool of fallbacks; an unspent budget is simply gone at 23:00. Something
   worth watching is section 2's job, not the drip's.
3. **Spaced out.** At least `DRIP.minGap` 240 game minutes between two cards on the same
   day (72 real seconds at 1x).
4. **Nights.** Cards marked *night* (a lockout, shouting next door, a pizza for an empty
   flat) can come between 23:00 and 07:00, at `DRIP.nightChance` 0.04 an hour, and spend
   the next day's budget.
5. **Never stacking.** At most 2 open (`DRIP.maxOpen`). A tenant's ask that's waiting takes
   a slot, so two waiting asks hold the drip until you answer one.
6. **No repeats.** Each card has its own cooldown in days. Nobody is the subject of a card
   more than once in 2 game days (`DRIP.perPerson`). The same card is never open twice.
7. **Follow-ups you set up come anyway.** Threads and promises (1.5) arrive when due, on
   top of the budget, but still respect `maxOpen` and the gap. At most one a day over the
   budget.
8. **First week:** the handover's script sets the cards (section 3), up to 3 a day.

At 1x that's a card every 4 to 7 real minutes on an ordinary day; at 3x, every 1.5 to 2.5.

### 1.3 Where cards come from

Every card has a `when` that reads the real state, and a weight that grows with how true it
is (a leak's weight goes with the shower's wear). With so few cards a day, the weight also
prefers cards that touch something live: a thread's people, a tenant near a line, a risk
already up, a flat near the council's list.

| Source | What it reads | Share of cards (target) |
| --- | --- | --- |
| **Tenants** | traits, needs, liking, who likes whom, partners, jobs, who's in or out | about 45% |
| **The building** | wear and broken things, dirt, bins (`binsOverflowing`), temperature, noise averages, empty flats, listings | about 30% |
| **The street** | visitors at the door, vans, the cat, next door, kids | at most 25% |

A street card still needs a reason to be here: someone out for the parcel, something worn
for the man in the van, the bins for the fox. There is no filler.

### 1.4 The catalogue

T tenant, B building, S street. *Night* cards can come at night. *Waits* marks a tenant's
ask, which waits and gets worse (1.6); every other card is a moment, which passes. Costs are
against a start of £1,500 and £250 a week to the bank. "Turns on" is what changes how the
card plays (1.0, point 4); the card's fixtures vary it. Ignored is always the worst of the
three (1.6): `ignored` (-5) is the existing memory for a tenant who asked; `leftToIt` (-4)
is new, for a tenant it happened to who didn't ask.

| # | Card | When | A | B | Ignored (worst) | Turns on |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Applicant at the door** (S) "Priya's on the step about Flat 2. She's brought a cake." | A listed empty flat, an applicant waiting for it | *Show her round*: one of her traits shows. She sees the flat as it is: worse than its listing and she offers less or goes; if she takes it she never gets `notAsAdvertised` | *Ask Bill to show her*: a sitting tenant at home does it. They meet: each forms a first opinion of the other (from chemistry) that carries over if she moves in. Bill `askedToHelp`; a complainer Bill mentions the boiler and her offer drops £5 | She waits, then goes, off the list; that flat's next applicant takes a day longer (`flag:slowLet`, "nobody answered" gets round) | The flat against its listing; who's home and their traits |
| 2 | **Parcel for someone out** (S) "Parcel for Dave. He's at work." | A courier, and a tenant away | *Take it in*: Dave `tookParcel`. 1 in 5 the box gives something away: one of his hidden traits shows (a cat flap: pet owner). Seeds #22 if a busybody's in | *Leave it in the lobby*: it walks 1 in 4 (1 in 10 with locks, never with an intercom): Dave `parcelNicked`, a tale, and burglary risk up a step for 3 nights (someone's found the door easy) | Left on the step outside: it walks 1 in 2; Dave `leftToIt`; if it walks, as B | Locks, intercom; Dave's hidden traits; a busybody |
| 3 | **Man in a van** (S) "Bloke in a van says he'll do Flat 1's cooker for £40 cash. Today." | Something in a let flat worn past 0.7 or broken; money over £200 | *Go on*: £40, working today, but a bodge: its grade drops a step and 30% it breaks in 3 days (thread: "He's not answering his phone"). A gas job and a tenant who knows their rights: they report it, an inspection is booked | *Get someone proper*: a promise: mended properly within 2 days at the going rate (£70 to £90). The tenant goes without till then: a complainer `waitedForRepair`, an easy-going one nothing | He leafs the stairs. A haggler, messy or handy tenant hires him: the bodge happens on your furniture, unasked, with the inspection risk, and they're `leftToIt` ("had to sort it myself"). If nobody does, the thing wears on and its tenant `leftToIt` | The tenant's traits; the thing's grade (bodging a posh cooker costs more) |
| 4 | **Cat on the stairs** (S) "A ginger cat has walked in and sat on the stairs like it pays rent." | Daytime, street door used lately, no building cat | *Let it stay*: the building cat (2.2); pet owners and friendly tenants `buildingCat`; house-proud `catHair`. A precedent: refusing a pet from now on gives `noPetButCat`, twice `noPet` | *Shoo it out*: pet owners `shooedCat`. It moves in next door instead (`flag:nextDoorCat`: you see it on their wall), and "no pets" stays easy to hold | It comes back every day and it's yours by the third, with nobody's say and no vet: the precedent, house-proud `catHair` and `leftToIt`, no thanks from anyone, and fleas 1 in 3 (its favourite `itchy`) | Pet owners, house-proud tenants, anyone already refused a pet |
| 5 | **Drip through the ceiling** (B) "Water's coming through Flat 2's ceiling. It's Bill's shower." | Bathroom furniture worn past 0.8 with a let flat below | *Plumber*: £80, mended; below `landlordListened`. The plumber says what else is tired: the next most worn thing in the building gets a marker | *Bucket and a towel*: free, and a bucket you can see. Drips again in 2 days (thread); the third time it breaks. Below `leakedOnMe` about above: a grudge between tenants, not with you | Nobody comes: below `leftToIt` and `leakedOnMe` about above; something in the flat below takes wear; it breaks on the second drip, not the third | Who's above and below (friends over 30 feel `leakedOnMe` at half); knows their rights |
| 6 | **A word in the lobby** (T, waits) "Raj caught you by the bins. Wants £5 off, 'for the state of the cooker'." | A haggler, mid-lease, liking under 60, something worn or broken in his flat (the card names it) | *Fine, £5 off*: his rent's £5 lower for good; `agreedHaggle` (gossip: other hagglers ask within the week, anyone paying more feels `paysMore`) | *I'll fix it instead*: a promise by day + 5. Kept: `keptPromise`, worth more than the fiver. Broken: `brokePromise` and a moan in the chat | He takes it as a no and tells the stairs: `refusedHaggle` and `ignored`; other hagglers try their luck | What's wrong in his flat; who pays more than whom |
| 7 | **Noise complaint** (T, waits) "Bev, Flat 2: 'Flat 4's music. Every night. Every. Night.'" | A tenant kept awake lately, a noisy neighbour | *Have a word*: as chat's `word` act: Flat 4 `toldOff`, Bev `landlordListened`. Flat 4 knows who complained: a `slight` towards Bev | *Tell her to knock herself*: they talk on the landing, rolled from chemistry and traits: a `deepTalk` (sorted, maybe friends) or a `row`. Bev `landlordShrugged`. A row that turns to a fight counts as the storyteller's | Bev `ignored`; the noise goes on (`keptAwake` stacks); they're `slight` with each other both ways, with nobody to referee; a complainer writes you a letter | Both tenants' traits and chemistry; a party animal or musician |
| 8 | **Locked out** (T, night) "Jo's locked out. It's raining. She's sat on the step." | A tenant coming home; likelier if clumsy, or late from the pub | *Let her in*: `helpedLockout`; she owes you (`flag:owes`: her next good turn comes sooner). She clatters up at midnight: light sleepers on her stairs `keptAwake` | *Key under the mat from now on*: she's in, and no lockout card ever comes again; but the street door is easy: burglary risk up a step, and locks count for nothing, while the key's there. Thread: "Mags says the whole street knows about the key" | She sits in the rain (you can see her) and remembers: `leftToIt` at -6. A neighbour lets her in: a `favour` between them. Nobody by 01:00: a locksmith, £70 of hers, a tale | Clumsy or a drinker (it comes back); light sleepers; locks; who's awake |
| 9 | **The bins** (B) "The bins are overflowing. A fox has opinions." | `binsOverflowing` | *Bigger bins*: £60 once; they overflow half as often from now on (`flag:bigBins`; you see the new bins) | *Wait for Thursday*: free; a fox moment tonight, lobby dirt up. The busybody tells everyone whose bags they are: the messiest tenant gets `heardThings` from two neighbours | As wait, twice over: the fox gets in two nights, house-proud tenants `leftToIt`, and the dirt is what the council's "filthy" check reads | A messy tenant; a busybody; house-proud tenants |
| 10 | **Meter reader** (S) "Man from the gas wants to read the meter. He has a lanyard." | Fortnightly | *Let him in*: gas bill right. Without locks, 1 in 6 he wasn't from the gas: burglary risk up two steps for 3 nights. A busybody or retired tenant at home follows him round: no con, and they're chuffed (`keptAnEye`; a tale if he was a fake) | *Not without an appointment*: gas bills estimated high (`flag:estimated`, +10%) until a reader gets in; a follow-up asks a tenant who's home to let him in next week (`askedToHelp`, or a complainer's -3) | A tenant buzzes him in with nobody watching: the con at 1 in 4 without locks; if he was a fake, whoever let him in is `leftToIt` and the bill's still estimated | Locks; who's home (busybody, retired, works from home) |
| 11 | **Can I borrow your drill?** (T, waits) "Gareth wants to put a shelf up. Can he borrow your drill?" | A tenant at home, settled in a week or so | *Lend it*: a shelf, and the flat scores a touch higher for good; Gareth `landlordListened`. 1 in 10 he hits a pipe (#5 for below); a clumsy one, 1 in 3 | *I'll send someone*: £25, done properly, no pipe. A handy Gareth `notTrusted`; anyone else `landlordListened` | He borrows one off a mate: the shelf goes up with no thanks to you, Gareth `ignored`, and the pipe's 1 in 6 (nobody checked) | Handy or clumsy; a let flat below |
| 12 | **Someone's not on the lease** (T, waits) "Mags says there's a man living in Flat 3 who isn't on the lease." | A busybody; a tenant with a partner or friend who stays over | *Knock and ask*: a partner: the couple `nosyLandlord`, Mags `landlordListened`. A lodger: a follow-up to put him on the lease (+rent, and he's a tenant with traits) | *Let it go*: Mags `landlordShrugged`. Whoever it is stays: the flat wears faster, and a lodger counts as a person for the council's "overcrowded" check | Mags `ignored`, and tells the stairs: the couple get `heardThings` about Mags. He stays, as B | Partner or lodger; the flat's size; Mags's reach |
| 13 | **Sofa on the pavement** (S) "Someone's left a decent sofa outside. 'Free to good home.'" | Daytime; a flat or the lobby short on seats | *Into the empty flat*: a free seat (worn, Cheap), and the flat scores higher for its next viewing. 15% fleas: whoever moves in `itchy` | *In the lobby*: somewhere to sit on the stairs. The retired and busybodies sit there, so neighbours meet more (lobby talks: opinions move faster, both ways); house-proud tenants mind the stairs sooner. Fleas: whoever sits first | It rains. By morning it's a soggy sofa by your bins: #24 tomorrow with nobody to ask, lobby dirt up meanwhile, and house-proud tenants `leftToIt` | An empty flat or not; who's home all day; house-proud tenants |
| 14 | **Paying more than next door** (T, waits) "Mags has found out Flat 4 pays £20 less than her. She'd like that explained." | Two let flats of a size more than £15 apart; one tenant has `paysMore` | *Match it*: Mags's rent comes down for good; `rentCut`; gossip: the hagglers want the same | *Flat 4 goes up at renewal*: Mags `landlordListened`; a thread on Flat 4's renewal day: `rentRiseSmall`. Flat 4 hears who started it: `heardThings` about Mags | Mags `ignored`, keeps `paysMore`, and has it out with Flat 4 herself: `slight` both ways; the hagglers ask anyway | Who pays what; a haggler or knows their rights; an easy-going Flat 4 shrugs a rise |
| 15 | **Mum's visiting** (T) "Ellie's mum is here and would like a word with 'the landlord'." | A tenant's family visit (2.2), weekends | *Pop up and say hello*: Plain or better: Ellie `mumApproved`, and she's less likely to give notice for a month. Shabby or Grim: mum lists what's wrong: a promise to fix the worst thing by the weekend | *Send up biscuits*: £5; Ellie `landlordListened` small. Below Plain, mum works on Ellie anyway: `mumWorried`, and Ellie's notice chance is up for a fortnight. Nice or better, mum's impressed regardless | Mum leaves a note: "Called. Nobody about." Ellie `ignored`; below Plain, mum works on her at full strength | The flat's tier; Ellie's liking |
| 16 | **Shouting next door** (T, night) "Shouting from Flat 4. Something just hit the wall." | A couple with an opinion of each other under 0 | *Knock and check*: it stops; both `toldOff`; neighbours `landlordListened`. With an empty flat, one asks for it: a thread to a second lease, and they split without a fight | *Stay out of it*: neighbours `keptAwake`; the storyteller's fight and break-up weights for that couple up a step for a week (`risk`) | It goes on till two: neighbours `keptAwake` twice and `leftToIt`; fight and break-up risk up two steps | An empty flat to move into; light sleepers; how bad the couple are |
| 17 | **A month up front** (T, waits) "Dave'll pay a month up front if you fix his cooker this week." | A pays-early tenant, something broken in their flat | *Deal*: four weeks' rent now; a promise by day + 5. Broken, and `brokePromise`, he wants the rest back, and the chat hears | *Fix it today, keep your money*: mended now at the going rate; Dave `landlordListened`, gossip ("fixed same day"), and expectations tick up (`expect`). Good service sets the bar | Dave `ignored`; he stops paying early (`flag:noEarly`, a fortnight); the cooker stays broken and is on the council's list in a week | What's broken; your cash; the expectations grade |
| 18 | **The deposit** (T) "Raj leaves Friday. He wants all his deposit back. The carpet disagrees." | A tenant on notice, a deposit held, wear or dirt in the flat | *All of it back*: you pay for the carpet; Raj `wholeDeposit`, which his review reads: likely a star up, and it may say so. More stars, higher expectations | *Keep £60 for the carpet*: £60; Raj `keptDeposit`: likely a star down, and it may be his last straw in print. Knows their rights: he disputes it; it goes back plus a £30 fee | Denise splits it (you keep £30). To Raj it's still you: `keptDeposit` and `ignored`, likely two stars down | Messy (the carpet really is ruined) or house-proud (it isn't: keeping money is petty, gossip); knows their rights |
| 19 | **Chirping** (B) "Something in Flat 2 is chirping every 40 seconds. Smoke alarm." | A let flat with a smoke alarm, nobody's seen to it for 3 weeks | *Pop round with a battery*: £2; you're in the flat, so one of their hidden traits shows; `landlordListened` (knows their rights: `itsYourJob`, smaller) | *They can do it*: most do; a messy, clumsy or easy-going tenant takes the battery out instead: the alarm counts as broken for the council. `landlordShrugged` | They take the battery out, whoever they are: the council's list, and the tenant `leftToIt` (the chirping went on for a day first) | Their traits; an inspection booked |
| 20 | **A key for Bill's daughter** (T, waits) "Bill's daughter wants a key to the front door. 'In case he has a fall.'" | A retired tenant two weeks in, with family visiting | *Cut her a key*: £5; Bill `landlordListened`; she pops in most days (a visitor, and Bill's better for it); a key outside the building: burglary risk up a touch for good | *She can ring like everyone*: Bill `noKeyForFamily` (gossip). Once a season Bill has a bad turn (a moment): nobody finds him till Sandra the postie does; a tale, and Bill's friends `landlordShrugged` | She gets one cut from Bill's anyway: the same risk, but a key you don't know about and can't take back; Bill `ignored` | Locks; who's friends with Bill |
| 21 | **Scaffolding** (S) "Next door's builders want to scaffold your wall for a fortnight. £80." | Day 4 on, once a season | *Take the money*: £80; side flats get daytime noise and less light (`scaffolding`, night workers worst); top-floor windows are a way in while it's up; next door are pleased (`flag:nextDoorFriendly`) | *No*: next door are put out (`flag:nextDoorSore`): they object to your next planning application (the council's yes 15 points less likely), and their builders start at seven anyway | They take silence as yes: up it goes, with A's noise and risk and no £80; the side flats `leftToIt` (a thread to chase it: half the time you see it) | Who's in the side flats; valuables up top; any plans to build up |
| 22 | **What was in the parcel?** (T, waits) "Mags asks if you know what was in Dave's parcel. 'Only it rattled.'" | A busybody, a parcel taken in today | *Mind your own*: Mags `brushedOff`. Half the time it gets back to Dave: `keptMyBusiness` | *Tell her it rattled*: Mags likes you, and starts telling you things: within the week she brings you a neighbour's hidden trait (`reveal`). Dave hears: `landlordGossiped` | Mags `ignored`, and asks Dave herself, saying you wouldn't: their talk leans towards `slight` | Mags and Dave's opinion of each other; what's in the parcel |
| 23 | **Post for Mr Pritchard** (S) "More post for Mr Pritchard. One looks like a cheque." | Days 2 to 30 | *Send it on*: Bill, who knew him for years, `landlordListened` if he's about; later a thank-you that tells you a sitting tenant's hidden trait | *Open it*: £40; 1 in 3 a stiff letter from his solicitor (£40 back and £20 costs, a tale). If Bill's in he saw: `openedPost` (gossip) | Into the drawer. The third time, Pritchard's nephew comes for it at night with his old key: someone has a key (burglary risk up a touch till the locks change), and #30's thread | Whether Bill's in (retired: usually); his traits |
| 24 | **Fly-tipped mattress** (S) "There's a mattress by the bins. Flat 3 had a new bed delivered yesterday." | A delivery or move-out in the last 2 days, or the soggy sofa (#13); once a fortnight | *Have a word with Flat 3*: 3 in 4 it's theirs: they pay the council's £30, `caughtOut`. 1 in 4 it isn't: `accused` (gossip), and you pay. No delivery: the busybody names someone (right 2 times in 3) | *Pay the council, say nothing*: £30, gone tomorrow; whoever did it is likelier to do it again | It stays three days: kids bounce on it (a moment), lobby dirt up towards the council's "filthy", house-proud `leftToIt`, and the spot's a dumping spot (fly-tips likelier for a month) | Who had a delivery; a messy tenant; a busybody |
| 25 | **A window's gone** (B) "Flat 1's window's cracked. A ball, apparently." | A ground-floor window, after kids out front, a burglary try or a storm | *Glazier and bars*: £90; that window's no longer a way in, for good; Flat 1 lives behind bars (`barsOnWindow`, -2 while they're there; Nice and up mind more) | *Tape it*: free; Flat 1 colder (`tapedWindow`) and it's an easy way in till mended (burglary risk up a step). The plain fix is still there, in the usual way | Nobody does anything: colder than tape, Flat 1 `leftToIt`, burglary risk up two steps till mended | The flat's tier; the season; knows their rights (too cold for the council) |
| 26 | **Kittens** (T) "The cat's had kittens in Bill's laundry basket. Bill would like one." | The building cat, 3 weeks on | *Let Bill keep one*: Bill `gotPet`; pet owners like you; the pet precedent holds harder (`noPetButCat` doubles again) | *Homes for all, and the vet*: £40, no more kittens; Bill `sadAboutKitten`; next door take two (`flag:nextDoorFriendly`) | They stay: four cats on the stairs. Pet owners are delighted; house-proud and light sleepers `leftToIt`; the precedent; kittens again in spring | Pet owners; house-proud; a light sleeper below Bill; next door's mood |
| 27 | **Can I get a pet?** (T, waits) moved from `requestsHour` | As now | *Yes*: as now (`gotPet`), and the pet's on the map. A dog: light sleepers next door `noise` about its owner. The flat wears faster | *No pets*: as now (`noPet`); `noPetButCat` instead with a building cat | `ignored`; 1 in 3 they get it anyway, and you find out when you see it at the window | Cat or dog; the neighbours; the cat |
| 28 | **Is the heating on?** (T, waits) moved from `requestsHour` | As now | *Turn it up*: as now, and the heating bill's higher for the rest of the season | *Try a jumper*: as now (`wearAJumper`). Under the council's "too cold" line, a tenant who knows their rights writes to them: an inspection (`inspect`). A worn boiler and a jumper on a cold night: 40% it fails (the old boiler card, folded in) | `ignored`; as the jumper, and the tenant does write if they can | Knows their rights; complainer; the flat's temperature; the boiler's wear |
| 29 | **Can I paint?** (T, waits) moved from `requestsHour` | As now | *Go for it*: `gotToPaint`; the flat's their colour. When they leave, half of applicants hate it (a £40 repaint or a slower let); messy or clumsy: paint on the carpet (wear) | *Magnolia stays*: `noPaint` (house-proud twice as much); the flat stays easy to let | `ignored`; a handy or house-proud tenant paints anyway, with no thanks to you | House-proud, handy, messy; the flat's tier (a Smart flat in lime green) |
| 30 | **Pizza for an empty flat** (S, night) "A pizza for Flat 5. Flat 5's empty. Isn't it?" | Evening, an empty flat | *Have a look*: someone's been sleeping there. A tenant's partner or mate: they're `caughtOut` and a lodger thread starts. In week one, while Pritchard's keys are about: a sleeping bag, and his nephew's thread | *Give it to Bill*: Bill `freePizza`, and tells you a day later who he's seen going in (the same thread, a day behind). Meanwhile the empty flat's wear and dirt creep up | It goes cold on the step. Whoever ordered it comes down at midnight and takes it; it goes on unseen: wear and dirt creep up, and a viewing may find someone in it (that applicant goes) | Who has a partner with nowhere to go; week one; the cat |

#### What the rule changed

| Card | Was | Now, and why |
| --- | --- | --- |
| 1 Applicant | *Not today* just removed her | Both choices show you something: the flat through her eyes, or a neighbour's first opinion |
| 2 Parcel | Goodwill against a coin toss | Goodwill and a peek at Dave against the building's security |
| 3 Man in a van | *No thanks* did nothing | Quick and dodgy against slow and proper, with a tenant waiting; ignored, a tenant hires him anyway |
| 4 Cat | Pet owners only | The cat sets a pets precedent, and house-proud tenants mind |
| 6 A word in the lobby | £5 against a memory | Money for good against a promise you have to keep |
| 7 Noise | Have a word against shrug | Take a side, or let the two of them sort it on their chemistry |
| 8 Locked out | She paid either way | Your goodwill against the building's safety: the key under the mat |
| 9 Bins | £25 against dirt | A change to the building against dirt and blame on a tenant |
| 11 Drill | Lend against a shrug | Trust against doing it properly, which a handy tenant resents |
| 13 Sofa | *Leave it* did nothing | A flat against the lobby, where people meet |
| 14 Kids and a ball | **Cut.** Noise against a coin toss for a window, with no one in particular involved | Replaced by **Paying more than next door**: one tenant against another, money against fairness |
| 15 Mum | *Excuses* did nothing | The flat's tier decides both ways; staying away isn't safe if it's grim |
| 17 A month up front | *No ta* did nothing | Money now with a promise, against good service that raises expectations |
| 18 Boiler knocking | **Cut.** A money-or-gamble with nobody in it, and it duplicated the storyteller's breakdowns | Replaced by **The deposit**, which ties into reviews and expectations. The boiler's risk folds into #28 |
| 19 Chirping | £2 against a shrug | Getting into the flat (you learn something) against a safety risk the council will find |
| 20 Landing light | **Cut.** £3, the same fix every time | Replaced by **A key for Bill's daughter**: safety against a person's liberty |
| 21 Scaffolding | *No* did nothing | Money and risk now against next door's goodwill at planning |
| 22 What was in the parcel | *No idea* did nothing | Discretion against an informant who costs you Dave's trust |
| 24 Mattress | Money against dirt | Accuse a tenant (maybe wrongly) or pay and let it repeat |
| 25 Window | Money against a cold flat | Safety against liberty: bars for good, or tape and an easy way in |
| 26 Kittens | Bill's feelings only | Bill against the pets precedent and next door |
| 27 to 29 Requests | As now | Each gains a lasting side: a precedent, the council, the next let |
| 30 Wrong pizza | **Rewritten.** "Hawaiian. Serves you right" was a joke and nothing else | Now a mystery: someone's been sleeping in the empty flat |
| 5, 10, 12, 16, 23 | Close already | Sharpened: each choice now names who remembers, and the ignored outcome is worse |

Notes on the catalogue:

- **The three old chat requests (27 to 29) move into the drip,** so there's one place
  decisions arrive. The chat stays the building's voice: tenants still post, and your
  answer still appears there for everyone to see, which keeps the public-answer rule.
- **Letters stay for slow, formal things** with deadlines in days (rent at renewal, the
  council, Denise's advance). Cards are minutes; letters are days.
- **Applicants keep their panel.** Card 1 is an extra, in-person way to meet one.
- **Each card has a hook,** its slim line in the tray (at most 40 characters: "Parcel for
  Dave.", "Man in a van: £40 cash"), as well as the full text shown when it's open.
- **Precedents are said out loud.** When a card sets one (the cat and pets, a fiver off for
  one haggler), the notice says so ("Everyone's seen the cat. Saying no to pets just got
  harder."), and the thought label names it.
- New memories (in `MEMORIES`): `tookParcel`, `missedParcel`, `parcelNicked`, `leftToIt`,
  `keptWaiting`, `buildingCat`, `shooedCat`, `catHair`, `noPetButCat`, `helpedLockout`, `nosyLandlord`,
  `itchy`, `mumApproved`, `mumWorried`, `brokePromise`, `keptPromise`, `itsYourJob`,
  `scaffolding`, `landlordGossiped`, `keptMyBusiness`, `brushedOff`, `tapedWindow`,
  `barsOnWindow`, `sadAboutKitten`, `freePizza`, `waitedForRepair`, `notTrusted`,
  `askedToHelp`, `keptAnEye`, `wholeDeposit`, `keptDeposit`, `accused`, `openedPost`,
  `noKeyForFamily`, `gotToPaint`, `noPaint`, `grubbyWindows`. Social (in `SOCIAL`):
  `leakedOnMe`. Sizes in the range of the existing ones: small (1 to 4) for most; 6 to 8 for
  `brokePromise`, `helpedLockout`, `keptDeposit` and `noPetButCat`. Those that others would
  hear about get `gossip: true`.
- New flags (1.5): `slowLet`, `nextDoorCat`, `nextDoorFriendly`, `nextDoorSore`,
  `keyUnderMat`, `bigBins`, `owes`, `estimated`, `noEarly`, `familyKey`, `strayKey`, `bars`,
  `tape`, `petPrecedent`, `informant`, `dumpingSpot`, `lobbySofa`, `squatter`.
- New tale kinds: `parcelNicked`, `lockout`, `cowboy`, `leak`, `cat`, `kittens`,
  `brokePromise`, `pritchard`, `fakeMeterMan`, `deposit`, `squatter`, `badTurn`. Interest
  low (1 to 2) except `cat`, `kittens` and `squatter`, which people talk about for weeks.

### 1.5 How cards turn into stories

Each choice is a short list of effects, written as text like the chat and post `act`
strings so they save. The cards compute their effect lists from who and what is involved
(that's how one card plays differently with different people), and the lasting ones are
marked so the rule test (1.0) can check them.

| Effect | Example | What it does | Lasting |
| --- | --- | --- | --- |
| `mem` | `mem:42:tookParcel` | a memory for a tenant (reuses `remember`) | yes |
| `soc` | `soc:42:leakedOnMe:17` | a memory about another tenant (reuses `rememberAbout`), so opinions move | yes |
| `pay` | `pay:-8000:Plumber` | money in or out (reuses `book`) | no |
| `mend` / `wear` | `wear:31:0.9` | mend something or set its wear (reuses upkeep) | yes |
| `rent` | `rent:flat-2:-500` | a lease's rent changes for good | yes |
| `flag` | `flag:keyUnderMat` or `flag:slowLet:flat-2:3` | a fact about the building, for good or for some days; read by cards and by crime, upkeep, planning, leases and outcomes | yes |
| `reveal` | `reveal:42:handy` | a hidden trait shows (reuses `noticeTrait`) | yes |
| `tale` | `tale:cowboy:42` | writes it down for the Sunday recap (reuses `tale`) | yes |
| `chat` | `chat:Landlord took Dave's parcel in.` | a line in the chat | no |
| `thread` | `thread:cowboyBack:72` | a follow-up card, due in that many game hours | yes |
| `promise` | `promise:mend:31:7` | something you said you'd do by a day; kept or broken is a memory | yes |
| `risk` | `risk:burglary:1:3` | a storyteller weight up (or down) a step for some days (reuses its weights) | yes |
| `inspect` | `inspect:5:A tenant has written to us` | books a council visit (reuses `bookInspection`) | yes |
| `expect` | `expect:2` | nudges the expectations level (it then drifts as usual) | yes |
| `act` | `act:word:flat-3` | any existing chat or post act, so nothing's written twice | as the act |

**Threads** are how a card grows. A thread is a follow-up card with its own `when`, due at
a time, that keeps the original's people and things. The man in the van, the cat, the
lodger, Pritchard's post, the key under the mat, the empty flat and the leak each run two or
three cards over a week or so. At most 3 threads live at once (`DRIP.maxThreads`).

**Promises** are threads you owe. "Fix his cooker this week" is checked against the real
cooker on the day. Kept: `keptPromise`. Broken: `brokePromise`, and a moan in the chat.

**Flags** are how a choice changes the building without a new system each time. A flag is
a name, maybe a subject, and an end tick (or none). Each flag has at least one reader, listed
with it in `drip.ts`, so none is write-only: `keyUnderMat` in `burglaryRisk`, `nextDoorSore`
in the planning decision, `slowLet` in the applicant pace, `noEarly` in good turns, and so
on. At most 16 live at once; the oldest timed one goes first.

**Cards and the storyteller share a budget.** A card's `risk` only moves weights the
storyteller already has; it never starts a big event itself. A happening a card choice
leads to (a fight from #7's row, a burglary through #8's key) goes through the storyteller's
`canStart` and puts its tag on cooldown (`COOLDOWN`) like any other, so the drip changes what
comes next rather than piling more on.

### 1.6 Ignoring a card

Decided: **ignoring is allowed, and it's always the worst of the three outcomes.** Worse in
kind, not only in money.

- **Two parts, every time.**
  1. **The person remembers.** A tenant who asked gets `ignored` (-5). A tenant it happened
     to gets `leftToIt` (-4, or more where it's earned: Jo on the step in the rain).
     Someone from outside remembers too: next door go sore, the van man goes to your
     tenants instead, the applicant tells her friends.
  2. **The world decides, badly.** What happens with no landlord about is the worse of the
     ways it could go: the parcel left on the step, not in the lobby; the scaffold up with
     no money; the battery out of the alarm whoever the tenant is.
- **Moments pass.** A card about something happening now (someone at the door, a leak, a
  parcel, the cat, a lockout) resolves at its worst when its countdown runs out: the moment
  has gone, and the world decided.
- **Asks wait, and sour.** A tenant's ask (*waits* in the catalogue) doesn't go away. Every
  480 game minutes unanswered (about 2.4 real minutes at 1x) the tenant gets `keptWaiting`
  (-2, stacks to 3), and the ring drops a step. After the third step, 1,440 game minutes,
  it resolves at its worst. You can still answer at any step; the `keptWaiting` already
  earned stays.
- **Visibly.** The notice says what the world did ("Nobody let Jo in. She waited an hour in
  the rain."), and where it can be seen on the map, it is: Jo on the step, the soggy sofa,
  four cats on the stairs.
- **In proportion.** An ignored card is worse than its worse choice, not a disaster. It
  never makes a tenant leave outright or breaks something outright; it makes those likelier
  through the usual systems. There's no cap to keep a non-player solvent: ignoring is a
  real answer with a real cost.
- **How the test knows it's worst.** Each outcome on each fixture gets a score: memory
  values times the people holding them, plus a point per £10, less 3 a risk step, 5 a broken
  thing, 4 a lost applicant. Ignored must score below both choices on every fixture, and
  must hold a bad lasting signature that neither choice has (`ignored`, `leftToIt`, or an
  outsider's grudge flag).
- **Away.** Three cards in a row resolved by ignoring take a card off each day's budget
  (1.2) until you answer one, so a player who's put the phone down comes back to a few bad
  outcomes, not a dozen.

---

## 2. Life worth watching

The building should look busy even when you're deciding nothing. RimWorld colonies, Sims
houses and ant farms are watchable for the same reasons: there are always a few people
visibly doing something; what they're doing is readable at a glance; they keep routines
you start to recognise; and every so often two routines collide and something happens.

### 2.1 Who's home when

A tenant has a **schedule**, not just a job or no job. Rolled with the person in
`makePerson`, replacing the single `LETTING.working` chance.

| Schedule | Share | Hours away (weekdays) | Home and awake on a weekday | What you see |
| --- | --- | --- | --- | --- |
| Office | 35% | 08:00 to 18:00 | early morning, evenings | the morning rush, the evening return |
| Early shift (nurse, barista, postie) | 15% | 06:00 to 15:00 | from mid-afternoon | a nap, then out on the landing |
| Late shift (bar, care work) | 10% | 13:30 to 22:30 | mornings | late breakfast, back after dark |
| Nights (security, A&E) | 5% | 20:30 to 07:30 | 14:00 to 20:00 | odd hours; wants daytime quiet |
| Works from home | 15% | none | all day | at the table on a laptop, calls on the landing, kettle runs |
| Student | 10% | 10:00 to 13:00, Tue and Thu | most of the day, up late | friends round, music, late nights |
| Retired | 10% | none | all day | routines you can set a watch by |

Weekends everyone keeps their own hours, and most are in.

**Target:** on a weekday between 10:00 and 16:00, at least 40% of tenants are home and awake.

**Habits.** Each tenant gets one or two habits from a table, picked by schedule and traits.
A habit replaces some of their `potter` time, at roughly the same time each day, so you
start to know them. They meet no needs and cost nothing, so they don't upset the balance.

| Habit | When | Who |
| --- | --- | --- |
| Paper from the corner shop | 08:30 | retired, early risers |
| A smoke on the front step | after meals | anyone (one in five) |
| A run | 07:00 or 18:30 | office, students |
| Watering the lobby plant | mornings | house-proud |
| Calls on the landing | working hours | works from home |
| Tea on the step in the sun | afternoons, warm days | retired, nights |
| Feeding the cat | 08:00 and 17:00 | pet owners, friendly (once there's a cat) |
| Takeaway Friday | Friday 19:30 | anyone without keen cook |
| Window watching | rainy or cold afternoons | retired, busybody |
| Practising on the step | sunny evenings | musician |

**The starting cast.** Flat 1's sitting tenant becomes **works from home** (still pays on the
dot). Bill keeps being retired, and gets the routines: paper at half eight, the shops at
eleven, the telly up loud at two, tea at half five, bed at ten. That alone puts two people
in the building all day from minute one.

### 2.2 Visitors

A new pawn kind, `visitor`, with a role. They come in from the street, do one thing, and go.
Named where they recur, so they become part of the cast.

| Visitor | When | What they do | Ties to |
| --- | --- | --- | --- |
| **Sandra the postie** | every morning, about 09:30 | walks up, puts post in the lobby, has a word with whoever's there | The post badge lights when she's been (UI only: letters are still made when they are now) |
| Couriers | 2 to 4 a day, 09:00 to 20:00 | buzz, wait, leave or hand over a parcel | Card 2 |
| Takeaway riders | evenings; Fridays more | to whoever's low on food with no kitchen, or Takeaway Friday | `Out for chips`, habits |
| Friends | afternoons and evenings; friendly and party animals more | knock, go in, sit on the sofa, leave | social; parties grow from this |
| Family | weekends | a mum, a brother, a daughter; sit down for tea | Cards 15, 20 |
| Partners who stay over | couples in different flats, or with someone outside | arrive late, leave early | Card 12 |
| **Lorraine who does the stairs** | 08:00 daily, if you pay the cleaner | mops the stairs and lobby you can see go clean | The cleaner, made visible |
| Window cleaner | monthly, if you take him on | ladder out the front | First-week card (day 3) |
| Meter reader | fortnightly | Card 10 | |
| Tradespeople | when something's mended | walk up with a toolbox, a few minutes' banging | Mending, made visible |
| Council officer | inspections (already happen) | clipboard, walks round | The council, made visible |
| Applicants viewing | with Denise | follow her round the empty flat | Applicants, made visible |
| Kids from the street | 15:30 to 18:00, school days | on the pavement with a ball | Moments 11, 22; can crack a window (card 25) |
| Dog walkers, prams, joggers | the existing passers-by, given variety | walk past; dogs stop at the step | |
| **The building cat** | once you let it stay (card 4) | sleeps on the stairs, on doormats, in the sun; visits its favourite | Cards 4, 26 |
| Pets | once you say yes to one | a cat at a window, a dog walked twice a day | Card 27, `life.pet` |
| A fox | nights, bins full | knocks a bin over | Card 9 |

### 2.3 Ambient moments

Little scenes that cost the player nothing. Each needs one or two people and a place, runs
5 to 30 real seconds (timed in ticks, 0.1), shows a bubble or a pose, and may leave a social memory. A few seed a
card or write a tale. They come from what's true now, the same way cards do.

| # | Moment | Needs | Leaves |
| --- | --- | --- | --- |
| 1 | Holding the door for a neighbour | two people at the street door | small `chat` between them |
| 2 | Dropped shopping on the stairs: a neighbour helps, or walks past | someone coming home with shopping | `favour` or `slight` |
| 3 | Bill and the paper in the lobby | Bill's habit | |
| 4 | A smoke on the step, a word with a passer-by | the habit | |
| 5 | The cat asleep on a doormat; the tenant steps over it | the cat | pet owners like it |
| 6 | Fox in the bins | night, bins full | lobby dirt up; can seed card 9 |
| 7 | Singing in the shower (♪); next door bangs on the wall | someone washing, a light sleeper next door | a `slight` |
| 8 | Burnt toast: alarm beeps, tea towel waved | a clumsy cook | can seed card 19 |
| 9 | Pacing the landing on a call | works from home | |
| 10 | Courier tries the wrong door; the tenant points him upstairs | a courier, someone home | |
| 11 | Knock and run: a tenant opens the door to nobody (?) | kids out, someone in on the ground floor | |
| 12 | Waving from a window to a friend in the street | a friend arriving | |
| 13 | Lingering by the post to see who's in | busybody | (already half there) |
| 14 | Dancing in the kitchen | a couple at home, evening | |
| 15 | Borrowing sugar: knock, cup, chat on the doorstep | friendly neighbours | `favour` |
| 16 | Busking on the step; someone drops a coin | musician's habit, sunny | |
| 17 | Carrying a big box up the stairs; two others help | someone moving in | `favour` both ways |
| 18 | Night owl and early bird cross on the stairs. "Morning." "Night." | the two schedules | small `chat` |
| 19 | Sandra and Bill, every morning | the postie and Bill | (a bond with a non-tenant, for flavour) |
| 20 | A takeaway left on the step; the cat investigates | a rider, the cat | the owner `slight`s the cat, in spirit |
| 21 | Pats pockets at the door, then finds the keys | anyone coming home | one in twenty, card 8 instead |
| 22 | Kids bounce on the fly-tipped mattress | card 24 left alone | |
| 23 | Getting the washing in as it turns cold | a garden or roof, washing out | |
| 24 | Trip on the stairs | a clumsy tenant, and the lobby sofa (card 13), a mattress or filthy stairs in the way | a `slight` for whoever left it there, a tale if twice |

### 2.4 Readable at a glance

On a phone the building is small. What someone's doing has to read from a few pixels.

- **Icons in bubbles, not words.** A set of 8x8 pixel icons drawn like the tab icons: ♪
  music, cup (kettle, tea), envelope (post), box (parcel), phone, Zz, ? , £ (moan, exists),
  ♥ (exists), fork (eating), spanner (mending), paw (the cat). Words in bubbles only for
  card hooks and a few lines of chatter.
- **Poses.** Add `read`, `phone`, `carry`, `mop` and `wave` to the existing `sit`, `sleep`
  and `dance`.
- **Props.** A parcel in a hand, a bucket under a drip, a ladder out the front, a toolbox,
  the cat. One prop per person.
- **The `!` marker** over anything a card is about.
- **`doing`** stays the words in the info panel. Habits get proper ones ("Off for the paper").

### 2.5 The budget

So it stays readable on a phone, the renderer and the sim keep to these:

| Thing | At most | Notes |
| --- | --- | --- |
| Bubbles on screen | 4 | priority: card markers, then talk, then moments, then habits; the rest wait |
| Bubble time on screen | at least 1.5 real seconds | the renderer holds it, so at 3x they don't flicker (the sim's `until` is a minimum) |
| Ambient moments running | 2 | one starts every 15 to 30 real seconds at 1x (50 to 100 game minutes) in waking hours |
| Visitors on the map | 3 | not counting party guests and applicants with Denise |
| Passers-by | 3 | as now, but capped |
| Open cards | 2 | slim, stacked, newest on top (1.1) |
| Props per person | 1 | |

---

## 3. The first week

The drip starts on day 1, straight after Denise's walk. The storyteller's big events still
wait for day 8 (or the list done), as now. In week one the handover's script sets the cards
instead of the daily budget: **2 to 3 a day**, at about the times below. If one can't happen
(you've already let the flat, say), it's skipped and the ordinary drip may put one of its
own in that place. Scripted cards obey the consequence rule (1.0) and are in its test like
any other.

With the faster clock a game day is about 7 real minutes at 1x, so the week is under an
hour. The beats that aren't cards (arrivals, moments, Denise) are what you watch between.

Day 1 is a Monday; the game starts at 08:00.

| Day | Time | Beat |
| --- | --- | --- |
| **1 Mon** | 08:00 | Denise's walk (as now) |
| | 09:00 | Flat 1's tenant at the table on a laptop; Bill off for the paper. Sandra the postie brings Pritchard's notes and Denise's list |
| | 09:30 | **Card 1:** the cheeky applicant (she exists already) is on the step, in person |
| | 11:00 | **Card:** "Bill's struggling up the stairs with his shopping." *Carry it up*: Bill `landlordListened`, and he talks all the way up: one of his traits shows. *He'll manage*: he does, slowly; the first sign the stairs are too much (a thread in week three: Bill asks about a ground-floor flat, which would free his for a new let at the going rate) |
| | 15:00 | Denise brings an applicant round Flat 2 (visible); the applicant panel |
| | 16:00 | Kids on the pavement with a ball (to watch) |
| | 18:00 | Moment: Bill and Flat 1 meet by the post. First opinions form where you can see them |
| | 20:00 | **Card 30:** a pizza for the empty flat. Someone's been in there: Pritchard's keys |
| **2 Tue** | 08:00 | **Card:** "A cleaner's put a card through: £30 a week for the stairs." *Take her on*: Lorraine does the stairs every morning (`stairsDone`), and hears everything: now and then she tells you a tenant's hidden trait. *Not yet*: the stairs are yours; the dirt climbs towards the council's "filthy" |
| | 11:00 | Furniture you bought arrives with a delivery man, carried up |
| | afternoon | If Flat 2's let: the move-in, with boxes and the box moment (17) |
| | 12:00 | **Card 2:** a parcel for Bill, who's out at the shops |
| | 19:00 | **Card:** the new tenant "asks where the bins go". *Show them*: they meet Bill on the way (a first opinion, from chemistry). *Point*: their recycling goes in the wrong bin for a week (bins overflow sooner), and Bill's first sight of them is that: a `slight` |
| **3 Wed** | 10:00 | **The first crisis, card 5: the leak.** Bill's shower (set worn at the start) drips into Flat 2 below. A bucket appears if you choose it. If Flat 2 is let, its tenant gets `leakedOnMe` about Bill: their first grudge, or not |
| | 14:00 | If the bucket: Bill, embarrassed, at Flat 2's door (a moment) |
| | 15:00 | **Card:** a window cleaner. *£15 a month*: he comes monthly (a visitor), the flats get a touch more light, and the house-proud notice. *No ta*: the windows grime over; from week three house-proud tenants `grubbyWindows` |
| | 17:00 | **Card 3:** the man in a van, timed after the leak (if the shower's still worn) |
| **4 Thu** | morning | If the bucket: the leak's back (thread). **Card 10**, the meter reader |
| | evening | **Card 21:** scaffolding next door, £80 (money's tight: a real choice) |
| **5 Fri** | 09:00 | Denise's advance letter, if you're short (as now) |
| | afternoon | **The new tenant's first card,** from their traits (a drill, a haggle, a noise moan) |
| | evening | Takeaway Friday; friends visit Flat 2. **Card:** "Flat 2's having a few people round. All right?" *Fine*: a good night (`goodNight` among the guests); light sleepers `keptAwake`; their party comes sooner once the storyteller wakes. *Keep it down*: they do (`toldOff`); the neighbours sleep and `landlordListened` |
| **6 Sat** | daytime | Bill's family visit. **Card 15.** Kids. A busy street |
| | 23:30 | **Card 8**, the lockout (night), or card 16 or 7, whichever the building gives |
| **7 Sun** | morning | **Card 4:** the cat. A long story starts on a quiet day |
| | evening | The Sunday recap (as now), now full of small things. The "Short for Monday" alert if it applies |
| **8 Mon** | 09:00 | The mortgage. The storyteller wakes, and the daily budget (1.2) takes over. Week two goes on as now (the stripped-flat idea on day 9) |

Rules for the script:

- Every beat respects `maxOpen`. Waiting asks can hold a scripted card back; it comes when
  there's room, or is skipped if its moment has passed.
- Each beat checks its condition when due, so it's never wrong about the building.
- Skipping the handover from the menu skips the script; the daily budget starts at once.
- First-week money from cards is capped at £150 in total (`DRIP.firstWeekIncome`), so the
  Monday squeeze and Denise's advance still mean something.

---

## 4. Always a project (brief)

Something visible to save for, one at a time.

- A slim bar under the money: **"Next: furnish Flat 3. £340 of £610."** Tap it for what it
  needs, which opens Build there.
- Picked from the real building in order: the list's bare flat; the stripped flat (from
  week two); locks; a laundry, bike store or garden; insulation where the noise is worst;
  posh furniture once it opens. The player can pin a different one.
- It shows a guess at when you'll get there from this week's rent less the bills.
- Money cards (scaffolding, Pritchard's cheque, a month up front) visibly move it, which is
  part of why they're tempting.
- No rewards for finishing beyond the thing itself. A line from Denise the first time.

---

## 5. How it fits

### 5.1 Existing systems

| System | What changes |
| --- | --- |
| **Clock** (`state.ts`, `tuning.ts`, everywhere a duration is set) | `TICKS_PER_MINUTE` 60 → 20, `SECONDS_PER_GAME_MINUTE` 0.9 → 0.3 (0.1). On-screen durations (bubbles, talks, poses) move to ticks. Per-tick chances rescaled |
| **Storyteller** (`events.ts`) | Untouched as a dealer. Cards are not happenings and don't count to `CAP`. A happening running or due takes a card off the day's budget. A card's `risk` moves a weight the storyteller already has (up or down, for some days), but never starts a big event itself; a happening a card leads to goes through `canStart` and its cooldown. `FIRST_DAY` stays 8 |
| **Chat** (`chat.ts`, `social.ts`) | Requests (`requestsHour`) become drip cards 27 to 29, which wait (1.6) and spend the budget. Answers still post in the chat, seen by all. `chatMorning`'s two-day expiry goes for drip requests; their clock is the card's |
| **Post** (`post.ts`) | Unchanged. Letters stay for slow, formal things; two or more with choices waiting take a card off the day's budget. The badge lights when Sandra's been (UI) |
| **Tales** (`tales.ts`) | New kinds (1.4). Cards write tales through the `tale` effect |
| **Memories and opinions** (`thoughts.ts`, `social.ts`) | New memory ids in `MEMORIES` and `SOCIAL` (1.4); `soc` effects use `rememberAbout`. Precedent thoughts name the precedent |
| **Upkeep and the council** (`upkeep.ts`) | Cards read wear and broken; `mend` and `wear` effects call it. Mending sends a tradesperson. `issues()` counts a smoke alarm with its battery out (worn to broken) as missing, and a lodger as a person for "overcrowded". `inspect` calls `bookInspection` |
| **Crime** (`crime.ts`) | `burglaryRisk` reads the flags: `keyUnderMat`, `familyKey`, `strayKey`, `tape` (a way in), `bars` (not a way in), scaffolding (top-floor windows are ways in) |
| **Planning** (`planning.ts`) | The decision reads `nextDoorSore` (-15 points) and `nextDoorFriendly` (no objection letter) |
| **Expectations** (`expectations.ts`) | The `expect` effect nudges the level; it then drifts as usual. Reviews moved by card 18 feed it the usual way |
| **Handover** (`handover.ts`) | Gains the first-week script. Bill's shower starts worn |
| **Applicants and leases** (`leases.ts`) | Card 1 shows one more trait; schedules replace `working` in `makePerson`; `slowLet` slows the applicant pace for a flat; `rent` effects change a lease's rent; card 18 reads `lease.deposit` |
| **Outcomes** (`outcomes.ts`) | Good turns read `owes` (sooner) and `noEarly` (no early rent) |
| **Tenants** (`tenants.ts`) | `wakeAt`, `bedtime` and the work check read the schedule. A habit or moment is tried before `potter` |
| **Pawns** (`pawns.ts`) | `spawn` asks `visitors.ts` too; `think` hands visitors to it; the passer-by cap |
| **Pace** (`pace.ts`, `main.ts`) | `NIGHT_BOOST` goes; `planTicks` loses its `quiet` argument. `quietNight` also needs no open card, no visitor and the cat asleep, and drives the Skip to morning button (0.2) |
| **Tuning** (`tuning.ts`) | New blocks: `DRIP`, `SCHEDULES`, `HABITS`, `VISITORS`, `MOMENTS`, `BUDGET`; new `MEMORIES`, `SOCIAL` and `INTEREST` entries |

### 5.2 New state

Save version 9 goes to 10. Old saves have every stored tick divided by 3 (0.1), and get an
empty drip, a schedule from their job (job: office; none: retired), no habits until
morning, no visitors.

```ts
State.drip: {
  open: Card[];                 // at most DRIP.maxOpen
  budget: number;               // cards left today (set at 07:00)
  day: number;                  // the day the budget is for
  lastCard: number;             // tick the last card appeared (for DRIP.minGap)
  ignoredRun: number;           // resolved by ignoring, in a row
  cooldowns: Record<string, number>;   // by card id, and by "pawn:<id>"
  threads: { card: string; due: number; data: Record<string, string | number> }[];
  promises: { what: string; arg: string; byDay: number; pawn: number }[];
  flags: { id: string; subject?: string; until?: number }[];   // at most 16; no until = for good
  log: { tick: number; card: string; chose: number | 'ignored' }[];   // last 50, for tests and the recap
  income: number;               // first-week money from cards
}
Card: { id: number; def: string; tick: number; until: number; seenBy?: number;  // the 10-second floor (1.1)
        waits?: boolean; step?: number;                                          // asks that sour (1.6)
        pawn?: number; flat?: string; furniture?: number; visitor?: number;
        data?: Record<string, string | number> }
State.cat?: { pawn: number; favourite?: number; since: number }
State.visitors: { next: Record<string, number> }     // next time per role
Life.schedule: 'office' | 'early' | 'late' | 'nights' | 'home' | 'student' | 'retired'
Life.habits: string[]
Life.moment?: { kind: string; until: number; step: number; with?: number; at?: [number, number] }
Pawn.kind gains 'visitor' | 'animal'; Pawn.role?: string; Pawn.prop?: string
Pawn.pose gains 'read' | 'phone' | 'carry' | 'mop' | 'wave'
TaleKind gains the kinds in 1.4
```

### 5.3 New files

| File | What's in it |
| --- | --- |
| `src/sim/drip.ts` | The daily budget, selection, ignoring and souring, effects, threads, promises, flags and their reader registry |
| `src/sim/cards/tenant.ts`, `building.ts`, `street.ts`, `firstWeek.ts` | The catalogue, one file per source so agents don't collide. Each card: `when`, weight, `hook`, text, `turnsOn`, fixtures, and a function from the card's people and things to the three effect lists |
| `src/sim/cards/rule.ts` | The rule-test helpers: signatures, the lasting list, the outcome score, fixture builders |
| `src/sim/schedules.ts` | Schedules and habits |
| `src/sim/visitors.ts` | Visitor spawning and thinking, the cat, pets, the fox |
| `src/sim/moments.ts` | Ambient moments |
| `src/sim/project.ts` | The next project |
| `src/ui/cards.ts` | The card tray, the `!` taps, the edge chips' hit areas, the waiting dots |
| `src/ui/project.ts` | The project bar |

---

## 6. Build order

Chunk 0 goes first and alone, so the parallel chunks touch different files. After that,
chunks 1 to 7 run in parallel, each in its own worktree and branch. Chunk 8 is last. The
coordinating session merges with the full suite passing (`npx vitest run`,
`npx tsc --noEmit -p .`, `npm run build`).

| Chunk | Model | Touches | Depends on |
| --- | --- | --- | --- |
| **0. Clock and scaffold** | opus | The clock change (0.1) everywhere it reaches: `state.ts` (`TICKS_PER_MINUTE`), on-screen durations to ticks in `events.ts`, `social.ts`, `crime.ts`, `tenants.ts`, per-tick chances; tests re-baselined. Then the scaffold: `save.ts` (v10, ticks ÷ 3), `start.ts`, `sim.ts` (calls to stubs), `pawns.ts` (dispatch to `visitors.ts`), `tenants.ts` (one hook before `potter`), `tuning.ts` (every new block, memory and tale kind, stubbed), flag reader hooks in `crime.ts`, `upkeep.ts`, `planning.ts`, `leases.ts`, `outcomes.ts`, `expectations.ts` (no-ops with no flags), `cards/rule.ts` and the empty rule test, all new files as stubs, `index.html` and `style.css` mount points, `test/policy.ts` answers cards | none |
| **1. Drip engine, tray and Skip to morning** | opus | `drip.ts`, `ui/cards.ts`, `hud.ts` (dots on Done and Close, the Skip button), `pace.ts` and `main.ts` (drop `NIGHT_BOOST`, the skip), `style.css` (card rules, appended) | 0 |
| **2a. Tenant cards** | opus | `cards/tenant.ts`, `social.ts` (drop requests from `requestsHour`) | 0 (writes against the card interface from 0) |
| **2b. Building cards** | sonnet | `cards/building.ts` | 0 |
| **2c. Street cards** | sonnet | `cards/street.ts` | 0 |
| **3. Schedules and habits** | opus | `schedules.ts`, `tenants.ts` (wake, bed, work), `leases.ts` (`makePerson`), `start.ts` (Flat 1 works from home, Bill's routine) | 0 |
| **4. Visitors** | sonnet | `visitors.ts`, `pawns.ts` (spawn caps) | 0 |
| **5. Moments** | sonnet | `moments.ts` | 0, reads schedules through the stub |
| **6. Readable on a phone** | sonnet | `render/renderer.ts`, `render/art.ts` (icons, poses, props, `!` markers, edge chips, the arrival pulse, bubble budget) | 0 |
| **7. First week and project** | sonnet | `cards/firstWeek.ts`, `handover.ts`, `project.ts`, `ui/project.ts` | 0 |
| **8. Pacing pass** | opus | `tuning.ts` numbers only, `test/pace.soak.test.ts` | all |

Chunk 2a moves to opus: the tenant cards are where most of the dilemmas between people live,
and getting each card's two sides genuinely different is design work, not typing.

To keep merges clean: only chunk 0 edits `state.ts`, `save.ts` and `sim.ts`, and only chunk 0
touches the flag hooks in other systems (chunk 1 fills in what each flag does, inside
`drip.ts`'s reader registry). Chunks change numbers inside their own `tuning.ts` block and
nowhere else in it. `start.ts` is chunk 3's after chunk 0, except Bill's shower wear, which
chunk 0 sets.

### Acceptance tests

Each chunk brings its own tests. Seeded, deterministic; slow ones are soak tests.

| Chunk | Test |
| --- | --- |
| 0 | **The clock:** a game day is 28,800 ticks; a walk across the building takes the same ticks as before; a bubble set for 3 seconds lasts 200 ticks. A v9 save loads at the same game time (ticks ÷ 3), with an empty drip and schedules from jobs. The existing soaks pass after re-baselining (needs in the same bands). The rule test runs and passes on an empty catalogue. Flag hooks change nothing with no flags set |
| 1 | The day's budget: 2 on a quiet day, 0 with a happening and two letters waiting; never more than 2 cards a day plus one follow-up; at least 240 game minutes apart; an unspent budget is gone at 23:00, with no card forced. Never more than 2 open over 14 days. A moment card resolves at its worst when its countdown ends; an ask gains `keptWaiting` at 480 and 960 game minutes and resolves at its worst at 1,440. Three ignored in a row take a card off the budget. A card isn't resolved before its 10-real-second tick. A flag for good survives save and load; a timed one goes when due; every flag has a reader. A happening a card leads to puts its storyteller tag on cooldown. A promise checks the real thing on its day. Skip to morning plays the same ticks as running to 07:00, stops when something wakes, and nothing else changes the speed. Same seed, same cards. UI (fake clock, 390 × 844): two slim cards stacked newest on top; tapping a card or its `!` opens it; a dot on Done and Close while one waits |
| 2a to 2c, 7 | **The consequence rule** (1.0) on every card in the file, on every fixture: *kind* (A and B differ by more than `pay` and `chat`), *lasting* (A, B and ignored each leave a lasting effect), *not cosmetic*, *tied* (the fixtures change an outcome), *seen later* (memories, threads, flags and tales all exist and are read), *ignored is worst* (scores below both, and holds a bad lasting effect neither choice has). And: each card's `when` is false on a building where it can't be true and true on its fixtures; its hook is at most 40 characters and its text at most 80. Requests no longer appear from `requestsHour` (2a) |
| 3 | Over 14 days with 5 flats let by the decent policy: weekdays 10:00 to 16:00, at least 40% of tenants home and awake on average. Night-shift tenants sleep in the day. Nobody misses work or a habit's slot because walks got shorter in game time. Needs stay in the same bands as before |
| 4 | Visitors on the map never over 3, passers-by never over 3. Sandra comes every morning. The cleaner appears only if paid. Mending brings a tradesperson |
| 5 | Never more than 2 moments at once. A moment starts at least every 100 game minutes (30 real seconds at 1x) in waking hours with 3 or more tenants in; each runs 5 to 30 real seconds |
| 6 | Bubble budget: never more than 4 drawn. A bubble set for 10 ticks is shown 1.5 real seconds at 3x. The `!` and edge chip show for every open card. (Renderer unit test on a fake clock) |
| 7 | Days 1 to 7: 2 to 3 scripted cards a day; the leak card on day 3 when Bill's in; the storyteller starts nothing before day 8; first-week card income at most £150. The project bar names the bare flat on day 1 |
| 8 | **The pacing soak** (below) |

**The pacing soak** (`test/pace.soak.test.ts`), seeds 1, 2 and 4, decent, ruthless and
random policies, 21 days, sampled every game minute from 07:00 to 23:00:

| Measure | Pass |
| --- | --- |
| Drip cards a day | 0 to 2 every day (plus at most one follow-up); mean 1 to 1.6 a day over each week from week two |
| Busy days are quiet | on days with a happening or two letters waiting, at most 1 card |
| Decisions of any kind (cards, letters with choices, new applicants) | 2 to 5 a day from day 8, mean |
| Open cards | never over 2 |
| People visible and awake (on the map, not away, not asleep) | at least 2 in 95% of samples |
| Gap between things starting on screen (bubble, arrival, moment) | 90th percentile at most 67 game minutes (20 real seconds at 1x) |
| Source mix | street cards at most 30% |
| Cards leave a mark | random policy: at least 60% of answered cards still show something 3 game days later (a live memory, a flag, a pending thread or promise, a tale in that week's recap) |
| Cards come back | decent policy: at least one thread or promise card fires each week from week two; at least 2 of each Sunday's tales come from cards |
| Ignoring hurts | an absent player (ignores every card) ends each week with lower average liking than the decent and ruthless policies, and with at least one `ignored` or `leftToIt` per card resolved by ignoring |
| Existing soaks | the twelve-week landlord soaks and the neighbours soak still pass |

---

## 7. Open questions for the owner

**Decided** (folded in above): the Skip to morning button replaces the quiet-night
speed-up (0.2); a card stays at least 10 real seconds (1.1); the building cat stays; the
clock runs three times faster with movement unchanged (0.1); nought to two drip cards a
day, never filler (1.2); ignoring is allowed and always worst, moments pass and asks sour
(1.6); the tray and `!` layout (1.1).

1. **Does a card ever pause?** This spec says no. A pause at 1x for anything costing over
   £100 is possible, but it's the start of time tricks.
2. **Requests into the drip.** Moving the pet, heating and paint asks out of the chat makes
   one place for decisions. But with nought to two cards a day, tenants ask far less than
   the one a day each they do now, and asks compete with the rest of the catalogue. Is
   that right, or should a tenant's ask (which comes from a real need: the cold, a pet)
   always get a place, outside the budget?
3. **Fewer decisions, more weight.** Two a day at most means some days have none from the
   drip. With letters and applicants that's still 2 to 5 decisions a day; is a quiet day
   with nothing to answer fine, or does it want a floor of one?
4. **The fake meter reader.** A con artist casing the building. Fine in tone, or too dark?
5. **Bill's bad turn** (card 20). Refusing his daughter a key can end with Bill on the
   floor till the postie finds him. Right tone, or too dark? A lighter version: stuck in
   the bath, and Sandra hears him.
6. **The starting cast.** This spec makes Flat 1 work from home. Alternatively add a third
   sitting tenant in one of the empty flats, but that takes away the first let.
7. **Night shifts.** Night workers are home in the day but asleep for much of it. Keep them
   at 5%, or drop them?
8. **Card money in week one.** Capped at £150 so the Monday squeeze holds. Too tight, too
   loose?
9. **Postie timing.** The badge waits for Sandra, but letters are made when they are now
   (some mid-afternoon). Make all letters wait for the next morning's round, at the cost of
   retuning the letter tests?
10. **More things that last.** The rule means more memories, flags and threads alive at
    once: a busier thoughts panel and a bigger save. This spec caps flags at 16 and threads
    at 3, and card memories mostly fade within ten days (promises and grudges longer).
    Enough, or should the thoughts panel group "about the landlord" lines?
11. **Precedents need saying.** The cat makes "no pets" cost double, a fiver off for one
    haggler brings the others. Players won't guess unless told. The notice and the thought
    label say so (1.4). Enough, or should precedents be listed somewhere?
12. **Next door.** Cards 4, 21 and 26 make next door a recurring neighbour with a mood
    (friendly or sore) that reaches planning. Do they want a face and a name?
13. **Neither button always right.** Tests can show the two choices differ; they can't show
    both are tempting. Proposal: log choice splits in playtests and rewrite any card where
    one button gets over 85% of answers.
14. **Asks that sour while you build.** The countdown keeps going in Build (decided), so a
    long building session can sour a waiting ask by a step or two. The dot on Done says so.
    Is that the right pressure, or should asks (not moments) hold their step while Build is
    open?
15. **The faster clock and the economy.** Rent, bills and the mortgage come three times as
    often in real time. Money will feel faster; does the weekly squeeze still give time to
    think at 3x (a week in about 17 real minutes)?
