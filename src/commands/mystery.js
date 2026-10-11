const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { mysteryInfo, mysteriesOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mystery')
        .setDescription('look up a Mystery Encounter: its choices, their odds and what they lead to')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the encounter to look up (leave empty to list them all)')
                .addChoices(...data.mysteries.map(m => ({ name: m.title, value: m.id })))
        ),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('name')
        await interaction.reply(id ? mysteryInfo(id) : mysteriesOverview())
    },
}
