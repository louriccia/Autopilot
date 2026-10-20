const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const garage = require('../swgr/garage.js')

// Only the classes with preview passes rendered (tools/preview/render_passes.py) can be customised; more than
// Discord's 25 choices once all three speeder classes are in, so the vehicle is picked by autocomplete. Someone's
// saved builds (the garage card's Save) come first, as "saved:<build key>"
const vehicles = () => data.vehicles.filter(v => garage.canCustomise(v.id))

module.exports = {
    data: new SlashCommandBuilder()
        .setName('customize')
        .setDescription('build a speeder from any parts and preview its livery, color and patina')
        .addStringOption(option =>
            option.setName('vehicle')
                .setDescription('the vehicle to start from, or one of your saved builds')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    async autocomplete(interaction) {
        const typed = interaction.options.getFocused().toLowerCase()
        const saved = garage.savesOf(interaction.user.id).map(key => ({ key, ...garage.describe(garage.decode(`${key}00`)) }))
            .filter(b => `${b.name} ${b.details}`.toLowerCase().includes(typed))
            .map(b => ({ name: `★ ${b.name} / ${b.details}`.slice(0, 100), value: `saved:${b.key}` }))
        const found = data.search(vehicles(), typed, v => `${v.name} (${v.class})`)
        await interaction.respond([...saved, ...found].slice(0, 25))
    },
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('vehicle')
        let state
        if (id.startsWith('saved:')) {
            try { state = garage.decode(`${id.slice(6)}00`) } catch { state = null }
        } else {
            const v = data.vehicle(id) ?? data.vehicles.find(x => x.name.toLowerCase() == id.toLowerCase())
            if (v && garage.canCustomise(v.id)) state = garage.startState(v.id)
        }
        if (!state) return interaction.reply({ content: 'Pick a speeder or a saved build from the list.', flags: MessageFlags.Ephemeral })
        await interaction.deferReply()
        await interaction.editReply(await garage.card(state))
    },
}
