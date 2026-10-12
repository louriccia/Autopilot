module.exports = {
    log_channel: process.env.LOG_CHANNEL_ID,
    // Where testing copies post everything the feeds produce
    test_channel: process.env.TEST_CHANNEL_ID,
    // Feed announcements (src/feeds): patches = Steam builds and announcements, videos = YouTube uploads, streams = Twitch
    feedChannels: {
        patches: process.env.PATCH_CHANNEL_ID,
        videos: process.env.VIDEO_CHANNEL_ID,
        streams: process.env.STREAM_CHANNEL_ID,
    },
}
