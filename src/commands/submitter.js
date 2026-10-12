const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { database } = require('../firebase.js')

// Who may submit times on other people's behalf (the "Racer" picker in the submit form). Server managers always
// can; this adds others, kept in the database at submitters/<discord id>. Server managers only.
const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })

module.exports = {
    data: new SlashCommandBuilder()
        .setName('submitter')
        .setDescription('manage who can submit times for other people')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('add').setDescription('let someone submit times for other people')
            .addUserOption(o => o.setName('user').setDescription('who').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('stop someone submitting times for other people')
            .addUserOption(o => o.setName('user').setDescription('who').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('who can submit times for other people')),
    async execute({ interaction, member_id } = {}) {
        if (!database) return reply(interaction, 'The database is not set up.')
        const sub = interaction.options.getSubcommand()
        const ref = database.ref('submitters')
        if (sub == 'list') {
            const ids = Object.keys((await ref.get()).val() ?? {})
            return reply(interaction, ids.length
                ? `**Can submit for others** (besides server managers)\n${ids.map(id => `<@${id}>`).join('\n')}`
                : 'Only server managers can submit for others. Add someone with `/submitter add`.')
        }
        const user = interaction.options.getUser('user')
        if (sub == 'remove') {
            await ref.child(user.id).remove()
            return reply(interaction, `<@${user.id}> can no longer submit times for other people.`)
        }
        if (user.bot) return reply(interaction, "Bots can't submit times.")
        await ref.child(user.id).set({ addedBy: member_id, addedAt: Date.now() })
        return reply(interaction, `<@${user.id}> can now submit times for other people (a "Racer" picker appears in their submit form).`)
    },
}
