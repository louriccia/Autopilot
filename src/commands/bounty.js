const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const credits = require('../credits.js')
const records = require('../records.js')
const data = require('../swgr/data.js')
const emoji = require('../data/discord/emoji.js')
const { boards } = require('./submit.js')
const { formatTime } = require('../submit.js')

// Bounties (src/credits.js): credits held from your balance for the first run under a time on a board, with a
// screenshot or video as proof. They end after 14 days and go back to their funders, minus a 5% fee.
const reply = (interaction, content, ephemeral = true) => interaction.reply({ content, allowedMentions: { parse: [] }, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) })
const boardName = (kind, target) => (kind == 'arcade' ? data.event(target) : data.scenario(target))?.name ?? target
const line = b => `${emoji.named('credits')} **${b.pot.toLocaleString('en-US')}** on **${boardName(b.kind, b.target)}** for under **\`${formatTime(b.under)}\`** / ends <t:${Math.floor(b.expires / 1000)}:R>`

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bounty')
        .setDescription('put credits on a board for the first run under a time')
        .addSubcommand(sub => sub.setName('post').setDescription('post a bounty from your credits')
            .addStringOption(o => o.setName('board').setDescription('the arcade event or scenario').setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName('under').setDescription('the time to beat, e.g. 1:08.50').setRequired(true))
            .addIntegerOption(o => o.setName('credits').setDescription('how many credits (at least 100)').setRequired(true).setMinValue(100)))
        .addSubcommand(sub => sub.setName('add').setDescription('add credits to an open bounty')
            .addStringOption(o => o.setName('bounty').setDescription('the bounty').setRequired(true).setAutocomplete(true))
            .addIntegerOption(o => o.setName('credits').setDescription('how many credits').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub.setName('list').setDescription('the open bounties')),
    async execute({ interaction, member_id } = {}) {
        const sub = interaction.options.getSubcommand()
        if (sub == 'list') {
            const open = credits.openBounties()
            return reply(interaction, open.length ? open.map(line).join('\n') : 'No open bounties. Post one with **/bounty post**.', false)
        }
        if (sub == 'add') {
            const r = await credits.addToBounty({ user: member_id, id: interaction.options.getString('bounty'), amount: interaction.options.getInteger('credits') })
            if (r.error) return reply(interaction, r.error)
            const b = credits.bounty(interaction.options.getString('bounty'))
            return reply(interaction, `<@${member_id}> added to the bounty: ${line(b)}`, false)
        }
        // post
        const [kind, target] = interaction.options.getString('board').split(':')
        if (!target || !(kind == 'arcade' ? data.event(target) : data.scenario(target))) return reply(interaction, 'Pick an arcade event or scenario from the list.')
        const under = records.parseTime(interaction.options.getString('under'))
        if (under == null) return reply(interaction, "That isn't a time. Use minutes:seconds like 1:08.50, or just the digits like 10850.")
        const r = await credits.postBounty({ user: member_id, kind, target, under, amount: interaction.options.getInteger('credits') })
        if (r.error) return reply(interaction, r.error)
        return reply(interaction, `<@${member_id}> posted a bounty: ${line(credits.bounty(r.id))}`, false)
    },
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true), q = focused.value.toLowerCase()
        if (focused.name == 'bounty') {
            return interaction.respond(credits.openBounties().map(b => ({ name: `${b.pot} credits: ${boardName(b.kind, b.target)} under ${formatTime(b.under)}`.slice(0, 100), value: b.id }))
                .filter(o => o.name.toLowerCase().includes(q)).slice(0, 25))
        }
        await interaction.respond(boards().filter(b => b.name.toLowerCase().includes(q)).slice(0, 25))
    },
}
