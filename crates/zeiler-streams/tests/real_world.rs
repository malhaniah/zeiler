//! Streams as real addons label them (Torrentio, Comet, MediaFusion and others, with and
//! without a debrid service), through `rank_streams` as `streams_get` runs it: which are
//! kept for the episode asked for, how, and the tags their badges show.

use url::Url;
use zeiler_addon::AddonStreams;
use zeiler_streams::{
    Audio, Codec, EpisodeMatch, Hdr, Quality, RankedStream, Resolution, Source, VideoTarget,
    rank_streams,
};

const HASH: &str = "\"infoHash\": \"0123456789abcdef0123456789abcdef01234567\"";

fn answer(streams: &str) -> Vec<AddonStreams> {
    vec![AddonStreams {
        transport_url: Url::parse("https://addon.example/manifest.json").unwrap(),
        addon_name: "Addon".into(),
        streams: serde_json::from_str(streams).unwrap(),
        error: None,
    }]
}

/// The one stream of `streams`, if it is kept for `target`.
fn kept(stream: &str, target: &VideoTarget) -> Option<RankedStream> {
    let mut ranked = rank_streams(answer(&format!("[{stream}]")), Some(target));
    let group = ranked.remove(0);
    assert_eq!(group.streams.len() + group.hidden as usize, 1);
    group.streams.into_iter().next()
}

fn episode(season: u32, episode: u32) -> VideoTarget {
    VideoTarget::for_request(
        "series",
        &format!("tt3581920:{season}:{episode}"),
        None,
        None,
        None,
    )
    .unwrap()
}

#[test]
fn torrentio_single_episode() {
    let stream = format!(
        r#"{{ "name": "Torrentio\n1080p", {HASH}, "fileIdx": 0,
             "title": "The.Last.of.Us.S01E03.1080p.WEB.H264-CAKES\n👤 1123 💾 3.21 GB ⚙️ EZTV",
             "behaviorHints": {{ "bingeGroup": "torrentio|1080p|WEB|H264",
                                 "filename": "The.Last.of.Us.S01E03.1080p.WEB.H264-CAKES.mkv" }} }}"#
    );
    let s = kept(&stream, &episode(1, 3)).expect("kept");
    assert_eq!(s.episode_match, Some(EpisodeMatch::Exact));
    assert_eq!(s.tags.quality, Quality::FullHd);
    assert_eq!(s.tags.source, Some(Source::WebDl));
    assert_eq!(s.tags.codec, Some(Codec::Avc));
    assert_eq!(s.tags.seeders, Some(1123));
    assert_eq!(s.tags.size, Some(3_210_000_000));
    assert!(
        kept(&stream, &episode(1, 2)).is_none(),
        "never for episode 2"
    );
    assert!(
        kept(&stream, &episode(2, 3)).is_none(),
        "never for season 2"
    );
}

#[test]
fn torrentio_season_pack_with_its_file() {
    let stream = format!(
        r#"{{ "name": "Torrentio\n4k HDR", {HASH}, "fileIdx": 2,
             "title": "The Last of Us S01 2160p HMAX WEB-DL DDP5.1 Atmos HDR H.265-FLUX\nThe.Last.of.Us.S01E03.Long.Long.Time.2160p.HMAX.WEB-DL.DDP5.1.Atmos.HDR.H.265-FLUX.mkv\n👤 230 💾 8.66 GB ⚙️ TorrentGalaxy",
             "behaviorHints": {{ "filename": "The.Last.of.Us.S01E03.Long.Long.Time.2160p.HMAX.WEB-DL.DDP5.1.Atmos.HDR.H.265-FLUX.mkv" }} }}"#
    );
    let s = kept(&stream, &episode(1, 3)).expect("kept");
    assert_eq!(s.episode_match, Some(EpisodeMatch::Exact), "the file says");
    assert_eq!(s.tags.quality, Quality::Uhd);
    assert_eq!(s.tags.hdr, [Hdr::Hdr]);
    assert_eq!(s.tags.audio, [Audio::Atmos, Audio::DolbyDigitalPlus]);
    assert_eq!(s.tags.codec, Some(Codec::Hevc));
    // the same pack, sent for another episode, names another file
    assert!(kept(&stream, &episode(1, 4)).is_none());
}

#[test]
fn a_pack_without_its_file_is_left_out() {
    let no_file = format!(
        r#"{{ "name": "Addon 1080p", {HASH},
             "title": "Breaking.Bad.S01-S05.COMPLETE.1080p.BluRay.x265-HEVC\n👤 88 💾 120 GB" }}"#
    );
    assert!(kept(&no_file, &episode(1, 3)).is_none());
    let with_index = no_file.replace(HASH, &format!("{HASH}, \"fileIdx\": 14"));
    let s = kept(&with_index, &episode(1, 3)).expect("the addon picked the file");
    assert_eq!(s.episode_match, Some(EpisodeMatch::Pack));
    assert!(
        kept(&with_index, &episode(6, 1)).is_none(),
        "no season 6 in it"
    );
}

#[test]
fn debrid_streams() {
    // Torrentio with Real-Debrid: a URL, the file in the hints
    let torrentio = r#"{ "name": "[RD+] Torrentio\n4k DV | HDR",
        "url": "https://torrentio.strem.fun/realdebrid/key/hash/null/3/file.mkv",
        "title": "Severance.S02E03.Who.Is.Alive.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv\n👤 61 💾 9.4 GB ⚙️ TorrentGalaxy",
        "behaviorHints": { "filename": "Severance.S02E03.Who.Is.Alive.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv",
                           "bingeGroup": "torrentio|4k|DV|HDR" } }"#;
    let s = kept(torrentio, &episode(2, 3)).expect("kept");
    assert_eq!(s.tags.cached, Some(true));
    assert_eq!(s.tags.hdr, [Hdr::DolbyVision, Hdr::Hdr]);
    assert!(kept(torrentio, &episode(2, 2)).is_none());

    // Comet: the release on an emoji-led line, cached as ⚡
    let comet = r#"{ "name": "[RD⚡] Comet 1080p",
        "url": "https://comet.example/playback/abc",
        "description": "📄 Rick.and.Morty.S07E03.1080p.WEB.H264-NHTFS\n📹 H264 • WEB\n🔊 AAC • 2.0\n💾 1.1 GB 🔎 Jackett",
        "behaviorHints": { "filename": "Rick.and.Morty.S07E03.1080p.WEB.H264-NHTFS.mkv" } }"#;
    let s = kept(comet, &episode(7, 3)).expect("kept");
    assert_eq!(s.tags.cached, Some(true));
    assert_eq!(s.tags.resolution, Some(Resolution::P1080));
    assert_eq!(s.tags.size, Some(1_100_000_000));
    assert!(kept(comet, &episode(7, 4)).is_none());

    // waiting for a download
    let uncached = r#"{ "name": "[RD download] Torrentio\n1080p", "url": "https://torrentio.example/x",
        "title": "Rick.and.Morty.S07E03.1080p.WEB.H264-NHTFS.mkv" }"#;
    assert_eq!(
        kept(uncached, &episode(7, 3)).unwrap().tags.cached,
        Some(false)
    );
}

#[test]
fn mediafusion_pack_with_a_file_line() {
    let stream = format!(
        r#"{{ "name": "MediaFusion | P2P 4K", {HASH}, "fileIdx": 2,
             "description": "📂 House of the Dragon S02 2160p MAX WEB-DL\n┈➤ House.of.the.Dragon.S02E03.2160p.MAX.WEB-DL.DDP5.1.Atmos.DV.HDR10.H.265-FLUX.mkv\n💾 7.9 GB 👤 230\n🔗 TorrentGalaxy" }}"#
    );
    let s = kept(&stream, &episode(2, 3)).expect("kept");
    assert_eq!(s.episode_match, Some(EpisodeMatch::Exact));
    assert_eq!(s.tags.hdr, [Hdr::DolbyVision, Hdr::Hdr10]);
    assert_eq!(s.tags.seeders, Some(230));
    assert!(kept(&stream, &episode(2, 2)).is_none());
}

#[test]
fn the_old_ways_of_naming_episodes() {
    let friends = r#"{ "url": "https://cdn.example/f.avi", "title": "Friends - 3x03 - The One With The Jam.avi" }"#;
    assert_eq!(
        kept(friends, &episode(3, 3)).unwrap().episode_match,
        Some(EpisodeMatch::Exact)
    );
    assert!(kept(friends, &episode(3, 2)).is_none());
    assert!(kept(friends, &episode(1, 3)).is_none());
    let lower = r#"{ "url": "https://cdn.example/o.mkv", "title": "the.office.us.s03e03.720p.bluray.x264-sinners" }"#;
    let s = kept(lower, &episode(3, 3)).unwrap();
    assert_eq!(s.tags.source, Some(Source::Bluray));
    assert_eq!(s.tags.resolution, Some(Resolution::P720));
    let words =
        r#"{ "url": "https://cdn.example/w.mp4", "title": "Show Season 1 Episode 3 HDTV" }"#;
    assert!(kept(words, &episode(1, 3)).is_some());
    assert!(kept(words, &episode(1, 30)).is_none());
}

#[test]
fn double_episodes() {
    let double = format!(
        r#"{{ {HASH}, "title": "Its.Always.Sunny.in.Philadelphia.S16E01E02.1080p.WEB.H264-GLHF",
             "behaviorHints": {{ "filename": "Its.Always.Sunny.in.Philadelphia.S16E01E02.1080p.WEB.H264-GLHF.mkv" }} }}"#
    );
    assert_eq!(
        kept(&double, &episode(16, 1)).unwrap().episode_match,
        Some(EpisodeMatch::Pack)
    );
    assert_eq!(
        kept(&double, &episode(16, 2)).unwrap().episode_match,
        Some(EpisodeMatch::Pack)
    );
    assert!(kept(&double, &episode(16, 3)).is_none());
    // a run in the torrent's name, without a file: which one would play?
    let run = format!(r#"{{ {HASH}, "title": "The.Simpsons.S01E01-E13.720p.WEB" }}"#);
    assert!(kept(&run, &episode(1, 3)).is_none());
}

#[test]
fn anime() {
    // absolute numbers, as fansub groups name them
    let frieren = format!(
        r#"{{ "name": "Torrentio\n1080p", {HASH},
             "title": "[SubsPlease] Sousou no Frieren - 03 (1080p) [A1B2C3D4].mkv\n👤 450 💾 1.4 GB ⚙️ Nyaa" }}"#
    );
    let kitsu = |episode: u32| {
        VideoTarget::for_request("anime", &format!("kitsu:46474:{episode}"), None, None, None)
            .unwrap()
    };
    assert_eq!(
        kept(&frieren, &kitsu(3)).unwrap().episode_match,
        Some(EpisodeMatch::Exact)
    );
    assert!(kept(&frieren, &kitsu(2)).is_none());
    // the same title through Cinemeta: S01E03 is the third episode
    assert!(kept(&frieren, &episode(1, 3)).is_some());
    // …and the second season's third episode (28 + 3) is not this one
    let s02e03 =
        VideoTarget::for_request("series", "tt22248376:2:3", Some(2), Some(3), Some(31)).unwrap();
    assert!(kept(&frieren, &s02e03).is_none());
    let thirty_one = frieren.replace("- 03 (1080p)", "- 31 (1080p)");
    assert!(kept(&thirty_one, &s02e03).is_some());

    // a batch with its file
    let batch = format!(
        r#"{{ {HASH}, "fileIdx": 2,
             "title": "[Judas] Sousou no Frieren (Season 1) [1080p][HEVC x265 10bit][Multi-Subs] (Batch)\n[Judas] Sousou no Frieren - S01E03.mkv\n👤 120 💾 22 GB ⚙️ Nyaa" }}"#
    );
    let s = kept(&batch, &episode(1, 3)).unwrap();
    assert_eq!(s.episode_match, Some(EpisodeMatch::Exact));
    assert_eq!(s.tags.bit_depth, Some(10));
    assert!(kept(&batch, &episode(1, 4)).is_none());

    // a long-running one
    let one_piece = r#"{ "url": "https://cdn.example/op.mkv", "title": "[Erai-raws] One Piece - 1071 [1080p][Multiple Subtitle][ABCD1234].mkv" }"#;
    let target = VideoTarget::for_request("series", "kitsu:12:1071", None, None, None).unwrap();
    assert!(kept(one_piece, &target).is_some());
    let target = VideoTarget::for_request("series", "kitsu:12:1070", None, None, None).unwrap();
    assert!(kept(one_piece, &target).is_none());
}

#[test]
fn streams_that_name_no_episode_stay() {
    for stream in [
        r#"{ "url": "https://debrid.example/1", "name": "Debrid 1080p", "description": "WEB-DL x265" }"#,
        r#"{ "url": "https://cdn.example/stream.m3u8", "name": "Server 1" }"#,
        r#"{ "url": "https://cdn.example/d.mkv", "title": "Jimmy.Kimmel.2024.10.17.Guest.720p.WEB.h264-EDITH" }"#,
    ] {
        let s = kept(stream, &episode(1, 3)).expect("kept");
        assert_eq!(s.episode_match, Some(EpisodeMatch::Unknown));
    }
}

#[test]
fn a_cam_ranks_last_among_movies() {
    let ranked = rank_streams(
        answer(&format!(
            r#"[
                {{ {HASH}, "title": "Movie.2024.HDCAM.x264\n👤 900" }},
                {{ {HASH}, "title": "Movie.2024.720p.WEBRip.x264\n👤 15" }},
                {{ {HASH}, "title": "Movie.2024.1080p.WEB-DL.DDP5.1.H.264\n👤 300" }}
            ]"#
        )),
        None,
    );
    let ranks: Vec<u32> = ranked[0].streams.iter().map(|s| s.rank).collect();
    assert_eq!(ranks, [2, 1, 0]);
    assert_eq!(ranked[0].streams[0].tags.quality, Quality::Low);
}
