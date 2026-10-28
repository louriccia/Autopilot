const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { tourInfo } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tour')
        .setDescription("a multiplayer tour's leaderboard: times in its final race")
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the tour')
                .setRequired(true)
                .addChoices(...data.tours.map(t => ({ name: t.name, value: t.id })))
        ),
    async execute({ interaction } = {}) {
        await interaction.reply(tourInfo(interaction.options.getString('name')))
    },
}
