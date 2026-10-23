const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const { achievementInfo, achievementsOverview } = require('../swgr/pages.js')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('achievement')
        .setDescription('look up an achievement: how to earn it and how many Steam players have it')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('the achievement to look up (leave empty to list them all)')
                .setAutocomplete(true)
        ),
    async execute({ interaction } = {}) {
        const name = interaction.options.getString('name')
        if (!name) return interaction.reply(achievementsOverview())
        const id = data.achievement(name) ? name : data.search(data.achievements, name, a => `${a.name} — ${a.description}`)[0]?.value
        if (!id) return interaction.reply({ content: `No achievement matches "${name}".`, flags: MessageFlags.Ephemeral })
        await interaction.reply(achievementInfo(id))
    },
    async autocomplete(interaction) {
        const query = interaction.options.getFocused()
        // hidden ones by name only, so the list doesn't give them away
        await interaction.respond(data.search(data.achievements, query, a => a.hidden ? a.name : `${a.name} — ${a.description}`))
    },
}
