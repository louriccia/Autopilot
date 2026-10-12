// Post each feed's latest item to the test channel (TEST_CHANNEL_ID), to see the cards without waiting for news.
//   node src/scripts/preview-feeds.js
require('dotenv').config({ path: __dirname + '/../../.env' })
const { Client, GatewayIntentBits, Events } = require('discord.js')
const { test_channel } = require('../data/discord/channel.js')
const feeds = require('../feeds/index.js')

if (!test_channel) {
    console.error('Set TEST_CHANNEL_ID in .env first.')
    process.exit(1)
}
const client = new Client({ intents: [GatewayIntentBits.Guilds] })
client.once(Events.ClientReady, async () => {
    try {
        await feeds.preview(client, test_channel)
        console.log('Posted the previews.')
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    }
    client.destroy()
    process.exit()
})
client.login(process.env.token)
