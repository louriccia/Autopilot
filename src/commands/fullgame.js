const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const { fullGameInfo } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fullgame')
        .setDescription('full-game speedrun leaderboards (real time): Any%, Sebulba%, NG+, Arcade%')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('the speedrun.com category')
                .setRequired(true)
                .addChoices(...data.fullGame.map(c => ({ name: c.name, value: c.id })))
        ),
    async execute({ interaction } = {}) {
        await interaction.reply(fullGameInfo(interaction.options.getString('category')))
    },
}
