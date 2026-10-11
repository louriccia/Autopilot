const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { arcadeOverview, arcadeCategory, arcadeEvent } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('arcade')
        .setDescription('look up arcade events: medal times, track, vehicle and build')
        .addStringOption(option =>
            option.setName('event')
                .setDescription('the event to look up')
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option.setName('category')
                .setDescription('list the events in a category')
                .addChoices(...data.categories.map(c => ({ name: c.name, value: c.id })))
        ),
    async execute({ interaction } = {}) {
        const event = interaction.options.getString('event')
        const category = interaction.options.getString('category')
        if (event && !data.event(event)) {
            const match = data.search(data.events, event)[0]
            if (!match) return interaction.reply({ content: `No arcade event matches "${event}".`, flags: MessageFlags.Ephemeral })
            return interaction.reply(arcadeEvent(match.value))
        }
        if (event) return interaction.reply(arcadeEvent(event))
        if (category) return interaction.reply(arcadeCategory(category))
        return interaction.reply(arcadeOverview())
    },
    async autocomplete(interaction) {
        const query = interaction.options.getFocused()
        await interaction.respond(data.search(data.events, query, e => `${e.name} — ${data.track(e.track).name}`))
    },
}
