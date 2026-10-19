module.exports = {
    log_channel: process.env.LOG_CHANNEL_ID,
    // Join messages (src/welcome.js)
    welcome_channel: process.env.WELCOME_CHANNEL_ID,
    // Arcade runs posted as screenshots or YouTube links are saved as times (src/replays.js)
    // (comma-separated: #holo-replays, #autopilot and #speedrun)
    replay_channels: (process.env.REPLAY_CHANNEL_ID ?? '').split(',').map(id => id.trim()).filter(Boolean),
    // Podium changes on boards with enough racers (src/podium.js)
    announce_channel: process.env.ANNOUNCE_CHANNEL_ID,
    // Where testing copies post everything the feeds produce
    test_channel: process.env.TEST_CHANNEL_ID,
    // Feed announcements (src/feeds): patches = Steam builds and announcements and news articles, videos = official YouTube
    // uploads (both #news-and-media: news and anything official), streams = Twitch, community = what people post about
    // the game elsewhere (Reddit, YouTube, Twitch clips)
    feedChannels: {
        patches: process.env.PATCH_CHANNEL_ID,
        videos: process.env.VIDEO_CHANNEL_ID,
        streams: process.env.STREAM_CHANNEL_ID,
        community: process.env.COMMUNITY_CHANNEL_ID,
    },
}
