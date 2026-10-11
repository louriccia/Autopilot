// Autopilot's application emojis (Developer Portal > Emojis), copied from the Galactic Racer server so they
// render in every server the bot is in. To add one: put the server emoji's <:name:id> here and run
// `node src/scripts/upload-emojis.js`, which uploads it and swaps in the application's id.
const { parseEmoji } = require('discord.js')

const emoji = {
    // planets, keyed by planet id
    planet: {
        'jakku': '<:Jakku:1558664345439707266>',
        'lantaana': '<:Lantaana:1558664346614239362>',
        'ando-prime': '<:AndoPrime:1558664347977384027>',
        'sentinel-i': '<:Sentinel1:1558664349680148480>',
        'crait': '<:Crait:1558664353249755186>',
        'derven-acos': '<:DervenAcos:1558664354440945674>',
        'tatooine': '<:Tatooine:1558664355979989062>',
    },
    // vehicle classes, keyed by display name
    vehicle: {
        'Landspeeder': '<:Landspeeder:1558664357108387921>',
        'Speeder Bike': '<:SpeederBike:1558664358698156104>',
        'Skim Speeder': '<:SkimSpeeder:1558664359918440518>',
        'Podracer': '<:Podracer:1558664362699259996>',
    },
    medal: {
        gold: '<:MedalGold:1558664363802366032>',
        silver: '<:MedalSilver:1558664364947538041>',
        bronze: '<:MedalBronze:1558664366449238097>',
    },
    event: {
        fieldTest: '<:EventFieldTest:1558664367464251566>',
        race: '<:EventRace:1558664368663822396>',
        elim: '<:EventElim:1558664369808744559>',
    },
    credits: '<:Credits:1558664371050250270>',
    leagueToken: '<:LeagueToken:1558664372111282299>',
    thumbsUp: '<:ThumbsUp:1558664373260779671>',
    thumbsNeutral: '<:ThumbsNeutral:1558664374695108638>',
    thumbsDown: '<:ThumbsDown:1558664376293265539>',
    medalSpin: '<a:medal_spin:1558664377589178382>',
    soundWave: '<a:sound_wave:1558664379388534784>',
    spinner: '<a:spinner:1558664380810530926>',
}

// Every application emoji by name, including the generated stat/part/ability icons the game data refers to
// (written by the upload script). Unknown names render as nothing rather than as broken text.
emoji.app = require('./app-emoji.json')
emoji.named = name => emoji.app[name] ?? ''

// Select menu options and buttons take { id, name, animated } rather than the <:name:id> string.
emoji.component = str => str ? parseEmoji(str) : undefined

module.exports = emoji
