// Copy into src/commands/ and rename. The bot loads every .js file there whose exports have `data`
// and `execute`; run `npm run deploy -- --guild` afterwards so Discord knows about it.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('example')
        .setDescription('describe what this command does')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('an optional argument')
        ),
    async execute({ client, interaction, member_id, member_name, member_avatar } = {}) {
        const text = interaction.options.getString('text')
        const embed = new EmbedBuilder()
            .setTitle('Example')
            .setDescription(text ?? 'Hello from Autopilot')
        await interaction.reply({ embeds: [embed] })
    },
    // Optional: only needed for options declared with .setAutocomplete(true)
    // async autocomplete(interaction) {
    //     const focused = interaction.options.getFocused()
    //     await interaction.respond([{ name: focused, value: focused }])
    // },
}
