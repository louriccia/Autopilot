const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

// Shared with src/interactions/ping.js, so the refresh button redraws the same reply.
function pingMessage(client) {
    const embed = new EmbedBuilder()
        .setTitle('Autopilot engaged')
        .setColor('3B88C3')
        .addFields(
            { name: 'Gateway', value: `${Math.round(client.ws.ping)} ms`, inline: true },
            { name: 'Uptime', value: `<t:${Math.floor((Date.now() - client.uptime) / 1000)}:R>`, inline: true },
        )
        .setTimestamp()
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ping_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary)
    )
    return { embeds: [embed], components: [row] }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription("check that Autopilot is online and how fast it's responding"),
    pingMessage,
    async execute({ client, interaction } = {}) {
        await interaction.reply({ ...pingMessage(client), flags: MessageFlags.Ephemeral })
    }
}
