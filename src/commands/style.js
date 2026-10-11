const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { styleInfo } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('style')
        .setDescription('look up a racer style: abilities, traits per level and how to unlock them')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the racer style to look up')
                .setRequired(true)
                .addChoices(...data.styles.map(s => ({ name: s.name, value: s.id })))
        ),
    async execute({ interaction } = {}) {
        await interaction.reply(styleInfo(interaction.options.getString('name')))
    },
}
