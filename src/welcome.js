// Join messages, like Botto's: a random line from the game's dialogue greeting the new member, posted to
// WELCOME_CHANNEL_ID (TEST_CHANNEL_ID while testing) without a notification ping. The channel must be in the server
// they joined. Needs the Server Members intent (GuildMembers), enabled in the Developer Portal.
const { MessageFlags } = require('discord.js')
const { testing } = require('../config.js')
const { welcome_channel, test_channel } = require('./data/discord/channel.js')
const lines = require('./data/flavor/welcome.js')
const emoji = require('./data/discord/emoji.js')
const data = require('./swgr/data.js')

exports.welcomeMessage = (member, pick = lines[Math.floor(Math.random() * lines.length)]) => ({
    // One line: the speaker's headshot, then what they say
    content: `${emoji.named(data.characterEmoji(pick.speaker))} *${pick.line.replaceAll('{user}', `<@${member.id}>`)}*`.trim(),
    flags: MessageFlags.SuppressNotifications,
    allowedMentions: { users: [member.id] },
})

exports.welcome = async function (member) {
    const channelId = testing ? test_channel : welcome_channel
    if (!channelId) return
    const channel = await member.client.channels.fetch(channelId)
    if (channel?.guildId != member.guild.id) return
    await channel.send(exports.welcomeMessage(member))
}
