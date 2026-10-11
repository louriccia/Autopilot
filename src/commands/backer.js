const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { backerInfo, backersOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backer')
        .setDescription('look up a backer (sponsor): contracts, pay, penalty and favor')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the backer to look up (leave empty to list them all)')
                .addChoices(...data.sponsors.map(s => ({ name: s.name, value: s.id })))
        ),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('name')
        await interaction.reply(id ? backerInfo(id) : backersOverview())
    },
}
