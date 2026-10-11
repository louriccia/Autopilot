const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { liveriesOverview, paletteInfo, patternInfo } = require('../swgr/pages.js')

// Palettes and patterns share one name option; values are "palette:<id>" / "pattern:<id>"
const items = () => [
    ...data.palettes.map(p => ({ name: `${p.name} — Palette · ${p.group}`, value: `palette:${p.id}`, match: p.name })),
    ...data.patterns.map(p => ({ name: `${p.name} — Pattern · ${p.class}`, value: `pattern:${p.id}`, match: `${p.name} ${p.class}` })),
]

module.exports = {
    data: new SlashCommandBuilder()
        .setName('livery')
        .setDescription('look up a livery palette or pattern: colours, render, cost and unlock')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the palette or pattern to look up (leave empty to browse)')
                .setAutocomplete(true)
        ),
    async execute({ interaction } = {}) {
        const name = interaction.options.getString('name')
        if (!name) return interaction.reply(liveriesOverview())
        const q = name.toLowerCase()
        const hit = items().find(i => i.value == name) ?? items().find(i => i.match.toLowerCase().includes(q))
        if (!hit) return interaction.reply({ content: `No palette or pattern matches "${name}".`, flags: MessageFlags.Ephemeral })
        const [kind, id] = hit.value.split(':')
        await interaction.reply(kind == 'palette' ? paletteInfo(id) : patternInfo(id))
    },
    async autocomplete(interaction) {
        const q = interaction.options.getFocused().toLowerCase()
        await interaction.respond(items().filter(i => i.match.toLowerCase().includes(q)).slice(0, 25).map(({ name, value }) => ({ name, value })))
    },
}
