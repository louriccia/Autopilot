// Outside feeds the bot watches and announces: Steam builds and announcements, YouTube uploads, Twitch streams.
// Each feed is { name, every (ms), channel (key in feedChannels), enabled?() (has its credentials), check(state) -> [payload] }: check() compares what it finds
// with what it has already seen (its slice of the saved state) and returns a message for each new thing.
//
// The first time a feed runs it only records what's there, so a fresh install doesn't repost old news.
// While testing, everything goes to TEST_CHANNEL_ID instead of the real channels.
const { testing } = require('../../config.js')
const { feedChannels, test_channel } = require('../data/discord/channel.js')
const state = require('./state.js')

const FEEDS = [require('./steam-build.js'), require('./steam-news.js'), require('./youtube.js'), require('./twitch.js')]

async function post(client, channelId, payload) {
    const channel = await client.channels.fetch(channelId)
    await channel.send(payload)
}

async function run(client, feed, report) {
    const channelId = testing ? test_channel : feedChannels[feed.channel]
    if (!channelId) return
    const seen = state.get(feed.name)
    try {
        const messages = await feed.check(seen)
        if (seen.primed) {
            for (const payload of messages) await post(client, channelId, payload)
        } else {
            seen.primed = true
            console.log(`[feeds] ${feed.name}: primed (${messages.length} existing item(s) not posted)`)
        }
        await state.save(feed.name)
        if (feed.failures >= REPORT_AFTER) console.log(`[feeds] ${feed.name}: working again after ${feed.failures} failed checks`)
        feed.failures = 0
    } catch (error) {
        // A feed's source failing once (a timeout, a 500) usually fixes itself by the next check, so only a run of
        // failures is reported to the log channel, once per run; every failure still goes to the console
        feed.failures = (feed.failures ?? 0) + 1
        if (feed.failures == REPORT_AFTER) report(`Feed: ${feed.name} (failing ${REPORT_AFTER} checks in a row)`, error)
        else console.error(`[feeds] ${feed.name} failed (${feed.failures} in a row):`, error.message)
    }
}
const REPORT_AFTER = 3

exports.start = async function (client, report) {
    await state.load()
    for (const feed of FEEDS) {
        const channelId = testing ? test_channel : feedChannels[feed.channel]
        if (feed.enabled && !feed.enabled()) {
            console.log(`[feeds] ${feed.name}: missing its credentials in .env, not running`)
            continue
        }
        if (!channelId) {
            console.log(`[feeds] ${feed.name}: no channel set (${testing ? 'TEST_CHANNEL_ID' : feed.channel}), not running`)
            continue
        }
        run(client, feed, report)
        setInterval(() => run(client, feed, report), feed.every)
    }
}

// For trying the cards out: post each feed's latest item to a channel, ignoring what's been seen
exports.preview = async function (client, channelId) {
    for (const feed of FEEDS.filter(f => !f.enabled || f.enabled())) {
        const messages = await feed.check({}, { preview: true })
        for (const payload of messages.slice(0, 1)) await post(client, channelId, payload)
    }
}
