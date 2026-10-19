// Proof links to files posted on Discord (screenshots and videos, src/replays.js) are signed and stop working about a
// day later ("This content is no longer available"), on the cards and for anyone reading the database. Discord re-signs
// them on request (POST /attachments/refresh-urls, 50 a call, expired ones too as long as the file still exists), so
// this renews every such proof that has expired or will within the next few hours: when the bot starts, then every
// REFRESH_EVERY (bot.js; the live bot only, since a testing copy shares the database).
const records = require('./records.js')

const REFRESH_EVERY = 6 * 60 * 60 * 1000
const AHEAD = 2 * REFRESH_EVERY  // renew links expiring before the next run but one, in case a run fails
const CDN = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//
// When a signed link expires (its ex= parameter, hex seconds); 0 for an unsigned one
const expiresAt = url => parseInt(url.match(/[?&]ex=([0-9a-f]+)/)?.[1] ?? '0', 16) * 1000

exports.REFRESH_EVERY = REFRESH_EVERY
exports.refresh = async client => {
    const due = records.allTimes().filter(t => CDN.test(t.proof ?? '') && expiresAt(t.proof) < Date.now() + AHEAD)
    let renewed = 0
    for (let i = 0; i < due.length; i += 50) {
        const batch = due.slice(i, i + 50)
        const { refreshed_urls: urls = [] } = await client.rest.post('/attachments/refresh-urls', { body: { attachment_urls: batch.map(t => t.proof) } })
        const fresh = new Map(urls.map(u => [u.original, u.refreshed]))
        for (const t of batch) {
            const url = fresh.get(t.proof)
            if (url && url != t.proof) { await records.updateTime(t.id, { proof: url }); renewed++ }
        }
    }
    return { due: due.length, renewed }
}
