const { SlashCommandBuilder } = require('discord.js')
const territory = require('../territory.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('territory')
        .setDescription('the territory war: which faction holds each planet'),
    async execute({ interaction } = {}) {
        await interaction.reply(territory.card())
    },
}
