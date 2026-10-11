module.exports = {
    // Testing mode routes the bot to the test guild only. Set TESTING=true|false in .env to force it;
    // otherwise it follows Botto's convention of switching on automatically on louri's machine.
    testing: process.env.TESTING ? process.env.TESTING === 'true' : process.env.USERNAME == 'louri',
    clientId: process.env.clientId,
};
