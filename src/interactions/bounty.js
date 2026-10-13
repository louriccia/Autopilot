const { ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, MessageFlags } = require('discord.js')
const credits = require('../credits.js')
const pages = require('../swgr/pages.js')
const data = require('../swgr/data.js')
const viewer = require('../viewer.js')
const emoji = require('../data/discord/emoji.js')
const { formatTime } = require('../submit.js')
const { racerOf } = require('../commands/timesheet.js')

// The bounty button beside a leaderboard (src/credits.js postBounty):
//   bounty_open_<kind>_<target>   opens the form: the time to beat and the credits
//   bounty_save_<kind>_<target>   posts it from the poster's balance, redraws the card with the bounty on it and
//                                 announces it in the channel
// kind: arcade | scenario (target: its id), or aggregate (a cumulative leaderboard: target 'main' or a category id)
const BOARDS = {
    arcade: { exists: data.event, page: (target, interaction) => pages.arcadeEvent(target, { expanded: pages.buildExpanded(interaction.message) }) },
    scenario: { exists: data.scenario, page: (target, interaction) => pages.scenarioInfo(target, { expanded: pages.buildExpanded(interaction.message) }) },
    aggregate: {
        exists: target => target == 'main' || data.category(target),
        page: async (target, interaction) => target == 'main' ? pages.arcadeOverview(await racerOf(interaction, interaction.user.id)) : pages.arcadeCategory(target),
    },
}
const whisper = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })

module.exports = {
    name: 'bounty',
    async execute({ interaction, args, member_id } = {}) {
        const [step, kind, target] = args
        const board = BOARDS[kind]
        if (!board?.exists(target)) return whisper(interaction, "That board isn't around anymore.")
        const name = credits.boardName(kind, target)

        if (step == 'open') {
            const best = credits.bestOn(kind, target)
            const balance = credits.balance(member_id)
            if (balance < 100) return whisper(interaction, `A bounty is at least ${emoji.named('credits')} 100, and you have ${emoji.named('credits')} ${balance.toLocaleString('en-US')}. Save runs to earn more.`)
            const input = (id, placeholder, max) => new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(placeholder).setMaxLength(max)
            const total = kind == 'aggregate' ? 'total ' : ''
            return interaction.showModal(new ModalBuilder()
                .setCustomId(`bounty_save_${kind}_${target}`)
                .setTitle(`Set a bounty: ${name}`.slice(0, 45))
                .addLabelComponents(
                    new LabelBuilder().setLabel(`${total ? 'Total time' : 'Time'} to beat`).setDescription(best != null ? `The best ${total}so far is ${formatTime(best)}` : 'No times on this board yet')
                        .setTextInputComponent(input('under', best != null ? `under ${formatTime(best)}` : '1:08.50', 12)),
                    new LabelBuilder().setLabel('Credits').setDescription(`At least 100; you have ${balance.toLocaleString('en-US')}`)
                        .setTextInputComponent(input('credits', '500', 9))))
        }

        // step == 'save'
        const under = require('../records.js').parseTime(interaction.fields.getTextInputValue('under'))
        if (under == null) return whisper(interaction, "That isn't a time. Use minutes:seconds like 1:08.50, or just the digits like 10850.")
        const amount = Number(interaction.fields.getTextInputValue('credits').replace(/[,\s]/g, ''))
        const r = await credits.postBounty({ user: member_id, kind, target, under, amount })
        if (r.error) return whisper(interaction, r.error)
        // The card redraws with the bounty at the top of its leaderboard, and the bounty is announced in the channel
        const posted = pages.bountyPosted(credits.bounty(r.id))
        if (interaction.isFromMessage()) {
            const page = await board.page(target, interaction)
            await interaction.update({ ...viewer.run(interaction.user.id, () => page), attachments: [] })
            await interaction.followUp(posted)
        } else {
            await interaction.reply(posted)
        }
    },
}
