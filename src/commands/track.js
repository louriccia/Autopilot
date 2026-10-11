const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { trackInfo } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('track')
        .setDescription('look up a track: map, format, laps and arcade events')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the track to look up')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    async execute({ interaction } = {}) {
        const name = interaction.options.getString('name')
        const id = data.track(name) ? name : data.search(data.tracks, name)[0]?.value
        if (!id) return interaction.reply({ content: `No track matches "${name}".`, flags: MessageFlags.Ephemeral })
        await interaction.reply(trackInfo(id))
    },
    async autocomplete(interaction) {
        const query = interaction.options.getFocused()
        await interaction.respond(data.search(data.tracks, query, t => `${t.name} — ${data.planet(t.planet).name}`))
    },
}
