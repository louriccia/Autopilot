// What each feed has already posted, kept across restarts: in the database at feeds/<name> when Firebase is
// configured (so a bot running elsewhere picks up where this one left off), otherwise in data/state/feeds.json
// (git-ignored). load() before the feeds start; save(name) after a feed's check.
const fs = require('node:fs')
const path = require('node:path')
const { database } = require('../firebase.js')

const FILE = path.join(__dirname, '../../data/state/feeds.json')
let all = {}
let useFile = !database

exports.load = async () => {
    let local = {}
    try { local = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { }
    // The database takes over from the local file; the first time, it starts from what the file had seen
    all = local
    if (useFile) return
    try {
        // A database that doesn't answer (not created yet, offline) shouldn't hold the feeds up forever
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('no answer in 10s')), 10000))
        all = (await Promise.race([database.ref('feeds').get(), timeout])).val() ?? local
    } catch (error) {
        console.log(`[feeds] database unavailable (${error.message}); using data/state/feeds.json`)
        useFile = true
    }
}

exports.get = name => (all[name] ??= {})

exports.save = async name => {
    if (!useFile) return database.ref(`feeds/${name}`).set(all[name] ?? null)
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n')
}
