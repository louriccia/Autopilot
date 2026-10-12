module.exports = {
    main_guild: process.env.GUILD_ID,
    test_guild: process.env.TEST_GUILD_ID,
    // Every guild a local testing copy serves (and the live bot leaves alone): the test guild plus any listed in
    // TESTING_GUILDS (comma-separated)
    test_guilds: [process.env.TEST_GUILD_ID, ...(process.env.TESTING_GUILDS ?? '').split(',')].map(id => id?.trim()).filter(Boolean),
}
