const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { characterInfo, charactersOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('character')
        .setDescription('look up a character: their multiplayer style and build, speeders, favor and rival')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the character to look up (leave empty to list them all)')
                .addChoices(...data.racers.map(r => ({ name: r.name, value: r.id })))
        ),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('name')
        await interaction.reply(id ? characterInfo(id) : charactersOverview())
    },
}
