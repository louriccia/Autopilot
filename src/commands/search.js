const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { search, open } = require('../swgr/search.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('find anything: arcade events, tracks, planets...')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('what are you looking for?')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    async execute({ interaction } = {}) {
        const query = interaction.options.getString('query')
        const page = open(query)
        if (!page) return interaction.reply({ content: `Nothing matches "${query}".`, flags: MessageFlags.Ephemeral })
        await interaction.reply(page)
    },
    async autocomplete(interaction) {
        await interaction.respond(search(interaction.options.getFocused()))
    },
}
