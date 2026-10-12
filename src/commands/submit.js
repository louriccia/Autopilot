const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const data = require('../swgr/data.js')
const records = require('../records.js')
const { submit } = require('../submit.js')

// The quick way to save a time: pick the arcade event or scenario (autocomplete), type the time, done. Server managers
// and /submitter people can name a racer to submit for someone else. An exact repeat isn't saved twice.
const boards = () => [
    ...data.events.map(e => ({ value: `arcade:${e.id}`, name: `${e.name} (Arcade)` })),
    ...data.scenarios.map(sc => ({ value: `scenario:${sc.id}`, name: `${sc.name} (Scenario)` })),
]

module.exports = {
    boards,
    data: new SlashCommandBuilder()
        .setName('submit')
        .setDescription('submit a time for an arcade event or scenario')
        .addStringOption(o => o.setName('board').setDescription('the arcade event or scenario').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('time').setDescription('e.g. 1:08.92, or just the digits: 10892').setRequired(true).setMaxLength(12))
        .addUserOption(o => o.setName('racer').setDescription('submit for someone else (server managers and submitters)'))
        .addStringOption(o => o.setName('platform').setDescription('default: your last one, else your console role')
            .addChoices(...records.PLATFORMS.map(p => ({ name: p, value: p }))))
        .addStringOption(o => o.setName('proof').setDescription('a link to a video or screenshot').setMaxLength(200))
        .addStringOption(o => o.setName('notes').setDescription('anything worth noting').setMaxLength(120)),
    async execute({ interaction, member_id } = {}) {
        const o = interaction.options
        let [kind, target] = o.getString('board').split(':')
        if (!target) {  // typed a name instead of picking: take the best match
            const hit = boards().find(b => b.name.toLowerCase().startsWith(kind.toLowerCase()))
            ;[kind, target] = hit ? hit.value.split(':') : []
        }
        const result = await submit({ kind, target, member: interaction.member, memberId: member_id, racer: o.getUser('racer'),
            time: o.getString('time'), platform: o.getString('platform'), proof: o.getString('proof'), notes: o.getString('notes') })
        await interaction.reply({ content: result.error ?? result.receipt ?? result.message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
    },
    async autocomplete(interaction) {
        const q = interaction.options.getFocused().toLowerCase()
        await interaction.respond(boards().filter(b => b.name.toLowerCase().includes(q)).slice(0, 25))
    },
}
