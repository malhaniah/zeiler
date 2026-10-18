//! What an addon's streams say about themselves, for the stream picker and the player:
//!
//! - **Tags** ([`StreamTags`]): resolution, source (REMUX, BluRay, WEB-DL, …, CAM),
//!   HDR and Dolby Vision, codec, audio, size, seeders and debrid availability, read
//!   from the stream's name, description and filename.
//! - **Episode matching** ([`match_episode`]): a stream for another episode than the
//!   one asked for is left out, and a pack only counts when the addon names the file.
//! - **Ranking** ([`rank_streams`]): every addon's streams in one order, best first.
//!
//! Nothing here touches the network: it reads what `streams_get` brought back.

mod episode;
mod rank;
mod tags;

use serde::Serialize;
use url::Url;
use zeiler_addon::{AddonStreams, Stream, StreamSource};

pub use episode::{Claim, EpisodeMatch, VideoTarget, claim_of, match_episode};
pub use rank::score;
pub use tags::{Audio, Channels, Codec, Hdr, Quality, Resolution, Source, StreamTags, StreamText};

/// One kept stream, its tags, and its place in the order across every addon.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedStream {
    #[serde(flatten)]
    pub stream: Stream,
    pub tags: StreamTags,
    /// how it relates to the episode asked for (null: no episode was asked for)
    pub episode_match: Option<EpisodeMatch>,
    /// 0 is the best stream of all the addons' answers
    pub rank: u32,
}

/// One addon's answer, with the streams for other episodes left out.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedAddonStreams {
    pub transport_url: Url,
    pub addon_name: String,
    /// in the addon's own order
    pub streams: Vec<RankedStream>,
    /// how many streams were for another episode (or a pack that names no file)
    pub hidden: u32,
    pub error: Option<String>,
}

/// The addon names the file of a pack to play.
fn designates_a_file(stream: &Stream) -> bool {
    match &stream.source {
        StreamSource::Torrent {
            file_idx,
            file_must_include,
            ..
        } => file_idx.is_some() || !file_must_include.is_empty(),
        _ => false,
    }
}

/// Tags every stream, leaves out those for another episode than `target` (none when
/// no episode is asked for), and ranks the rest across all addons: equal scores keep
/// the addons' order and each addon's own.
pub fn rank_streams(
    groups: Vec<AddonStreams>,
    target: Option<&VideoTarget>,
) -> Vec<RankedAddonStreams> {
    let mut answers = Vec::with_capacity(groups.len());
    // (score, addon, position in its kept streams)
    let mut order: Vec<(i32, usize, usize)> = Vec::new();
    for (addon, group) in groups.into_iter().enumerate() {
        let mut streams = Vec::with_capacity(group.streams.len());
        let mut hidden = 0;
        for stream in group.streams {
            let text = StreamText::of(&stream);
            let episode_match = match target {
                None => None,
                Some(target) => match match_episode(&text, designates_a_file(&stream), target) {
                    Some(m) => Some(m),
                    None => {
                        hidden += 1;
                        continue;
                    }
                },
            };
            let tags = StreamTags::parse(&text);
            order.push((score(&stream, &tags, episode_match), addon, streams.len()));
            streams.push(RankedStream {
                stream,
                tags,
                episode_match,
                rank: 0,
            });
        }
        answers.push(RankedAddonStreams {
            transport_url: group.transport_url,
            addon_name: group.addon_name,
            streams,
            hidden,
            error: group.error,
        });
    }
    order.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    for (rank, (_, addon, at)) in order.into_iter().enumerate() {
        answers[addon].streams[at].rank = u32::try_from(rank).unwrap_or(u32::MAX);
    }
    answers
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(name: &str, streams: &str) -> AddonStreams {
        AddonStreams {
            transport_url: Url::parse(&format!("https://{name}.example/manifest.json")).unwrap(),
            addon_name: name.to_string(),
            streams: serde_json::from_str(streams).unwrap(),
            error: None,
        }
    }

    const S01E03: VideoTarget = VideoTarget {
        season: Some(1),
        episode: 3,
        absolute: None,
    };

    #[test]
    fn other_episodes_are_left_out_and_counted() {
        let groups = vec![group(
            "torrents",
            r#"[
                { "infoHash": "0000000000000000000000000000000000000001", "title": "Show.S01E03.1080p.WEB-DL\n👤 40" },
                { "infoHash": "0000000000000000000000000000000000000002", "title": "Show.S01E02.1080p.WEB-DL\n👤 400" },
                { "infoHash": "0000000000000000000000000000000000000003", "title": "Show.S02E03.2160p.WEB-DL\n👤 400" },
                { "infoHash": "0000000000000000000000000000000000000004", "title": "Show.S01.1080p.BluRay\n👤 90" },
                { "infoHash": "0000000000000000000000000000000000000005", "fileIdx": 2, "title": "Show.S01.2160p.BluRay\n👤 90" }
            ]"#,
        )];
        let ranked = rank_streams(groups, Some(&S01E03));
        let kept: Vec<_> = ranked[0]
            .streams
            .iter()
            .map(|s| {
                (
                    s.stream
                        .description
                        .as_deref()
                        .unwrap()
                        .lines()
                        .next()
                        .unwrap(),
                    s.episode_match,
                )
            })
            .collect();
        assert_eq!(
            kept,
            [
                ("Show.S01E03.1080p.WEB-DL", Some(EpisodeMatch::Exact)),
                ("Show.S01.2160p.BluRay", Some(EpisodeMatch::Pack)),
            ]
        );
        assert_eq!(ranked[0].hidden, 3);
        // nothing is left out when no episode is asked for
        let all = rank_streams(
            vec![group(
                "torrents",
                r#"[{ "infoHash": "0000000000000000000000000000000000000002", "title": "Show.S01E02" }]"#,
            )],
            None,
        );
        assert_eq!(all[0].streams.len(), 1);
        assert_eq!(all[0].streams[0].episode_match, None);
    }

    #[test]
    fn one_order_across_the_addons_best_first() {
        let groups = vec![
            group(
                "first",
                r#"[
                    { "infoHash": "0000000000000000000000000000000000000001", "title": "Movie.720p.HDTV\n👤 50" },
                    { "infoHash": "0000000000000000000000000000000000000002", "title": "Movie.2160p.BluRay.REMUX\n👤 50" }
                ]"#,
            ),
            group(
                "second",
                r#"[
                    { "url": "https://debrid.example/1", "name": "[RD+] 1080p", "title": "Movie.1080p.WEB-DL" },
                    { "infoHash": "0000000000000000000000000000000000000003", "title": "Movie.720p.HDTV\n👤 50" },
                    { "ytId": "abc", "name": "Trailer" }
                ]"#,
            ),
        ];
        let ranked = rank_streams(groups, None);
        let ranks: Vec<Vec<u32>> = ranked
            .iter()
            .map(|g| g.streams.iter().map(|s| s.rank).collect())
            .collect();
        // the cached 1080p (it starts at once), the 4K REMUX, the equal 720p ones in the
        // addons' order, the trailer
        assert_eq!(ranks, [vec![2, 1], vec![0, 3, 4]]);
    }

    #[test]
    fn serializes_as_the_stream_plus_its_tags() {
        let ranked = rank_streams(
            vec![group(
                "torrents",
                r#"[{ "infoHash": "0000000000000000000000000000000000000001", "fileIdx": 3,
                      "title": "Show.S01E03.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos.HEVC\n👤 12 💾 5.1 GB",
                      "behaviorHints": { "bingeGroup": "torrents|2160p" } }]"#,
            )],
            Some(&S01E03),
        );
        let json = serde_json::to_value(&ranked).unwrap();
        let stream = &json[0]["streams"][0];
        assert_eq!(
            stream["infoHash"],
            "0000000000000000000000000000000000000001"
        );
        assert_eq!(stream["fileIdx"], 3);
        assert_eq!(stream["behaviorHints"]["bingeGroup"], "torrents|2160p");
        assert_eq!(stream["rank"], 0);
        assert_eq!(stream["episodeMatch"], "exact");
        assert_eq!(
            stream["tags"],
            serde_json::json!({
                "quality": "4k",
                "resolution": "2160p",
                "source": "web-dl",
                "hdr": ["dv", "hdr"],
                "codec": "hevc",
                "audio": ["atmos", "dd+"],
                "channels": "5.1",
                "bitDepth": null,
                "size": 5_100_000_000u64,
                "seeders": 12,
                "cached": null
            })
        );
        assert_eq!(json[0]["hidden"], 0);
        assert_eq!(json[0]["addonName"], "torrents");
    }
}
