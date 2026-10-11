const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { rivalInfo, rivalsOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rival')
        .setDescription('look up a rival: bio, vehicles, Head-to-Head races and what beating them unlocks')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the rival to look up (leave empty to list them all)')
                .addChoices(...data.rivals.map(r => ({ name: r.name, value: r.id })))
        ),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('name')
        await interaction.reply(id ? rivalInfo(id) : rivalsOverview())
    },
}
