const { ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, UserSelectMenuBuilder, MessageFlags } = require('discord.js')
const records = require('../records.js')
const data = require('../swgr/data.js')
const pages = require('../swgr/pages.js')
const { database } = require('../firebase.js')

// Submitting a time for an arcade event or scenario, like Botto's random challenge "Submit" button:
//   time_open_<kind>_<target>   the card's ⏱️ button: opens the form
//   time_save_<kind>_<target>   the form: saves the time and redraws the card with it on the leaderboard
// People who may submit for others (server managers, /submitter) get a "Racer" picker in the form.
const KINDS = {
    arcade: { item: data.event, page: pages.arcadeEvent },
    scenario: { item: data.scenario, page: pages.scenarioInfo },
}
const whisper = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral })
const clean = s => String(s ?? '').replace(/[`*_~|<>\\]/g, '').replace(/@(everyone|here)/gi, '$1').replace(/\s+/g, ' ').trim()

module.exports = {
    name: 'time',
    async execute({ interaction, args, member_id } = {}) {
        const [step, kind, target] = args
        const item = KINDS[kind]?.item(target)
        if (!item) return whisper(interaction, "That event isn't around anymore.")
        if (!database) return whisper(interaction, "Times can't be saved right now (no database).")

        if (step == 'open') {
            const field = (id, label, style, { required = false, placeholder, value, max } = {}) => {
                const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required)
                if (placeholder) input.setPlaceholder(placeholder)
                if (value) input.setValue(value)
                if (max) input.setMaxLength(max)
                return input
            }
            const modal = new ModalBuilder()
                .setCustomId(`time_save_${kind}_${target}`)
                .setTitle(`Submit a time: ${item.name}`.slice(0, 45))
                .addLabelComponents(
                    new LabelBuilder().setLabel('Time').setTextInputComponent(field('time', 'Time', TextInputStyle.Short, { required: true, placeholder: '1:08.92', max: 12 })),
                    new LabelBuilder().setLabel('Platform').setTextInputComponent(field('platform', 'Platform', TextInputStyle.Short, { placeholder: 'PC, PS5 or Xbox', value: records.lastPlatform(member_id), max: 20 })),
                    new LabelBuilder().setLabel('Proof (optional)').setDescription('A link to a video or screenshot')
                        .setTextInputComponent(field('proof', 'Proof', TextInputStyle.Short, { placeholder: 'https://youtu.be/…', max: 200 })),
                    new LabelBuilder().setLabel('Notes (optional)').setTextInputComponent(field('notes', 'Notes', TextInputStyle.Short, { max: 120 })))
            if (records.canSubmitForOthers(interaction.member)) {
                modal.addLabelComponents(new LabelBuilder().setLabel('Racer').setDescription('Leave empty to submit your own time')
                    .setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId('racer').setMinValues(0).setMaxValues(1).setRequired(false)))
            }
            return interaction.showModal(modal)
        }

        // step == 'save'
        const f = interaction.fields
        const time = records.parseTime(f.getTextInputValue('time'))
        if (time == null) return whisper(interaction, `"${clean(f.getTextInputValue('time'))}" isn't a time. Use minutes:seconds, like 1:08.92.`)
        const proof = f.getTextInputValue('proof').trim()
        if (proof && !/^https?:\/\/\S+$/i.test(proof)) return whisper(interaction, 'The proof needs to be a link (starting with https://).')
        let user = member_id
        const picked = (() => { try { return f.getSelectedUsers('racer') } catch { return null } })()?.first()
        if (picked && picked.id != member_id) {
            if (!records.canSubmitForOthers(interaction.member)) return whisper(interaction, "You can't submit times for other people.")
            if (picked.bot) return whisper(interaction, "Bots don't race.")
            user = picked.id
        }

        await records.addTime({ kind, target, user, submittedBy: member_id, time, platform: clean(f.getTextInputValue('platform')).slice(0, 20), proof, notes: clean(f.getTextInputValue('notes')).slice(0, 120) })
        const board = records.leaderboard(kind, target)
        const rank = board.findIndex(t => t.user == user) + 1
        const best = board[rank - 1]
        const whose = user == member_id ? 'Your' : `<@${user}>'s`
        const note = best.time < time ? `Saved ${formatTime(time)}. ${whose} best is still ${formatTime(best.time)} (#${rank}).` : `Saved! ${whose} ${formatTime(time)} is #${rank} on ${item.name}.`
        if (interaction.isFromMessage()) {
            await interaction.update({ ...KINDS[kind].page(target), attachments: [] })
            await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
        } else {
            await interaction.reply({ content: note, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
        }
    },
}

function formatTime(s) {
    const cs = Math.round(s * 100), m = Math.floor(cs / 6000), rest = (cs % 6000) / 100
    return m ? `${m}:${rest.toFixed(2).padStart(5, '0')}` : rest.toFixed(2)
}
