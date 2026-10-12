const { ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js')
const records = require('../records.js')
const emoji = require('../data/discord/emoji.js')
const data = require('../swgr/data.js')
const pages = require('../swgr/pages.js')
const viewer = require('../viewer.js')
const { database } = require('../firebase.js')
const { submit } = require('../submit.js')

// Submitting a time for an arcade event or scenario, like Botto's random challenge "Submit" button:
//   time_open_<kind>_<target>   the card's Submit time button: opens the form
//   time_save_<kind>_<target>   the form: saves the time (src/submit.js) and redraws the card with it on the leaderboard
// People who may submit for others (server managers, /submitter) get a "Racer" picker in the form.
const KINDS = {
    arcade: { item: data.event, page: pages.arcadeEvent },
    scenario: { item: data.scenario, page: pages.scenarioInfo },
}
const whisper = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral })

module.exports = {
    name: 'time',
    async execute({ interaction, args, member_id } = {}) {
        const [step, kind, target] = args
        const item = KINDS[kind]?.item(target)
        if (!item) return whisper(interaction, "That event isn't around anymore.")
        if (!database) return whisper(interaction, "Times can't be saved right now (no database).")

        if (step == 'open') {
            const field = (id, style, { required = false, placeholder, value, max } = {}) => {  // the Label carries the name: Discord rejects a labelled input inside one
                const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required)
                if (placeholder) input.setPlaceholder(placeholder)
                if (value) input.setValue(value)
                if (max) input.setMaxLength(max)
                return input
            }
            // Platform: one of the fixed choices, preselected with their usual one; left unpicked for people who can pick
            // another racer, so it falls back to the racer's own (src/submit.js) instead of theirs
            const forOthers = records.canSubmitForOthers(interaction.member)
            const usual = forOthers ? '' : records.defaultPlatform(member_id, interaction.member)
            const platform = new StringSelectMenuBuilder().setCustomId('platform').setRequired(false).setMinValues(0).setMaxValues(1)
                .setPlaceholder(forOthers ? "Leave empty for the racer's usual platform" : 'Pick a platform')
                .addOptions(records.PLATFORMS.map(p => ({ label: p, value: p, emoji: emoji.named(`platform_${p}`), default: p == usual })))
            const modal = new ModalBuilder()
                .setCustomId(`time_save_${kind}_${target}`)
                .setTitle(`Submit a time: ${item.name}`.slice(0, 45))
                .addLabelComponents(
                    new LabelBuilder().setLabel('Time').setTextInputComponent(field('time', TextInputStyle.Short, { required: true, placeholder: '1:08.92 or 10892', max: 12 })),
                    new LabelBuilder().setLabel('Platform').setStringSelectMenuComponent(platform),
                    new LabelBuilder().setLabel('Proof (optional)').setDescription('A link to a video or screenshot')
                        .setTextInputComponent(field('proof', TextInputStyle.Short, { placeholder: 'https://youtu.be/…', max: 200 })),
                    new LabelBuilder().setLabel('Notes (optional)').setTextInputComponent(field('notes', TextInputStyle.Short, { max: 120 })))
            if (forOthers) {
                modal.addLabelComponents(new LabelBuilder().setLabel('Racer').setDescription('Leave empty to submit your own time')
                    .setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId('racer').setMinValues(0).setMaxValues(1).setRequired(false)))
            }
            return interaction.showModal(modal)
        }

        // step == 'save'
        const f = interaction.fields
        const racer = (() => { try { return f.getSelectedUsers('racer') } catch { return null } })()?.first()
        const result = await submit({ kind, target, member: interaction.member, memberId: member_id, racer,
            time: f.getTextInputValue('time'), platform: f.getStringSelectValues('platform')[0], proof: f.getTextInputValue('proof'), notes: f.getTextInputValue('notes') })
        if (result.error) return whisper(interaction, result.error)
        if (interaction.isFromMessage()) {
            await interaction.update({ ...viewer.run(viewer.ownerOf(interaction), () => KINDS[kind].page(target)), attachments: [] })
            await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
        } else {
            await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
        }
    },
}
