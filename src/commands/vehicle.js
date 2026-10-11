const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { vehicleInfo, vehiclesOverview } = require('../swgr/pages.js')

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
        await interaction.reply(vehicleInfo(id))
    },
    async autocomplete(interaction) {
        await interaction.respond(data.search(data.vehicles, interaction.options.getFocused(), v => `${v.name} — ${v.class}`))
    },
}
