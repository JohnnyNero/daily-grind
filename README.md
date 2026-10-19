# Landlord (working title)

A side-on landlord sim for phones. You own one tired block of flats in a made-up British
city and keep it full, paid and just about bearable, while simulated tenants live their
small, noisy, ordinary lives inside it.

The design and the build plan are in the shared spec doc (two tabs: the spec, and the
implementation plan).

## Where it's up to

Milestones 1 to 3 of 6: **the building**, **one household**, and **money and tenants**.

Milestone 3, money and tenants:

- Money: rent comes in every morning; the mortgage (£250) and the building's bills go out
  every Monday. Miss four mortgage payments in a row and the bank takes the building; pay
  it off and it's yours. Building work and furniture cost money (furniture sells back cheap).
- Each flat's impressiveness tier sets its going rate; you set the rent. Rent against the
  going rate is a thought tenants have, and rises need a week's notice.
- Empty flats you list draw applicants: fewer if the rent's steep, only desperate ones if
  it hasn't got the basics. Each shows one trait and references hinting at the rest, and a
  likely liking. Pick one: they pay a deposit and move in on a six-week lease.
- Every tenant has two or three traits (17 of them), shown as they come out.
- Fed-up tenants act on it, picked by their traits: notes, formal complaints, holding back
  rent, haggling, giving notice, reporting you to the council. Happy ones pay early, send
  friends, fix things. Leases renew or end.
- The building comes with sitting tenants on old, cheap rolling tenancies.
- New menus, after the mockups: a tenant bar ringed by liking, alerts down the right, and
  Building, People, Money, Post and Build tabs along the bottom.

Milestone 2, one household:

- A couple live in Flat 1 from the start. Each has needs (sleep, food, a wash, the loo, fun,
  comfort) and meets them with the furniture you've put in: they cook and eat, shower, sleep
  in the bed, watch telly if there is one. Most go out to work on weekdays.
- What's missing has a cost: no bed means the sofa or the floor, no loo means popping to the
  pub, no kitchen means chips.
- Thoughts add up to how much they like living here, shown with every thought and its number.
- Each flat has an impressiveness score from space per person, furnishing, the basics, light
  and decoration; the weakest drags it down, and the flat panel says what to fix.

Milestone 1, the building:

- The building side on, 3 tiles per storey, on a 28-tile plot with the street either side.
- Build mode: mark out rooms, walls, inside doors, flat doors, windows, the street door,
  floors, stairs, and knocking things down. Furniture (27 pieces, floor and wall) placed,
  moved and turned round. Undo.
- Flats worked out from the walls and doors: everything behind a flat's front door is that
  flat; the lobby and stairs are shared.
- People walk along floors and up stairs, through doors they have keys to. Passers-by walk
  along the street; Denise from the letting agent calls round to look at every flat.
- Saving on the device and to a file.

The starting building has five flats: a one-bed on the ground floor, a studio and a one-bed
on each of the floors above, and the top one-bed stripped back to the brick.

## Run it

```sh
npm install
npm run dev        # serves on your network; open the printed address on your phone
```

| Command | What it does |
|---|---|
| `npm test` | Tests for this game, then the café game's |
| `npm run typecheck` | TypeScript checks |
| `npm run build` | Builds the site into `dist/`, with the café game in `dist/cafe/` |

Add `?seed=123` (or `?new`) to the URL to start a fresh building instead of the saved one.

## Play online

Every push to `main` is tested, built and deployed to GitHub Pages:
https://johnnynero.github.io/daily-grind/

## The café game

The earlier café sim is kept to one side in [`cafe/`](cafe/) while this is built. It still
builds and plays at https://johnnynero.github.io/daily-grind/cafe/, and `npm run dev:cafe`
runs it locally.
