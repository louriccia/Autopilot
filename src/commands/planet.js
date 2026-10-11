const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { planetInfo } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('planet')
        .setDescription('look up a planet: description, conditions and tracks')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the planet to look up')
                .setRequired(true)
                .addChoices(...data.planets.map(p => ({ name: p.name, value: p.id })))
        ),
    async execute({ interaction } = {}) {
        await interaction.reply(planetInfo(interaction.options.getString('name')))
    },
}
