const { SlashCommandBuilder } = require('discord.js')
const { arcadeOverview } = require('../swgr/pages.js')

// A racer as a timesheet shows them: their server name and avatar where we can get them, else their account's
async function racerOf(interaction, id) {
    const member = await interaction.guild?.members.fetch(id).catch(() => null)
    const user = member?.user ?? await interaction.client.users.fetch(id).catch(() => null)
    return {
        id,
        name: member?.displayName ?? user?.displayName ?? 'Unknown racer',
        avatar: (member ?? user)?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
    }
}

module.exports = {
    racerOf,
    data: new SlashCommandBuilder()
        .setName('timesheet')
        .setDescription("a racer's arcade profile: progress, medals, placements, rival")
        .addUserOption(o => o.setName('racer').setDescription('whose timesheet (default: yours)')),
    async execute({ interaction, member_id } = {}) {
        const racer = await racerOf(interaction, interaction.options.getUser('racer')?.id ?? member_id)
        await interaction.reply(arcadeOverview(racer))
    },
}
