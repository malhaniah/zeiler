//! Streams best first: a score from the tags, then one order across every addon.
//!
//! The score adds up what makes a stream worth playing. In this order of weight: whether
//! it plays in Zeiler's player at all (a URL or a torrent; YouTube and external links go
//! last), a cinema recording (far below everything that plays), whether it starts at
//! once (a debrid service has it: ±25; a torrent's seeders: −30 for none to +10), the
//! resolution (2160p 40, 1080p 30, 720p 20, unlabelled 15, SD below), the source, then
//! HDR, audio and codec, and an exact episode over a pack. So a 1080p stream a debrid
//! service already has comes before a 4K torrent, and a well-seeded 1080p torrent
//! before a 4K one few people share. Equal scores keep the addons' order (the user's
//! priority) and each addon's own order.
//!
//! The weights follow Harbor's scoring (`src/lib/streams/scoring/*`, MIT, Copyright (c)
//! 2026 Harbor; see THIRD-PARTY-NOTICES.md), without its debrid lookups, language and
//! size heuristics.

use zeiler_addon::{Stream, StreamSource};

use crate::episode::EpisodeMatch;
use crate::tags::{Audio, Channels, Codec, Hdr, Resolution, Source, StreamTags};

/// Below every playable stream.
const NOT_PLAYABLE: i32 = -1000;

pub fn score(stream: &Stream, tags: &StreamTags, episode: Option<EpisodeMatch>) -> i32 {
    let mut score = match &stream.source {
        StreamSource::Url { .. } => match tags.cached {
            Some(true) => 25,
            // a debrid service would have to download it first
            Some(false) => -25,
            None => 10,
        },
        StreamSource::Torrent { .. } => match tags.seeders {
            None => 0,
            Some(0) => -30,
            Some(1..=4) => -10,
            Some(5..=19) => 0,
            Some(20..=99) => 5,
            Some(100..=499) => 8,
            Some(_) => 10,
        },
        StreamSource::YouTube { .. }
        | StreamSource::PlayerFrame { .. }
        | StreamSource::External { .. } => NOT_PLAYABLE,
    };

    score += match tags.resolution {
        Some(Resolution::P2160) => 40,
        Some(Resolution::P1440) => 34,
        Some(Resolution::P1080) => 30,
        Some(Resolution::P720) => 20,
        Some(Resolution::P576) => 10,
        Some(Resolution::P480) => 8,
        Some(Resolution::P360) => 4,
        // unlabelled: below 720p, above what says it is SD
        None => 15,
    };

    score += match tags.source {
        Some(Source::Remux) => 8,
        Some(Source::Bluray) => 6,
        Some(Source::WebDl) => 5,
        Some(Source::Webrip) => 3,
        Some(Source::Hdtv) => 1,
        Some(Source::Hdrip) | None => 0,
        Some(Source::Dvd) => -2,
        Some(Source::Screener) => -60,
        Some(Source::Telecine) => -70,
        Some(Source::Telesync) => -80,
        Some(Source::Cam) => -100,
    };

    score += tags
        .hdr
        .iter()
        .map(|h| match h {
            Hdr::DolbyVision => 4,
            Hdr::Hdr10Plus | Hdr::Hdr10 | Hdr::Hdr => 3,
            Hdr::Hlg => 2,
        })
        .max()
        .unwrap_or(0);

    score += tags
        .audio
        .iter()
        .map(|a| match a {
            Audio::Atmos => 4,
            Audio::TrueHd | Audio::DtsX | Audio::DtsHdMa => 3,
            Audio::DtsHd | Audio::Dts | Audio::DolbyDigitalPlus => 2,
            Audio::DolbyDigital | Audio::Flac | Audio::Pcm => 1,
            Audio::Aac | Audio::Opus => 0,
        })
        .max()
        .unwrap_or(0);
    if matches!(
        tags.channels,
        Some(Channels::Surround51 | Channels::Surround71)
    ) {
        score += 2;
    }

    score += match tags.codec {
        Some(Codec::Hevc | Codec::Av1) => 1,
        Some(Codec::Avc | Codec::Vp9) | None => 0,
        Some(Codec::Xvid) => -3,
    };

    score += match episode {
        Some(EpisodeMatch::Exact) => 5,
        Some(EpisodeMatch::Pack) | None => 0,
        Some(EpisodeMatch::Unknown) => -3,
    };
    score
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tags::StreamText;

    fn stream(json: &str) -> Stream {
        serde_json::from_str(json).unwrap()
    }

    fn scored(json: &str) -> i32 {
        let s = stream(json);
        let tags = StreamTags::parse(&StreamText::of(&s));
        score(&s, &tags, None)
    }

    const HASH: &str = "0123456789abcdef0123456789abcdef01234567";

    fn torrent(description: &str) -> String {
        format!(r#"{{ "infoHash": "{HASH}", "description": {description:?} }}"#)
    }

    fn url(name: &str, description: &str) -> String {
        format!(
            r#"{{ "url": "https://debrid.example/f", "name": {name:?}, "description": {description:?} }}"#
        )
    }

    #[test]
    fn better_releases_score_higher() {
        let remux = scored(&torrent(
            "Movie.2160p.BluRay.REMUX.DV.TrueHD.Atmos.7.1\n👤 200",
        ));
        let web4k = scored(&torrent("Movie.2160p.WEB-DL.HDR.DDP5.1.HEVC\n👤 200"));
        let bluray = scored(&torrent("Movie.1080p.BluRay.x264.DTS\n👤 200"));
        let web = scored(&torrent("Movie.1080p.WEB-DL.AAC2.0.x264\n👤 200"));
        let hdtv = scored(&torrent("Movie.720p.HDTV.x264\n👤 200"));
        let sd = scored(&torrent("Movie.480p.DVDRip.XviD\n👤 200"));
        let cam = scored(&torrent("Movie.2160p.HDCAM\n👤 200"));
        assert!(remux > web4k, "{remux} {web4k}");
        assert!(web4k > bluray);
        assert!(bluray > web);
        assert!(web > hdtv);
        assert!(hdtv > sd);
        assert!(sd > cam, "a CAM is last, even in 4K: {sd} {cam}");
    }

    #[test]
    fn a_stream_that_starts_at_once_beats_a_slow_one() {
        // a debrid service has it
        let cached = scored(&url("[RD+] Torrentio\n1080p", "Movie.1080p.WEB-DL"));
        let uncached = scored(&url("[RD download] Torrentio\n1080p", "Movie.1080p.WEB-DL"));
        let plain = scored(&url("Addon\n1080p", "Movie.1080p.WEB-DL"));
        assert!(cached > plain && plain > uncached);
        // a well-seeded 1080p over a 4K hardly anyone shares
        let seeded = scored(&torrent("Movie.1080p.WEB-DL\n👤 350"));
        let starved = scored(&torrent("Movie.2160p.WEB-DL\n👤 2"));
        assert!(seeded > starved, "{seeded} {starved}");
        let dead = scored(&torrent("Movie.1080p.WEB-DL\n👤 0"));
        let unknown = scored(&torrent("Movie.1080p.WEB-DL"));
        assert!(unknown > dead);
    }

    #[test]
    fn what_the_player_cannot_play_goes_last() {
        let trailer = scored(r#"{ "ytId": "dQw4w9WgXcQ", "name": "Trailer 2160p" }"#);
        let link = scored(r#"{ "externalUrl": "https://example.com/watch", "name": "4K" }"#);
        let worst = scored(&torrent("Movie.CAM\n👤 0"));
        assert!(worst > trailer && worst > link);
    }

    #[test]
    fn an_exact_episode_beats_a_pack_and_an_unlabelled_one() {
        let s = stream(&torrent("Show.S01E03.1080p.WEB-DL"));
        let tags = StreamTags::parse(&StreamText::of(&s));
        let exact = score(&s, &tags, Some(EpisodeMatch::Exact));
        let pack = score(&s, &tags, Some(EpisodeMatch::Pack));
        let unknown = score(&s, &tags, Some(EpisodeMatch::Unknown));
        assert!(exact > pack && pack > unknown);
    }
}
