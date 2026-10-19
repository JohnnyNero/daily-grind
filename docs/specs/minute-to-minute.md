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

Two things, both measured by the soak tests in section 6.

> **At 1x, in waking hours (07:00 to 23:00), the player has something new to decide at least
> every two real minutes, and there's always something worth watching on screen.**

In numbers, at 1x (1 real minute = 67 game minutes):

| Measure | Target |
| --- | --- |
| Gap between new decisions, waking hours | mean 60 to 100 game minutes (about 1 to 1.5 real minutes); 90th percentile at most 135 (2 real minutes) |
| Open drip cards at once | never more than 2 |
| Decisions a game day | 10 to 16 |
| People visible and awake (on the map, not away, not asleep), waking hours | at least 2 in 95% of sampled minutes |
| Something new starting on screen (a bubble, an arrival, a moment) | at least every 22 game minutes (20 real seconds), 90th percentile |
| First week, days 1 to 7 | at least 8 decisions every day, a beat every 1 to 2 game hours |

The feel: an ant farm with opinions. You can put the phone down and watch, and every minute
or so someone wants a quick word.

Rules this spec keeps to:

- **No time tricks.** The player sets the pace with the speed buttons. Nothing here skips or
  speeds up time by itself. (See open question 1 on quiet nights.)
- **Stories over spreadsheets.** Cards come from the building as it is, and some of them grow
  into stories.
- **Few people who matter.** Recurring named visitors, not crowds.
- **Show a little, let them read a lot.** Two lines and two buttons. Icons over words.
- **Landlord, not puppeteer.** You answer. You don't steer people round.
- **Nice or ruthless.** Every card has a cheap way and a kind way, and neither is always right.

---

## 1. The drip

A steady stream of small, quick, two-choice decisions. One every minute or so of real time.

### 1.1 The card

```
┌─────────────────────────────────────────────┐
│ [face] Dave · Flat 1                    ◔   │
│ Parcel for Dave. He's at work.              │
│ ┌ Take it in ────┐  ┌ Leave it in the lobby ┐│
│ │ He'll be glad  │  │ Might walk            ││
│ └────────────────┘  └───────────────────────┘│
└─────────────────────────────────────────────┘
```

- Sits above the tenant bar, under the building. About 76px tall. One card shown; a small
  "+1" if a second is waiting.
- **Face or icon:** whoever or whatever it's about. Tap it and the camera pans there.
- **One or two short lines.** At most 90 characters. Dry. Names, not roles.
- **Two buttons.** A label of one to four words, and a note under it in the style of the
  existing chat `note` ("They'll remember", "£80", "Might walk"). Notes hint; they never
  show liking numbers.
- **The clock** (the ring, top right) drains. When it's out, the card is ignored (1.6).
- **A marker on the map.** The existing red `!` bubble over the person, or over the place
  (the leaking ceiling, the van, the cat). That's where the eye goes.
- **It doesn't pause the game.** It's small enough not to need to.
- Answering posts a one-line notice (`sim.notify`) and, where others would see it, a line
  in the chat ("Landlord took Dave's parcel in.").

How long a card waits, in game minutes:

| Kind | Lifetime | At 1x |
| --- | --- | --- |
| Someone at the door, waiting (a courier, a van, an applicant) | 45 | 40 s |
| Most cards | 90 | 80 s |
| A tenant asking (the old chat requests) | 180 | 160 s |
| A follow-up you promised something on | 240 | 3.5 min |

### 1.2 Cadence

The drip is a clock in `state.drip`, checked every 10 game minutes. Game time only, so a
seed plays the same at any speed (see open question 3).

1. **The gap.** After a card appears, the next try is drawn from `DRIP.gap` = [50, 110] game
   minutes (mean 80: about 72 real seconds).
2. **Waking hours only,** 07:00 to 23:00. At night only cards marked *night* can come (a
   lockout, a knock about noise, the fox in the bins), at `DRIP.nightChance` 0.15 an hour.
3. **Never stacking.** If 2 cards are open (`DRIP.maxOpen`), the try is skipped and comes
   back in 15 minutes. Nothing queues up behind them except promised follow-ups.
4. **Fewer when busy.** The gap is multiplied by `DRIP.busy` 1.8 when a happening is
   running (a party, a fight, a burglary), or when 3 or more other decisions are waiting
   (chat asks, letters with choices, applicants).
5. **Fewer when you're away.** Three ignored cards in a row and the gap is multiplied by
   `DRIP.away` 3, until you answer one. Nobody comes back from making tea to a pile of
   penalties.
6. **Drought guard.** If nothing to decide has appeared for `DRIP.drought` 120 game minutes
   (counting applicants, chat asks and letters too), the next try must produce a card. If no
   card's conditions are met, it draws from the small pool (cards marked *small*, which are
   nearly always possible and cheap either way).
7. **No repeats.** Each card has its own cooldown in days. Nobody is the subject of a card
   more than once in 3 game hours (`DRIP.perPerson`). The same card is never open twice.
8. **Promised follow-ups** (threads, 1.5) skip the gap when due, but still respect `maxOpen`.
9. **First week:** the handover's scripted cards go first when due (section 3).

### 1.3 Where cards come from

Every card has a `when` that reads the real state, and a weight that grows with how true it
is (a leak's weight goes with the shower's wear). Selection is weighted, with `rng.ts`.

| Source | What it reads | Share of cards (target) |
| --- | --- | --- |
| **Tenants** | traits, needs, liking, who likes whom, partners, jobs, who's in or out | about 45% |
| **The building** | wear and broken things, dirt, bins (`binsOverflowing`), temperature, noise averages, empty flats, listings | about 30% |
| **The street** | visitors at the door, vans, the cat, next door, kids | at most 25% |

A street card still needs a reason to be here: someone out for the parcel, something worn
for the dodgy builder, the bins for the fly-tipper. Pure filler lives only in the *small*
pool, and only the drought guard draws on it.

### 1.4 The catalogue

T tenant, B building, S street. *Night* cards can come at night; *small* ones are in the
drought pool. Costs are against a start of £1,500 and £250 a week to the bank.

| # | Card | When | A | B | Ignored | Can lead to |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Applicant at the door** (S) "Priya's on the step about Flat 2. She's brought a cake." | A listed empty flat, an applicant waiting for it | *Show her round*: one more of her traits shows; she goes top of the list | *Not today*: she goes, off the list | She waits, then goes; stays on the list | |
| 2 | **Parcel for someone out** (S) "Parcel for Dave. He's at work." | A courier, and a tenant away | *Take it in*: Dave remembers `tookParcel` | *Leave it in the lobby*: 1 in 4 it walks (1 in 10 with locks): `parcelNicked`, a tale | Card through the door: `missedParcel` | Busybodies ask what was in it (#22) |
| 3 | **Man in a van** (S) "Bloke in a van says he'll do the cooker in Flat 1 for £40 cash. Today." | Something worn past 0.7 or broken; money over £200 | *Go on*: £40, mended; 30% it breaks again in 3 days | *No thanks*: nothing | He drives off | Thread: "He's not answering his phone." Then he turns up offering to fix his fix |
| 4 | **Cat on the stairs** (S) "A ginger cat has walked in and sat on the stairs like it pays rent." | Daytime, street door used lately, no building cat | *Let it stay*: it's the building cat (2.2); pet owners and friendly tenants `buildingCat` | *Shoo it out*: pet owners `shooedCat` | It stays till dusk and comes back; third time it's yours | It picks a favourite; kittens (#26) |
| 5 | **Drip through the ceiling** (B) "Water's coming through Flat 2's ceiling. It's Bill's shower." | Bathroom furniture worn past 0.8 with a flat below | *Plumber*: £80, mended; both flats `landlordListened` | *Bucket and a towel*: free; drips again in 2 days, the third time it's broken | As the bucket, and below `ignored` | Below remembers `leakedOnMe` about above: rows |
| 6 | **A word in the lobby** (T) "Raj caught you by the bins. Wants £5 off, 'for the boiler'." | A haggler, mid-lease, liking under 60 | *Fine, £5 off*: `agreedHaggle` | *Not a chance*: `refusedHaggle` | As not a chance, plus `ignored` | Gossip: others haggle |
| 7 | **Noise complaint** (T) "Bev, Flat 2: 'Flat 4's music. Every night. Every. Night.'" | A tenant kept awake lately, a noisy neighbour | *Have a word*: as chat's `word` act | *Not my business*: `landlordShrugged` | `ignored` | Bev and Flat 4 fall out |
| 8 | **Locked out** (T, night) "Jo's locked out. It's raining. She's sat on the step." | A tenant coming home; likelier if clumsy, or late from the pub | *Let her in*: `helpedLockout` | *Here's a locksmith's number*: she pays £70; `landlordShrugged` | She sits on the step (you can see her) till someone comes; if a neighbour lets her in, a `favour` between them | A friendship |
| 9 | **The bins** (B) "The bins are overflowing. A fox has opinions." | `binsOverflowing` | *Extra collection*: £25, lobby dirt down | *Wait for Thursday*: lobby dirt up; foxes at night | As waiting | A fox moment; council notice if it goes on |
| 10 | **Meter reader** (S) "Man from the gas wants to read the meter. He has a lanyard." | Fortnightly | *Let him in*: next gas bill right; if there are no locks, 1 in 6 he wasn't from the gas: burglary risk up for 3 nights | *Not without an appointment*: next gas bill estimated, £10 up | As not | A burglary, told later as a tale |
| 11 | **Can I borrow your drill?** (T) "Gareth wants to put a shelf up. Can he borrow your drill?" | A handy tenant at home | *Lend it*: `landlordListened`; a free shelf in his flat; 1 in 10 he finds a pipe (#5 for below) | *Rather not*: `landlordShrugged` | He does it anyway (handy, as the trait says) | A leak |
| 12 | **Someone's not on the lease** (T) "Mags says there's a man living in Flat 3 who isn't on the lease." | A busybody; a tenant with a partner who stays over | *Knock and ask*: if it's a partner, they `nosyLandlord`; if a lodger, a follow-up to add him (+rent) | *Let it go*: Mags `landlordShrugged` | Let it go | Lodger thread; couple moves in together |
| 13 | **Sofa on the pavement** (S, small) "Someone's left a decent sofa outside. 'Free to good home.'" | Daytime; a flat or the lobby short on seats | *Bring it in*: a cheap, worn sofa; 15% fleas: that flat `itchy` | *Leave it*: a passer-by carries it off by teatime (you see it go) | As leave it | Fleas: a moan in the chat |
| 14 | **Ball against the front** (S, small) "Kids are kicking a ball against the front. Thud. Thud." | 15:30 to 18:00, school days | *Ask them to move on*: they go; 1 in 5 they come back cheeky | *Let them play*: ground floor gets daytime noise; friendly tenants like it | They play till tea | A window (#25) |
| 15 | **Mum's visiting** (T) "Ellie's mum is here and would like a word with 'the landlord'." | A tenant's family visit (2.2), weekends | *Pop up and say hello*: if the flat's Plain or better, Ellie `mumApproved`; if not, `mumNoticed` | *Make your excuses*: nothing | Nothing | |
| 16 | **Shouting next door** (T, night) "Shouting from Flat 4. Something just hit the wall." | A couple with opinion of each other under 0 | *Knock and check*: it stops; both `toldOff`, neighbours `landlordListened` | *Stay out of it*: neighbours kept awake | As stay out | A break-up, sooner |
| 17 | **A month up front** (T) "Dave'll pay a month up front if you fix his cooker this week." | A pays-early tenant, something broken in their flat | *Deal*: four weeks' rent now; a promise (1.5) | *No ta*: nothing | Nothing | Broken promise: `brokePromise` |
| 18 | **The boiler's knocking** (B) "The boiler's started knocking. Like something wants out." | Boiler on, autumn or winter | *Service it*: £60; no breakdown for 3 weeks | *Hit it with a spanner*: 60% fine; 40% it's off for a day on the next cold night | 50/50 within a week | The heating card in the chat, sooner |
| 19 | **Chirping** (B, small) "Something in Flat 2 is chirping every 40 seconds. Smoke alarm." | A flat with a smoke alarm, nobody's done it for 3 weeks | *Pop round with a battery*: £2, `landlordListened` | *They can do it*: `landlordShrugged`; knows-their-rights `itsYourJob` | They take the battery out; the council will find it | A council issue |
| 20 | **Landing light's gone** (B, small) "The light on the second-floor landing's gone." | Nobody's done it for 2 weeks | *Change it*: £3 | *Leave it*: `darkStairs`; burglary risk up a touch; clumsy tenants trip | Leave it | A trip on the stairs (a moment) |
| 21 | **Scaffolding** (S) "Next door's builders want to scaffold against your wall for a fortnight. They'll pay £80." | Day 4 on, once a season | *Take the money*: £80; the side flats get daytime noise and less light (`scaffolding`); burglary risk up | *No*: nothing | No | A burglary; council |
| 22 | **What was in the parcel?** (T, small) "Mags asks if you know what was in Dave's parcel. 'Only it rattled.'" | A busybody, a parcel taken in today | *No idea*: nothing | *Tell her it rattled*: Mags likes you; Dave hears (gossip) `landlordGossiped` | No idea | Mags and Dave fall out |
| 23 | **Post for Mr Pritchard** (S) "More post for Mr Pritchard. One looks like a cheque." | Days 2 to 30 | *Send it on*: nothing; later a thank-you that tells you a sitting tenant's hidden trait | *Open it*: £40; 1 in 3 a stiff letter from his solicitor | Into the drawer | Pritchard thread |
| 24 | **Fly-tipped mattress** (S) "Someone's left a mattress by your bins." | Once a fortnight, likelier with bins overflowing | *Council'll take it*: £30 | *Leave it*: lobby dirt up; kids bounce on it (a moment); council issue if still there in 3 days | Leave it | Council |
| 25 | **A window's gone** (B) "Ground-floor window in Flat 1's cracked. A ball, apparently." | After #14 went cheeky, or a burglary try | *Glazier*: £60 | *Tape it*: £0; Flat 1 colder, `tapedWindow` | Tape | Colder flat: the heating card |
| 26 | **Kittens** (T) "The cat's had kittens in Bill's laundry basket. Bill would like one." | The building cat, 3 weeks on | *Let Bill keep one*: Bill gets a pet; all pet owners like you | *Find them homes*: Bill `sadAboutKitten` | Bill keeps one anyway | Bill's pet; a pet request from others |
| 27 | **Can I get a pet?** (T) moved from `requestsHour` | As now | *Yes*: as now | *No pets*: as now | `ignored`, as now | The pet appears (2.2) |
| 28 | **Is the heating on?** (T) moved from `requestsHour` | As now | *Turn it up*: as now | *Try a jumper*: as now | As now | |
| 29 | **Can I paint?** (T) moved from `requestsHour` | As now | *Go for it* | *Magnolia stays* | As now | |
| 30 | **Wrong pizza** (S, small, night) "A pizza for Flat 5. There's nobody in Flat 5." | Evening, an empty flat | *Give it to Bill*: Bill `freePizza` | *Have it yourself*: "Hawaiian. Serves you right." | It goes cold on the step; the cat has it | |

Notes on the catalogue:

- **The three old chat requests (27 to 29) move into the drip,** so there's one place
  decisions arrive. The chat stays the building's voice: tenants still post, and your
  answer still appears there for everyone to see, which keeps the public-answer rule.
- **Letters stay for slow, formal things** with deadlines in days (rent at renewal, the
  council, Denise's advance). Cards are minutes; letters are days.
- **Applicants keep their panel.** Card 1 is an extra, in-person way to meet one.
- New memories (in `MEMORIES`): `tookParcel`, `missedParcel`, `parcelNicked`,
  `buildingCat`, `shooedCat`, `leakedOnMe` (social), `helpedLockout`, `nosyLandlord`,
  `itchy`, `mumApproved`, `mumNoticed`, `brokePromise`, `keptPromise`, `itsYourJob`,
  `darkStairs`, `scaffolding`, `landlordGossiped`, `tapedWindow`, `sadAboutKitten`,
  `freePizza`. Sizes in the range of the existing ones: small (1 to 4) for most, 6 to 8 for
  `brokePromise` and `helpedLockout`. Those that others would hear about get `gossip: true`.
- New tale kinds: `parcelNicked`, `lockout`, `cowboy`, `leak`, `cat`, `kittens`,
  `brokePromise`, `pritchard`. Interest low (1 to 2) except `cat` and `kittens`, which
  people talk about for weeks.

### 1.5 How cards turn into stories

Each choice is a short list of effects, written as text like the chat and post `act`
strings so they save:

| Effect | Example | What it does |
| --- | --- | --- |
| `mem` | `mem:42:tookParcel` | a memory for a tenant (reuses `remember`) |
| `soc` | `soc:42:leakedOnMe:17` | a memory about another tenant (reuses `rememberAbout`), so opinions move |
| `pay` | `pay:-8000:Plumber` | money in or out (reuses `book`) |
| `mend` / `wear` | `wear:31:0.9` | mend something or set its wear (reuses upkeep) |
| `tale` | `tale:cowboy:42` | writes it down for the Sunday recap (reuses `tale`) |
| `chat` | `chat:Landlord took Dave's parcel in.` | a line in the chat |
| `thread` | `thread:cowboyBack:72` | a follow-up card, due in that many game hours |
| `promise` | `promise:mend:31:7` | something you said you'd do by a day; kept or broken is a memory |
| `risk` | `risk:burglary:3` | a storyteller weight raised for some days (reuses its weights) |
| `act` | `act:word:flat-3` | any existing chat or post act, so nothing's written twice |

**Threads** are how a card grows. A thread is a follow-up card with its own `when`, due at
a time, that keeps the original's people and things. The cowboy builder, the cat, the
lodger, Pritchard's post and the leak each run two or three cards over a week or so. At
most 3 threads live at once (`DRIP.maxThreads`).

**Promises** are threads you owe. "Fix his cooker this week" is checked against the real
cooker on the day. Kept: `keptPromise`. Broken: `brokePromise`, and a moan in the chat.

### 1.6 Ignoring a card

Letting the clock run out is an answer. It's never an error.

- **The world decides.** Every card has an *ignored* outcome that's what would happen with
  no landlord about: the courier leaves a card, the cat stays, the van drives off.
- **Tenants notice.** Only cards where a tenant asked you something give `ignored` (the
  existing memory, -3). Street and building cards don't.
- **Ignoring is mild.** No ignored outcome costs more than £30 or more than one memory. The
  worst are slow: a leak left alone gets worse over days, which is a story, not a fine.
- **Away mode.** Three ignored in a row slows the drip (1.2, rule 5).
- Ignored cards don't vanish silently: the notice says what happened ("The courier left a
  card for Dave.").

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
| Family | weekends | a mum, a brother; sit down for tea | Card 15 |
| Partners who stay over | couples in different flats, or with someone outside | arrive late, leave early | Card 12 |
| **Lorraine who does the stairs** | 08:00 daily, if you pay the cleaner | mops the stairs and lobby you can see go clean | The cleaner, made visible |
| Window cleaner | monthly, if you take him on | ladder out the front | A drip offer |
| Meter reader | fortnightly | Card 10 | |
| Tradespeople | when something's mended | walk up with a toolbox, a few minutes' banging | Mending, made visible |
| Council officer | inspections (already happen) | clipboard, walks round | The council, made visible |
| Applicants viewing | with Denise | follow her round the empty flat | Applicants, made visible |
| Kids from the street | 15:30 to 18:00, school days | on the pavement with a ball | Card 14 |
| Dog walkers, prams, joggers | the existing passers-by, given variety | walk past; dogs stop at the step | |
| **The building cat** | once you let it stay (card 4) | sleeps on the stairs, on doormats, in the sun; visits its favourite | Cards 4, 26 |
| Pets | once you say yes to one | a cat at a window, a dog walked twice a day | Card 27, `life.pet` |
| A fox | nights, bins full | knocks a bin over | Card 9 |

### 2.3 Ambient moments

Little scenes that cost the player nothing. Each needs one or two people and a place, runs
1 to 10 game minutes, shows a bubble or a pose, and may leave a social memory. A few seed a
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
| 24 | Trip on the dark landing | card 20 left alone, clumsy | `darkStairs`, a tale if twice |

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
| Ambient moments running | 2 | one starts every 15 to 30 game minutes in waking hours |
| Visitors on the map | 3 | not counting party guests and applicants with Denise |
| Passers-by | 3 | as now, but capped |
| Open cards | 2 | one shown, "+1" for the other |
| Props per person | 1 | |

---

## 3. The first week

The drip starts on day 1, straight after Denise's walk. The storyteller's big events still
wait for day 8 (or the list done), as now. The handover adds a script of cards that go
first when due; if one can't happen (you've already let the flat, say), it's skipped and
the ordinary drip fills in.

Day 1 is a Monday; the game starts at 08:00.

| Day | Time | Beat |
| --- | --- | --- |
| **1 Mon** | 08:00 | Denise's walk (as now) |
| | 09:00 | Flat 1's tenant at the table on a laptop; Bill off for the paper. Sandra the postie brings Pritchard's notes and Denise's list |
| | 09:30 | Card 1: the cheeky applicant (she exists already) is on the step, in person |
| | 10:30 | Bill's back. Card: "Bill's struggling up the stairs with his shopping." *Carry it up* (`landlordListened`) / *He'll manage* (nothing) |
| | 12:00 | Card 2: a parcel for Bill, who's out at the shops |
| | 13:30 | Card 13: a sofa on the pavement (the bare flat needs furnishing: a cheap start) |
| | 15:00 | Denise brings an applicant round Flat 2 (visible). A window cleaner's card: *£15 a month* / *No ta* |
| | 16:00 | Kids on the pavement; card 14 |
| | 18:00 | Moment: Bill and Flat 1 meet by the post. First opinions form where you can see them |
| | 20:00 | Card 30, the wrong pizza: a laugh to end on |
| **2 Tue** | 08:00 | Lorraine's card: "A cleaner's put a card through: £30 a week for the stairs." *Take her on* / *Not yet* |
| | 10:00 to 18:00 | Bill asks about the heating (the existing beat, now card 28) |
| | 11:00 | Furniture you bought arrives with a delivery man, carried up |
| | afternoon | If Flat 2's let: the move-in, with boxes and the box moment (17) |
| | 15:00 | Card 23: post for Mr Pritchard |
| | 19:00 | Card: the new tenant "asks where the bins go". *Show them* (they meet Bill on the way) / *Point* |
| **3 Wed** | 10:00 | **The first crisis: the leak.** Bill's shower (set worn at the start) drips into Flat 2 below. Card 5. Water drips; a bucket appears if you choose it. If Flat 2 is let, its tenant gets `leakedOnMe` about Bill: their first grudge, or not |
| | 14:00 | If the bucket: Bill, embarrassed, at Flat 2's door (a moment) |
| | 17:00 | Card 3: the man in a van, timed after the leak |
| **4 Thu** | morning | If the bucket: the leak's back (thread). Card 10, the meter reader |
| | afternoon | The new tenant's first trait-driven card (a drill, a haggle, a noise moan: whatever their traits give) |
| | evening | Card 21: scaffolding next door, £80 (money's tight: a real choice) |
| **5 Fri** | 09:00 | Denise's advance letter, if you're short (as now) |
| | evening | Takeaway Friday; friends visit Flat 2. Card: "Flat 2's having a few people round. All right?" *Fine* / *Keep it down* (a small visit, not the storyteller's party) |
| | 23:30 | Card 8, the lockout (night) |
| **6 Sat** | daytime | Bill's family visit. Card 15. Kids. A busy street |
| | evening | Card 16 or 7, whichever the noise gives |
| **7 Sun** | morning | Card 4: the cat. A long story starts on a quiet day |
| | evening | The Sunday recap (as now), now full of small things. The "Short for Monday" alert if it applies |
| **8 Mon** | 09:00 | The mortgage. The storyteller wakes. Week two goes on as now (the stripped-flat idea on day 9) |

Rules for the script:

- Every beat respects `maxOpen`. The drip's own cards fill the gaps.
- Each beat checks its condition when due, so it's never wrong about the building.
- Skipping the handover from the menu skips the script, not the drip.
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
| **Storyteller** (`events.ts`) | Untouched as a dealer. Cards are not happenings and don't count to `CAP`. The drip slows while a happening runs. A card can raise a storyteller weight for a few days (`risk`), but never starts a big event itself. `FIRST_DAY` stays 8 |
| **Chat** (`chat.ts`, `social.ts`) | Requests (`requestsHour`) become drip cards 27 to 29. Answers still post in the chat, seen by all. `chatMorning`'s two-day expiry goes for drip requests; their clock is the card's |
| **Post** (`post.ts`) | Unchanged. Letters stay for slow, formal things. The badge lights when Sandra's been (UI) |
| **Tales** (`tales.ts`) | New kinds (1.4). Cards write tales through the `tale` effect |
| **Memories and opinions** (`thoughts.ts`, `social.ts`) | New memory ids in `MEMORIES`; `soc` effects use `rememberAbout` |
| **Upkeep** (`upkeep.ts`) | Cards read wear and broken; `mend` and `wear` effects call it. Mending sends a tradesperson |
| **Handover** (`handover.ts`) | Gains the first-week script. Bill's shower starts worn |
| **Applicants** (`leases.ts`) | Card 1 shows one more trait; schedules replace `working` in `makePerson` |
| **Tenants** (`tenants.ts`) | `wakeAt`, `bedtime` and the work check read the schedule. A habit or moment is tried before `potter` |
| **Pawns** (`pawns.ts`) | `spawn` asks `visitors.ts` too; `think` hands visitors to it; the passer-by cap |
| **Pace** (`pace.ts`) | Untouched, pending open question 1. `quietNight` must count visitors and open cards as "something happening" |
| **Tuning** (`tuning.ts`) | New blocks: `DRIP`, `SCHEDULES`, `HABITS`, `VISITORS`, `MOMENTS`, `BUDGET`; new `MEMORIES` and `INTEREST` entries |

### 5.2 New state

Save version 9 goes to 10. Old saves get an empty drip, a schedule from their job (job:
office; none: retired), no habits until morning, no visitors.

```ts
State.drip: {
  open: Card[];                 // at most DRIP.maxOpen
  next: number;                 // tick of the next try
  lastDecision: number;         // tick anything decidable last appeared (for the drought guard)
  ignoredRun: number;           // ignored in a row
  cooldowns: Record<string, number>;   // by card id, and by "pawn:<id>"
  threads: { card: string; due: number; data: Record<string, string | number> }[];
  promises: { what: string; arg: string; byDay: number; pawn: number }[];
  log: { tick: number; card: string; chose: number | 'ignored' }[];   // last 50, for tests and the recap
  income: number;               // first-week money from cards
}
Card: { id: number; def: string; tick: number; until: number; pawn?: number; flat?: string;
        furniture?: number; visitor?: number; data?: Record<string, string | number> }
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
| `src/sim/drip.ts` | The clock, cadence, selection, ignoring, effects, threads, promises |
| `src/sim/cards/tenant.ts`, `building.ts`, `street.ts`, `firstWeek.ts` | The catalogue, one file per source so agents don't collide |
| `src/sim/schedules.ts` | Schedules and habits |
| `src/sim/visitors.ts` | Visitor spawning and thinking, the cat, pets, the fox |
| `src/sim/moments.ts` | Ambient moments |
| `src/sim/project.ts` | The next project |
| `src/ui/cards.ts` | The card tray |
| `src/ui/project.ts` | The project bar |

---

## 6. Build order

Chunk 0 goes first and alone, so the parallel chunks touch different files. After that,
chunks 1 to 7 run in parallel, each in its own worktree and branch. Chunk 8 is last. The
coordinating session merges with the full suite passing (`npx vitest run`,
`npx tsc --noEmit -p .`, `npm run build`).

| Chunk | Model | Touches | Depends on |
| --- | --- | --- | --- |
| **0. Scaffold** | sonnet | `state.ts`, `save.ts` (v10), `start.ts`, `sim.ts` (calls to stubs), `pawns.ts` (dispatch to `visitors.ts`), `tenants.ts` (one hook before `potter`), `tuning.ts` (every new block, memory and tale kind, stubbed), all new files as stubs, `index.html` and `style.css` mount points, `test/policy.ts` answers cards | none |
| **1. Drip engine and tray** | opus | `drip.ts`, `ui/cards.ts`, `hud.ts` (badge and alert hooks only), `style.css` (card rules, appended) | 0 |
| **2a. Tenant cards** | sonnet | `cards/tenant.ts`, `social.ts` (drop requests from `requestsHour`) | 0 (writes against the card interface from 0) |
| **2b. Building cards** | sonnet | `cards/building.ts` | 0 |
| **2c. Street cards** | sonnet | `cards/street.ts` | 0 |
| **3. Schedules and habits** | opus | `schedules.ts`, `tenants.ts` (wake, bed, work), `leases.ts` (`makePerson`), `start.ts` (Flat 1 works from home, Bill's routine) | 0 |
| **4. Visitors** | sonnet | `visitors.ts`, `pawns.ts` (spawn caps) | 0 |
| **5. Moments** | sonnet | `moments.ts` | 0, reads schedules through the stub |
| **6. Readable on a phone** | sonnet | `render/renderer.ts`, `render/art.ts` (icons, poses, props, markers, bubble budget) | 0 |
| **7. First week and project** | sonnet | `cards/firstWeek.ts`, `handover.ts`, `project.ts`, `ui/project.ts` | 0 |
| **8. Pacing pass** | opus | `tuning.ts` numbers only, `test/pace.soak.test.ts` | all |

To keep merges clean: only chunk 0 edits `state.ts`, `save.ts` and `sim.ts`. Chunks change
numbers inside their own `tuning.ts` block and nowhere else in it. `start.ts` is chunk 3's
after chunk 0, except Bill's shower wear, which chunk 0 sets.

### Acceptance tests

Each chunk brings its own tests. Seeded, deterministic; slow ones are soak tests.

| Chunk | Test |
| --- | --- |
| 0 | An old v9 save loads with an empty drip and schedules from jobs. A fresh game runs 3 days with the stubs and plays the same as before (a seed's ledger unchanged) |
| 1 | Never more than 2 open cards over 14 days. An ignored card applies its outcome at `until`. Three ignored in a row stretch the gap. The drought guard fires after 120 quiet game minutes. A promise checks the real thing on its day. Same seed, same cards |
| 2a to 2c | For every card: its `when` is false on a building where it can't be true, true on one built for it; both choices and the ignore apply their effects; no ignored outcome costs over £30. Requests no longer appear from `requestsHour` |
| 3 | Over 14 days with 5 flats let by the decent policy: weekdays 10:00 to 16:00, at least 40% of tenants home and awake on average. Night-shift tenants sleep in the day. Needs stay in the same bands as before (no one hungrier or dirtier) |
| 4 | Visitors on the map never over 3, passers-by never over 3. Sandra comes every morning. The cleaner appears only if paid. Mending brings a tradesperson |
| 5 | Never more than 2 moments at once. A moment starts at least every 30 game minutes in waking hours with 3 or more tenants in |
| 6 | Bubble budget: never more than 4 drawn. A bubble set for one game minute is shown 1.5 real seconds at 3x. (Renderer unit test on a fake clock) |
| 7 | Days 1 to 7: the leak card on day 3 when Bill's in; at least 8 decisions a day; the storyteller starts nothing before day 8; first-week card income at most £150. The project bar names the bare flat on day 1 |
| 8 | **The pacing soak** (below) |

**The pacing soak** (`test/pace.soak.test.ts`), seeds 1, 2 and 4, decent and ruthless
policies, 21 days, sampled every game minute from 07:00 to 23:00:

| Measure | Pass |
| --- | --- |
| Gap between new decisions (cards, chat asks, letters with choices, new applicants) | mean 60 to 100 game minutes; 90th percentile at most 135 |
| Decisions per real minute at 1x (decisions ÷ (waking game minutes × 0.9 ÷ 60)) | between 0.5 and 1.0 |
| Open cards | never over 2 |
| Decisions a day | 10 to 16 on every day; at least 8 on days 1 to 7 |
| People visible and awake (on the map, not away, not asleep) | at least 2 in 95% of samples |
| Gap between things starting on screen (bubble, arrival, moment) | 90th percentile at most 22 game minutes |
| Source mix | street cards at most 30% |
| An absent player (ignores every card) | still solvent on day 14 with the decent policy's rents; total liking lost to ignored cards under 15 a tenant a week |
| Existing soaks | the twelve-week landlord soaks and the neighbours soak still pass |

---

## 7. Open questions for the owner

1. **Quiet nights.** `pace.ts` runs quiet nights four times faster on its own
   (`NIGHT_BOOST`). That's time manipulation, which decision 2 rules out. Options: drop it;
   or keep it as a setting, off by default; or a "Skip to morning" button shown on quiet
   nights, so the player chooses. Recommendation: the button. If it stays automatic,
   `quietNight` must also count visitors, the cat and open cards.
2. **Does a card ever pause?** This spec says no. A pause at 1x for anything costing over
   £100 is possible, but it's the start of time tricks.
3. **Speed and the drip.** Cadence is in game time (it has to be, for determinism). At 3x
   cards come three times as fast in real time. That seems right (the player chose 3x), but
   at 3x a 45-minute card lasts 13 real seconds. Should the tray hold a card for at least
   10 real seconds before it can expire? That would be UI-side and break nothing.
4. **Build mode.** The game runs while you build. Cards will expire while you're drawing
   walls. Hide the tray in Build and accept it, or hold the clock UI-side as in 3?
5. **Requests into the drip.** Moving the pet, heating and paint asks out of the chat makes
   one place for decisions. The chat keeps the posts and the public answers. Happy?
6. **How many is too many?** The target is 10 to 16 decisions a game day. With 5 flats let
   and a storyteller busy spell, is that tiring? The busy rule halves it, roughly.
7. **The cat.** First non-human resident. It needs art and a little AI. Worth it?
8. **The fake meter reader.** A con artist casing the building. Fine in tone, or too dark?
9. **The starting cast.** This spec makes Flat 1 work from home. Alternatively add a third
   sitting tenant in one of the empty flats, but that takes away the first let.
10. **Night shifts.** Night workers are home in the day but asleep for much of it. Keep them
    at 5%, or drop them?
11. **Card money in week one.** Capped at £150 so the Monday squeeze holds. Too tight, too
    loose?
12. **Postie timing.** The badge waits for Sandra, but letters are made when they are now
    (some mid-afternoon). Make all letters wait for the next morning's round, at the cost of
    retuning the letter tests?
