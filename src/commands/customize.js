const { SlashCommandBuilder } = require('discord.js');
const data = require('../swgr/data.js')
const garage = require('../swgr/garage.js')

// Only the classes with preview passes rendered (tools/preview/render_passes.py) can be customised
const vehicles = data.vehicles.filter(v => garage.canCustomise(v.id))

module.exports = {
    data: new SlashCommandBuilder()
        .setName('customize')
        .setDescription('build a speeder from any parts and preview its livery, color and patina')
        .addStringOption(option =>
            option.setName('vehicle')
                .setDescription('the vehicle to start from')
                .setRequired(true)
                .addChoices(...vehicles.slice(0, 25).map(v => ({ name: `${v.name} (${v.class})`, value: v.id })))
        ),
    async execute({ interaction } = {}) {
        await interaction.deferReply()
        await interaction.editReply(await garage.card(garage.startState(interaction.options.getString('vehicle'))))
    },
}
