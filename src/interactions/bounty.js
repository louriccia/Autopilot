const { ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, MessageFlags } = require('discord.js')
const records = require('../records.js')
const credits = require('../credits.js')
const pages = require('../swgr/pages.js')
const data = require('../swgr/data.js')
const viewer = require('../viewer.js')
const { formatTime } = require('../submit.js')

// The "Set a bounty" button on arcade and scenario cards (src/credits.js postBounty):
//   bounty_open_<kind>_<target>   opens the form: the time to beat and the credits
//   bounty_save_<kind>_<target>   posts it from the poster's balance and redraws the card with the bounty on it
const KINDS = { arcade: { item: data.event, page: pages.arcadeEvent }, scenario: { item: data.scenario, page: pages.scenarioInfo } }
const whisper = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })

module.exports = {
    name: 'bounty',
    async execute({ interaction, args, member_id } = {}) {
        const [step, kind, target] = args
        const item = KINDS[kind]?.item(target)
        if (!item) return whisper(interaction, "That board isn't around anymore.")

        if (step == 'open') {
            const best = records.leaderboard(kind, target)[0]
            const balance = credits.balance(member_id)
            if (balance < 100) return whisper(interaction, `A bounty is at least 100 credits, and you have ${balance}. Save runs to earn credits.`)
            const input = (id, placeholder, max) => new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(placeholder).setMaxLength(max)
            return interaction.showModal(new ModalBuilder()
                .setCustomId(`bounty_save_${kind}_${target}`)
                .setTitle(`Set a bounty: ${item.name}`.slice(0, 45))
                .addLabelComponents(
                    new LabelBuilder().setLabel('Time to beat').setDescription(best ? `The best so far is ${formatTime(best.time)}` : 'No times on this board yet')
                        .setTextInputComponent(input('under', best ? `under ${formatTime(best.time)}` : '1:08.50', 12)),
                    new LabelBuilder().setLabel('Credits').setDescription(`At least 100; you have ${balance.toLocaleString('en-US')}`)
                        .setTextInputComponent(input('credits', '500', 9))))
        }

        // step == 'save'
        const under = records.parseTime(interaction.fields.getTextInputValue('under'))
        if (under == null) return whisper(interaction, "That isn't a time. Use minutes:seconds like 1:08.50, or just the digits like 10850.")
        const amount = Number(interaction.fields.getTextInputValue('credits').replace(/[,\s]/g, ''))
        const r = await credits.postBounty({ user: member_id, kind, target, under, amount })
        if (r.error) return whisper(interaction, r.error)
        // The card redraws with the bounty at the top of its leaderboard, and the bounty is announced in the channel
        const posted = pages.bountyPosted(credits.bounty(r.id))
        if (interaction.isFromMessage()) {
            await interaction.update({ ...viewer.run(interaction.user.id, () => KINDS[kind].page(target, { expanded: pages.buildExpanded(interaction.message) })), attachments: [] })
            await interaction.followUp(posted)
        } else {
            await interaction.reply(posted)
        }
    },
}
