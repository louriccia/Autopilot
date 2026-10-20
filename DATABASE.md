# Reading Autopilot's data

Autopilot keeps its community leaderboards in a Firebase Realtime Database. The sections below can be read by anyone,
with no key or sign-in, so a website can show the same times, credits and bounties as the Discord bot. Nothing can be
written from outside: only the bot changes the data.

Database URL: `https://autopilot-swgr-default-rtdb.firebaseio.com`

## Getting the data

Either the REST API (any language, add `.json` to a path):

```
GET https://autopilot-swgr-default-rtdb.firebaseio.com/times.json
GET https://autopilot-swgr-default-rtdb.firebaseio.com/profiles.json
GET https://autopilot-swgr-default-rtdb.firebaseio.com/times.json?orderBy="target"&equalTo="landspeeder-ace"
```

or the Firebase JS SDK (`firebase/database`) with `databaseURL` set to the URL above, which can also stream changes as
the bot saves them (`onValue`). `times` is indexed on `user`, `target` and `kind` for `orderBy` / `equalTo` queries.
The whole database is a few hundred KB, so fetching a section and filtering client-side is fine too.

Please cache rather than polling every few seconds: the times change when someone saves a run, not continuously.

## Conventions

- People are keyed by **Discord user id** (a string of digits), never by name. `profiles/<id>` has the name to show.
- **Boards**: `kind` is `arcade` (an arcade event) or `scenario`; `target` is the event or scenario id, a slug of its
  in-game name (`landspeeder-ace`, `the-giants-graveyard`). Event names, medal times, tracks and so on are game data
  and aren't in this database.
- **Times** are in seconds (`70.13` is 1:10.13). The game shows hundredths: format to 2 decimals.
- **Dates** are milliseconds since the Unix epoch.
- A leaderboard shows each racer's **best** time on a board; `times` holds every saved run, so group by `user` and
  take the minimum. Ties go to the earlier `date`.

## Sections

### `times/<id>`: every saved run
| field | |
|---|---|
| `kind`, `target` | the board (see above) |
| `user` | whose run it is |
| `submittedBy` | who saved it (a submitter can save runs for others; the bot itself for posted runs) |
| `time` | seconds |
| `date` | when the run happened, as far as known (a video's upload time, else when it was posted or saved) |
| `platform` | `PC`, `PS5`, `Xbox`, or blank |
| `proof` | a link: YouTube, a Discord post, or a Discord file (screenshot or video). Discord signs file links for about a day; the bot renews them every 6 hours, so read the current value rather than caching it for long. Blank if none |
| `notes` | free text, often blank |
| `youtube` | the proof video's YouTube channel id, when it has one |
| `src`, `srcUser` | the speedrun.com run id and runner id, for a run verified there (`https://www.speedrun.com/Star_Wars_Galactic_Racer/runs/<src>`); absent otherwise |

### `staff/<event id>/<key>`: the developer's and publisher's own times
`{ name, seconds, from: "developer" | "publisher", user? }`. Shown apart from community times (Fuse Games is the
developer, Secret Mode the publisher). `user` is their Discord id when they're on the server.

### `profiles/<discord id>`: names and avatars
`{ name, avatar, updated }`: the racer's display name on the server (else their Discord name) and avatar URL, for
everyone with a time, a balance or a staff time. Refreshed hourly.

### `balances/<discord id>`: credits
The racer's current credits balance (a number). Credits are earned by saving runs (personal bests, medals, passing
people, podiums, world records) and spent on bounties.

### `credits/<discord id>/<id>`: the credits ledger
Every change to a balance: `{ amount, reason, ref, lines?, backer?, proof?, board?, date }`. `reason` is `run`,
`board filled`, `rated a board`, `removed`, `bounty posted`, `bounty added to`, `bounty won` or `bounty expired`;
`lines` itemises a run's payout (`[{ label, amount, kind }]`); `board` is `<kind>:<target>` when it's about one.

### `backers/<discord id>`
`{ backer: "hutt" | "broker" | "pirate", since }`: the onboarding faction the racer backs, which changes what they earn.

### `bounties/<id>`
`{ kind, target, under, pot, funders: { <id>: amount }, postedBy, postedAt, expires, status }`: credits put up for
the first proven run under `under` seconds on a board. `status` is `open`, `won` (then `winner`, `time`, `timeId`,
`wonAt`) or `expired`. `kind: "aggregate"` bounties are on a cumulative board: `target` `main` (all 50 main arcade
events summed) or an arcade category id.

### `feedback/<kind>/<target>/<discord id>`
`{ rating: "up" | "neutral" | "down", date }`: thumbs on a board.

### `rivals/<discord id>`
`{ rival, setAt }`: the racer they've declared as their rival.
