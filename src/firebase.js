// The bot's Firebase Realtime Database (project autopilot-swgr), through firebase-admin with the project's service
// account (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / FIREBASE_DATABASE_URL in .env).
// Without those, `database` is null and callers fall back to running without it.
//
// Layout (top-level paths):
//   feeds/<feed name>   what each announcement feed has already posted (src/feeds/state.js); feeds-testing/ for a testing copy
//   youtube/<channel id>   whose runs a YouTube channel's videos are (src/records.js, src/replays.js)
//   streamers/<twitch user id>   recognized streamers { login, name, addedBy, addedAt } (/streamer, src/feeds/twitch.js)
//   times/<push id>     community times { kind, target, user, submittedBy, time, platform, proof, notes, date } (src/records.js)
//   feedback/<kind>/<target>/<discord id>   thumbs up / neutral / down on an arcade event or scenario (src/records.js)
//   submitters/<discord id>   may submit times for others (/submitter)
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
