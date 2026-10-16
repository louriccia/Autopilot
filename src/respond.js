const { MessageFlags } = require('discord.js')

// Answer a select/button on a card by redrawing it in place, for whoever used it: anyone can move any card along, and
// the page shows their view (their own time and rival, src/viewer.js). Cards are Components V2 messages; a plain
// message with a button (a podium or bounty announcement's View board) isn't a card, so the page is posted as a
// public reply to it instead of replacing the announcement.
exports.navigate = async function (interaction, payload) {
    const card = interaction.message.flags.has(MessageFlags.IsComponentsV2)
    // `attachments: []` drops the previous page's images; `files` uploads this page's.
    if (card) return interaction.update({ ...payload, attachments: [] })
    await interaction.reply(payload)
}
