const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { vehicleInfo, vehiclesOverview } = require('../swgr/pages.js')
const garage = require('../swgr/garage.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vehicle')
        .setDescription('look up a vehicle or vehicle class: manufacturer, cost, unlock, parts and who races it')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the vehicle to look up (leave empty to browse classes)')
                .setAutocomplete(true)
        ),
    async execute({ interaction } = {}) {
        const name = interaction.options.getString('name')
        if (!name) return interaction.reply(vehiclesOverview())
        const id = data.vehicle(name) ? name : data.search(data.vehicles, name)[0]?.value
        if (!id) return interaction.reply({ content: `No vehicle matches "${name}".`, flags: MessageFlags.Ephemeral })
        // a speeder in the garage (its stock model stands in for the vehicle card), a podracer on its card
        if (garage.canCustomise(id)) return garage.respond(interaction, garage.startState(id))
        await interaction.reply(vehicleInfo(id))
    },
    async autocomplete(interaction) {
        await interaction.respond(data.search(data.vehicles, interaction.options.getFocused(), v => `${v.name} — ${v.class}`))
    },
}
