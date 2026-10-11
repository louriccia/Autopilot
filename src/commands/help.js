const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription("get a list of Autopilot's commands"),
    async execute({ client, interaction } = {}) {
        // Built from the loaded commands, so a new file in src/commands/ shows up here without edits.
        const lines = [...client.commands.values()]
            .map(command => command.data.toJSON())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(command => `**/${command.name}** - ${command.description}`)

        const helpEmbed = new EmbedBuilder()
            .setTitle('Autopilot Commands')
            .setAuthor({ name: '/help' })
            .setColor('3B88C3')
            .setDescription(lines.join('\n'))

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true })
    }
}
