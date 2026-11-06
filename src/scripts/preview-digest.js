// Post a weekly digest (src/digest.js) to the test channel (TEST_CHANNEL_ID), without pinning or marking it posted.
//   node src/scripts/preview-digest.js        last week
//   node src/scripts/preview-digest.js 2      two weeks ago (0: this week so far)
require('dotenv').config({ path: __dirname + '/../../.env' })
const { Client, GatewayIntentBits, Events } = require('discord.js')
const { test_channel } = require('../data/discord/channel.js')
const records = require('../records.js')
const credits = require('../credits.js')
const digest = require('../digest.js')

if (!test_channel) {
    console.error('Set TEST_CHANNEL_ID in .env first.')
    process.exit(1)
}
const weeksAgo = Number(process.argv[2] ?? 1)
const client = new Client({ intents: [GatewayIntentBits.Guilds] })
client.once(Events.ClientReady, async () => {
    try {
        records.listen()
        credits.listen()
        while (!records.loaded()) await new Promise(r => setTimeout(r, 200))
        await new Promise(r => setTimeout(r, 2000))  // the ledger and bounties
        const start = digest.weekOf(Date.now()) - weeksAgo * 7 * 24 * 60 * 60 * 1000
        const message = await digest.post(client, start, test_channel)
        console.log(message ? 'Posted the digest.' : 'Nothing was raced that week.')
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    }
    client.destroy()
    process.exit()
})
client.login(process.env.token)
