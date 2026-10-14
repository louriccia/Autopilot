// New game builds on Steam: the public branch's build id, read the way SteamDB does (Steam's product info, with an
// anonymous login). A new build id means a patch went out, announced or not. The main content depot's manifest
// and size give a rough sense of how big it was.
const SteamUser = require('steam-user')
const { card, when } = require('./card.js')

const APP = 4078430    // STAR WARS: Galactic Racer™
const DEPOT = '4078431' // the game's content

let steam
function login() {
    if (steam) return steam.ready
    steam = new SteamUser()  // re-logs in on its own after a disconnect
    steam.ready = new Promise((resolve, reject) => {
        steam.once('loggedOn', resolve)
        steam.once('error', reject)
    })
    steam.on('error', () => { steam = null })  // the next check logs in again
    steam.logOn({ anonymous: true })
    return steam.ready
}

const gb = bytes => `${(bytes / 1024 ** 3).toFixed(1)} GB`

module.exports = {
    name: 'steam-build',
    channel: 'patches',
    every: 5 * 60 * 1000,
    async check(seen, { preview = false } = {}) {
        await login()
        let apps
        try {
            ({ apps } = await steam.getProductInfo([APP], [], true))
        } catch (error) {
            // A session can go stale without an error (every request then times out), so a failed request drops it
            // and the next check logs in afresh
            try { steam?.logOff() } catch { }
            steam = null
            throw error
        }
        const depots = apps[APP].appinfo.depots
        const build = depots.branches.public
        const manifest = depots[DEPOT]?.manifests?.public ?? {}
        const now = { build: build.buildid, updated: Number(build.timeupdated), manifest: manifest.gid, download: Number(manifest.download) }
        const before = { ...seen }
        if (!preview && now.build == seen.build) return []
        Object.assign(seen, now)

        const sizeChange = before.download && now.download != before.download
            ? ` (${now.download > before.download ? '+' : '−'}${gb(Math.abs(now.download - before.download))})` : ''
        return [card({
            source: 'Steam / new build',
            title: 'STAR WARS: Galactic Racer™ was updated',
            lines: [
                `Build **${now.build}**${before.build && before.build != now.build ? ` (was ${before.build})` : ''} went live ${when(now.updated, 'R')}, ${when(now.updated)}`,
                now.download && `-# Download ${gb(now.download)}${sizeChange}`,
                '-# Patch notes, if there are any, will follow from the official Steam news.',
            ],
            links: [
                ['Build history (SteamDB)', `https://steamdb.info/depot/${DEPOT}/history/`],
                ['Steam news', `https://store.steampowered.com/news/app/${APP}`],
            ],
            color: 0x1b2838,
        })]
    },
}
