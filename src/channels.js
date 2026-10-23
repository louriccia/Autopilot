// YouTube channels linked to racers (youtube/, src/replays.js and /times youtube) are scanned for runs nobody posted:
// every upload whose title names one arcade event and a plausible time (replays.matchTitle, as for a posted link) is
// saved through src/submit.js for the channel's owner, the video as proof, dated by its upload. A repeat of a time
// already saved only fills in what's new (a video over a screenshot), as usual.
// Uses the YouTube Data API (YOUTUBE_API_KEY): a channel's uploads playlist, 50 videos a quota unit. Until a scan has
// gone through all of a channel's uploads without a failure, it reads them all and announces nothing (a backfill);
// later scans read only the newest page and announce podiums like any other save. Live bot only (a testing copy shares the database).
//
// Database:
//   youtube-scan/channels/<channel id>   { checked: newest upload seen (ms), backfilled, at }
//   youtube-scan/videos/<video id>       { time (our times/ id) | null, at }: videos already saved, so a removed time
//                                        stays removed
const { database } = require('./firebase.js')
const records = require('./records.js')

exports.SCAN_EVERY = 60 * 60 * 1000
const BACKFILL_PAGES = 20  // 1,000 uploads

async function uploads(channelId, { all }) {
    const out = []
    let page = ''
    for (let i = 0; i < (all ? BACKFILL_PAGES : 1); i++) {
        // A channel's uploads playlist is its id with UC -> UU
        const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=UU${channelId.slice(2)}&key=${process.env.YOUTUBE_API_KEY}${page ? `&pageToken=${page}` : ''}`)
        const body = await res.json()
        if (!res.ok) throw new Error(`YouTube API for ${channelId}: ${body.error?.message ?? res.status}`)
        out.push(...body.items.map(({ snippet: v }) => ({ id: v.resourceId.videoId, title: v.title, uploaded: Date.parse(v.publishedAt) })))
        if (!(page = body.nextPageToken)) break
    }
    return out
}

// One channel: returns how many runs were saved
async function scan(channelId, link, guild) {
    const state = (await database.ref(`youtube-scan/channels/${channelId}`).get()).val()
    const found = (await uploads(channelId, { all: !state?.backfilled })).filter(v => v.uploaded > (state?.checked ?? 0)).sort((a, b) => a.uploaded - b.uploaded)
    const { matchTitle } = require('./replays.js')
    const { submit, formatTime } = require('./submit.js')
    const member = await guild?.members.fetch(link.user).catch(() => null)
    let saved = 0, failed = null
    for (const v of found) {
        const match = matchTitle(v.title)
        if (!match) continue
        const done = database.ref(`youtube-scan/videos/${v.id}`)
        if ((await done.get()).exists()) continue
        try {
            const r = await submit({
                kind: 'arcade', target: match.event.id, member: member ?? { id: link.user, client: guild?.client, guild }, memberId: link.user,
                racer: { id: link.user, bot: false }, trusted: true, time: formatTime(match.seconds), proof: `https://youtu.be/${v.id}`,
                proofType: 'video', date: v.uploaded, youtube: channelId, announce: !!state?.backfilled,
            })
            if (r.error) throw new Error(r.error)
            const proof = `https://youtu.be/${v.id}`
            await done.set({ time: records.allTimes().find(t => t.proof == proof)?.id ?? null, at: Date.now() })
            if (!r.duplicate) saved++
            console.log(`[channels] ${link.name ?? channelId}: "${v.title}" -> ${r.message}`)
        } catch (error) {
            console.error(`[channels] ${link.name ?? channelId}: "${v.title}"`, error.message)
            failed ??= v.uploaded  // tried again next time
        }
    }
    const checked = failed ? failed - 1 : Math.max(state?.checked ?? 0, ...found.map(v => v.uploaded))
    await database.ref(`youtube-scan/channels/${channelId}`).set({ checked, backfilled: !!state?.backfilled || !failed, at: Date.now() })
    return saved
}

// Every linked channel, one after another; returns how many runs were saved
exports.scan = async guild => {
    if (!database || !process.env.YOUTUBE_API_KEY) return 0
    let saved = 0
    for (const [channelId, link] of Object.entries(records.youtubeLinks())) {
        if (!link?.user) continue
        saved += await scan(channelId, link, guild).catch(error => (console.error('[channels]', error.message), 0))
    }
    return saved
}
