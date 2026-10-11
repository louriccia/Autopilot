const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { taleInfo, talesOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tale')
        .setDescription('look up a Tales of Podracing event: loadout, win conditions and rewards')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the tale to look up (leave empty to list them all)')
                .addChoices(...data.tales.map(t => ({ name: `${t.number}. ${t.name}`, value: t.id })))
        ),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('name')
        await interaction.reply(id ? taleInfo(id) : talesOverview())
    },
}
