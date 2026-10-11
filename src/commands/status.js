const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { statusInfo, statusesOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('look up a status effect: what it does and what applies it')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the status effect to look up (leave empty to list them all)')
                .addChoices(...data.statuses.map(s => ({ name: s.name, value: s.id })))
        ),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('name')
        await interaction.reply(id ? statusInfo(id) : statusesOverview())
    },
}
