const { SlashCommandBuilder } = require('discord.js')
const { creditsCard, creditsTop } = require('../swgr/pages.js')
const { racerOf } = require('./timesheet.js')

// /credits balance [racer]: balance, backer and recent earnings; /credits top: the richest racers and the backer
// standings (src/credits.js)
module.exports = {
    data: new SlashCommandBuilder()
        .setName('credits')
        .setDescription('credits: earned for progress on the boards, spent on bounties')
        .addSubcommand(sub => sub.setName('balance').setDescription("a racer's credits and recent earnings")
            .addUserOption(o => o.setName('racer').setDescription('whose credits (default: yours)')))
        .addSubcommand(sub => sub.setName('top').setDescription('the richest racers, and the backer standings')),
    async execute({ interaction, member_id } = {}) {
        if (interaction.options.getSubcommand() == 'top') return interaction.reply(creditsTop())
        const racer = await racerOf(interaction, interaction.options.getUser('racer')?.id ?? member_id)
        await interaction.reply(creditsCard(racer))
    },
}
