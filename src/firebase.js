// The bot's Firebase Realtime Database (project autopilot-swgr), through firebase-admin with the project's service
// account (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / FIREBASE_DATABASE_URL in .env).
// Without those, `database` is null and callers fall back to running without it.
//
// Layout (top-level paths):
//   feeds/<feed name>   what each announcement feed has already posted (src/feeds/state.js); feeds-testing/ for a testing copy
//   youtube/<channel id>   whose runs a YouTube channel's videos are (src/records.js, src/replays.js)
//   youtube-scan/channels/<channel id>, youtube-scan/videos/<video id>   linked channels' uploads scanned for runs (src/channels.js)
//   rivals/<discord id>   the racer someone declared their rival (/times rival, src/records.js)
//   gamertags/<discord id>/<key>   in-game names a racer was seen with on tour screenshots (src/records.js, src/replays.js)
//   streamers/<twitch user id>   recognized streamers { login, name, addedBy, addedAt } (/streamer, src/feeds/twitch.js)
//   times/<push id>     community times { kind, target, user, submittedBy, time, platform, proof, notes, date } (src/records.js)
//   feedback/<kind>/<target>/<discord id>   thumbs up / neutral / down on an arcade event or scenario (src/records.js)
//   submitters/<discord id>   may submit times for others (/submitter)
//   staff/<event id>/<name>   staff times (src/records.js); profiles/<discord id> { name, avatar } for the website (src/profiles.js)
//   credits/, balances/, backers/, bounties/, fills/   the credits economy (src/credits.js)
//   sweeps/<discord id>/<set id>   when a racer took 1st on every event of a cumulative board, for the permanent sweep
//                       roles (src/roles.js)
//   digest/last { week, message, channel }   the last weekly digest posted and pinned (src/digest.js); digest-testing/ for a testing copy
//   weekly/<week start ms>   Board of the Week: the featured event, the house's bounties, its announcement, prizes paid
//                       (src/weekly.js); weekly-testing/ for a testing copy
//   territory/ { started, holders, key, message, channel, rewards/<week start ms> }   the territory war's pinned map, who
//                       held each planet at the last sync, and the weekly rewards paid (src/territory.js); territory-testing/ while testing
//   garage/<discord id>/<build key>   saved garage builds, when each was saved (ms) (src/swgr/garage.js)
//   speedrun/users/<src user id>, speedrun/runs/<src run id>, speedrun/checked   speedrun.com accounts linked to Discord
//                       ids, runs already saved, and the last verification seen (src/speedrun.js)
// Access (database.rules.json, `firebase deploy --only database`): the bot's service account bypasses the rules; anyone
// may read times, staff, profiles, balances, credits, backers, bounties, feedback and rivals (for the community website,
// documented in DATABASE.md); nothing else is readable and nothing is writable from outside.
const { initializeApp, cert } = require('firebase-admin/app')
const { getDatabase } = require('firebase-admin/database')

const { FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PRIVATE_KEY: privateKey,
    FIREBASE_DATABASE_URL: databaseURL } = process.env

let database = null
if (projectId && clientEmail && privateKey && databaseURL) {
    const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }), databaseURL })
    database = getDatabase(app)
}

module.exports = { database }
