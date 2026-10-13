const { MessageFlags } = require('discord.js')
const records = require('../records.js')
const data = require('../swgr/data.js')
const pages = require('../swgr/pages.js')
const viewer = require('../viewer.js')
const { database } = require('../firebase.js')

// Feedback on an arcade event or scenario, like Botto's thumbs: rate_<kind>_<target>_<up|neutral|down>. Anyone can
// rate (no time needed); one rating per person, pressing it again takes it back. The card redraws with the counts.
const PAGE = { arcade: [data.event, pages.arcadeEvent], scenario: [data.scenario, pages.scenarioInfo] }

module.exports = {
    name: 'rate',
    async execute({ interaction, args, member_id } = {}) {
        const [kind, target, rating] = args
        const [item, page] = PAGE[kind] ?? []
        if (!item?.(target) || !['up', 'neutral', 'down'].includes(rating)) return interaction.reply({ content: "That event isn't around anymore.", flags: MessageFlags.Ephemeral })
        if (!database) return interaction.reply({ content: "Feedback can't be saved right now (no database).", flags: MessageFlags.Ephemeral })
        // A first rating of a board pays a few credits, once (src/credits.js)
        if (await records.rate(kind, target, member_id, rating)) await require('../credits.js').payRating(member_id, kind, target).catch(error => console.error('[credits]', error))
        await interaction.update({ ...viewer.run(interaction.user.id, () => page(target)), attachments: [] })
    },
}
