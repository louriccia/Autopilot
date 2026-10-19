const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const garage = require('../swgr/garage.js')

// Only the classes with preview passes rendered (tools/preview/render_passes.py) can be customised; more than
// Discord's 25 choices once all three speeder classes are in, so the vehicle is picked by autocomplete
const vehicles = () => data.vehicles.filter(v => garage.canCustomise(v.id))

module.exports = {
    data: new SlashCommandBuilder()
        .setName('customize')
        .setDescription('build a speeder from any parts and preview its livery, color and patina')
        .addStringOption(option =>
            option.setName('vehicle')
                .setDescription('the vehicle to start from')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    async autocomplete(interaction) {
        await interaction.respond(data.search(vehicles(), interaction.options.getFocused(), v => `${v.name} (${v.class})`))
    },
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('vehicle')
        const v = data.vehicle(id) ?? data.vehicles.find(x => x.name.toLowerCase() == id.toLowerCase())
        if (!v || !garage.canCustomise(v.id)) {
            return interaction.reply({ content: 'Pick a speeder from the list.', flags: MessageFlags.Ephemeral })
        }
        await interaction.deferReply()
        await interaction.editReply(await garage.card(garage.startState(v.id)))
    },
}
