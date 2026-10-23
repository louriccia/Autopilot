// What the achievement cards show beyond the game data: how many Steam players have each one (Steam's global
// percentages, keyless, refreshed every 6 hours; the cards read this in-memory copy so they stay synchronous), and,
// for the two Arcade ones, how many golds each racer here has from their saved times.
const data = require('./swgr/data.js')
const records = require('./records.js')

const APP = 4078430
const URL = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${APP}`
exports.REFRESH_EVERY = 6 * 60 * 60 * 1000

let percents = {}  // Steam api name ("Achievement01") -> percent of players

exports.load = async () => {
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`Steam achievement percentages: ${res.status}`)
    const list = (await res.json()).achievementpercentages?.achievements ?? []
    percents = Object.fromEntries(list.map(a => [a.name, Number(a.percent)]))
    return list.length
}

exports.percent = steamId => percents[steamId] ?? null

// Each racer's arcade golds (their best on an event at or under its gold time), most first. The game counts any of
// its 53 events, Deluxe included, towards "Beat 50 Gold times".
exports.GOLDS_FOR_ALL = 50
exports.golds = () => {
    const count = {}
    for (const e of data.events)
        for (const t of records.leaderboard('arcade', e.id))
            if (t.time <= e.medals.gold.seconds) count[t.user] = (count[t.user] ?? 0) + 1
    return Object.entries(count).map(([user, golds]) => ({ user, golds })).sort((a, b) => b.golds - a.golds)
}
