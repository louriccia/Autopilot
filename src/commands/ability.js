const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { abilityInfo, abilitiesOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ability')
        .setDescription('look up an ability: effect, reload, energy, upgrades and its preflight check')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the ability to look up (leave empty to browse families)')
                .setAutocomplete(true)
        ),
    async execute({ interaction } = {}) {
        const name = interaction.options.getString('name')
        if (!name) return interaction.reply(abilitiesOverview())
        const id = data.ability(name) ? name : data.search(data.abilities, name)[0]?.value
        if (!id) return interaction.reply({ content: `No ability matches "${name}".`, flags: MessageFlags.Ephemeral })
        await interaction.reply(abilityInfo(id))
    },
    async autocomplete(interaction) {
        await interaction.respond(data.search(data.abilities, interaction.options.getFocused(), a => `${a.name} — Tier ${['', 'I', 'II', 'III'][a.tier] ?? '?'}`))
    },
}
