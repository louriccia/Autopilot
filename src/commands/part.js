const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { partInfo } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('part')
        .setDescription('look up a part, or find parts by keyword: effect, rarity, cost, tiers and where it shows up')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the part to look up (leave empty to find parts by keyword)')
                .setAutocomplete(true)
        ),
    async execute({ interaction } = {}) {
        const name = interaction.options.getString('name')
        if (!name) return interaction.reply(partInfo(null))
        const id = data.part(name) ? name : data.search(data.parts, name, p => `${p.name} — ${p.description}`)[0]?.value
        if (!id) return interaction.reply({ content: `No part matches "${name}".`, flags: MessageFlags.Ephemeral })
        await interaction.reply(partInfo(id))
    },
    async autocomplete(interaction) {
        const query = interaction.options.getFocused()
        await interaction.respond(data.search(data.parts, query, p => `${p.name} — ${p.category} · ${p.rarity}`))
    },
}
