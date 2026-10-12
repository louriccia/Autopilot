// The feeds' Components V2 card: a small source line, a title, some text, an optional image and link buttons
const { ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    SectionBuilder, ThumbnailBuilder, MessageFlags } = require('discord.js')

exports.card = function ({ source, title, lines = [], image, thumbnail, links = [], color = 0x2b2d31 }) {
    const container = new ContainerBuilder().setAccentColor(color)
    const text = [`-# ${source}`, `## ${title}`, ...lines].filter(Boolean).join('\n')
    if (thumbnail) {
        container.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)))
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    }
    if (image) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item => item.setURL(image)))
    if (links.length) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(links.slice(0, 5).map(([label, url]) =>
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url))))
    }
    return { components: [container], flags: MessageFlags.IsComponentsV2 }
}

// Discord timestamp: renders in each reader's own time zone ("October 12, 2026 3:04 PM" / "2 hours ago")
exports.when = (seconds, style = 'f') => `<t:${Math.floor(seconds)}:${style}>`
