const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { scenarioInfo } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scenario')
        .setDescription('look up a scenario: racer style, starting build, schedule and track pools')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the scenario to look up')
                .setRequired(true)
                .addChoices(...data.scenarios.map(sc => ({ name: `${sc.name} (${sc.tier})`, value: sc.id })))
        ),
    async execute({ interaction } = {}) {
        await interaction.reply(scenarioInfo(interaction.options.getString('name')))
    },
}
