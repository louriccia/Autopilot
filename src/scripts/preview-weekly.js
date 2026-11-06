// Post previews of the weekly features to the test channel (TEST_CHANNEL_ID): nothing is saved, paid or scheduled.
//   node src/scripts/preview-weekly.js          everything: digest, Board of the Week (this week's pick and last week's
//                                               results), the house's bounties, the territory map and the week's flips
//   node src/scripts/preview-weekly.js --dry    print the text instead of posting
require('dotenv').config({ path: __dirname + '/../../.env' })
const { Client, GatewayIntentBits, Events } = require('discord.js')
const { test_channel } = require('../data/discord/channel.js')
const records = require('../records.js')
const credits = require('../credits.js')
const digest = require('../digest.js')
const weekly = require('../weekly.js')
const territory = require('../territory.js')
const pages = require('../swgr/pages.js')

const WEEK = 7 * 24 * 60 * 60 * 1000
const dry = process.argv.includes('--dry')

async function messages() {
    const thisWeek = digest.weekOf(Date.now()), lastWeek = thisWeek - WEEK
    const out = []
    out.push(['Weekly digest', digest.card(digest.summarize(lastWeek))])
    const featured = weekly.pick(thisWeek), bounties = weekly.houseBounties(thisWeek, featured)
    out.push(['Board of the Week: announcement', weekly.announcement(thisWeek, featured, bounties)])
    for (const b of bounties.filter(b => b.target != featured.event.id)) out.push(['House bounty (cold case)', pages.bountyPosted({ ...b, postedBy: 'house' })])
    out.push(["Board of the Week: last week's results", weekly.results(lastWeek, weekly.pick(lastWeek).event.id)])
    const now = territory.control(), weekAgo = territory.control(Date.now() - WEEK)
    out.push(['Territory map', territory.card(now)])
    const flips = territory.flips(weekAgo, now)
    out.push(['Territory flips this week', { content: flips.length ? flips.map(territory.flipText).join('\n') : 'No planet changed hands this week.', allowedMentions: { parse: [] } }])
    return out
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
client.once(Events.ClientReady, async () => {
    try {
        records.listen()
        credits.listen()
        while (!records.loaded()) await new Promise(r => setTimeout(r, 200))
        await new Promise(r => setTimeout(r, 3000))  // the ledger, backers and bounties
        const channel = !dry && await client.channels.fetch(test_channel)
        for (const [label, m] of await messages()) {
            if (!m) { console.log(`${label}: nothing`); continue }
            if (dry) {
                const text = m.content ?? JSON.stringify(m.components.map(c => c.toJSON())).match(/"content":"((?:[^"\\]|\\.)*)"/g).map(s => JSON.parse(s.slice(10))).join('\n')
                console.log(`=== ${label}\n${text.replace(/<a?:(\w+):\d+>/g, ':$1:')}\n`)
                continue
            }
            await channel.send({ content: `-# Preview: ${label}`, allowedMentions: { parse: [] } })
            await channel.send(m)
        }
        if (!dry) console.log('Posted the previews.')
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    }
    client.destroy()
    process.exit()
})
if (!test_channel) { console.error('Set TEST_CHANNEL_ID in .env first.'); process.exit(1) }
client.login(process.env.token)
