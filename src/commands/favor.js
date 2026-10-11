const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { favorInfo, favorsOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('favor')
        .setDescription('look up a favor: its effect at each rank, who offers it and how to unlock it')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the favor to look up (leave empty to list them all)')
                .addChoices(...data.favors.map(f => ({ name: f.name, value: f.id })))
        ),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('name')
        await interaction.reply(id ? favorInfo(id) : favorsOverview())
    },
}
