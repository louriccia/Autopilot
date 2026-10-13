const { MessageFlags } = require('discord.js')

// Answer a select/button on a card by redrawing it in place, for whoever used it: anyone can move any card along, and
// the page shows their view (their own time and rival, src/viewer.js). A message the bot posted on its own (a podium
// announcement's View board button) isn't a card, so the page opens as a private copy instead.
exports.navigate = async function (interaction, payload) {
    const card = interaction.message.interactionMetadata || interaction.message.flags.has(MessageFlags.Ephemeral)
    // `attachments: []` drops the previous page's images; `files` uploads this page's.
    if (card) return interaction.update({ ...payload, attachments: [] })
    await interaction.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral })
}
