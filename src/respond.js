const { MessageFlags } = require('discord.js')

// Answer a select/button on a public message: the person who ran the command navigates in place, anyone
// else gets their own private copy so they can browse without changing what everyone else is looking at.
exports.navigate = async function (interaction, payload) {
    const owner = interaction.message.interactionMetadata?.user?.id
    const ephemeral = interaction.message.flags.has(MessageFlags.Ephemeral)
    if (ephemeral || !owner || owner == interaction.user.id) {
        // `attachments: []` drops the previous page's images; `files` uploads this page's.
        await interaction.update({ ...payload, attachments: [] })
    } else {
        // Redraw the public message unchanged first: otherwise their Discord keeps showing the option they picked in
        // its menu, so the card looks like the page they chose while its buttons (Submit time) still act on the old
        // one. Then their page follows as a private message.
        await interaction.update({ components: interaction.message.components })
        await interaction.followUp({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral })
    }
}
