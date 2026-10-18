//! Quality tags read from a stream's labels: resolution, source, HDR, codec, audio,
//! size, seeders and whether a debrid service already has the file.
//!
//! Addons put a release name somewhere in their labels (Torrentio: the torrent and the
//! file in `title`/`description`, the quality in `name`; others a filename in
//! `behaviorHints.filename`), plus emoji-led facts (`👤 34`, `💾 4.5 GB`). Each tag is
//! looked for in the filename first, then the description, then the name. Every pattern
//! is a whole word, so `HDR` is not read into `HDRip`, nor `TS` into a word.
//!
//! Each label is read up to [`MAX_LABEL_BYTES`]: a release name is far shorter, and an
//! addon's answer can hold megabytes.
//!
//! The patterns follow Harbor's stream parser (`src/lib/streams/parser/*`, MIT,
//! Copyright (c) 2026 Harbor; see THIRD-PARTY-NOTICES.md), adapted to Rust's `regex`
//! (no look-behind) and widened with the forms found in real addon answers.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use zeiler_addon::Stream;

/// The text an addon gave one stream, and the size it states.
#[derive(Debug, Clone, Copy, Default)]
pub struct StreamText<'a> {
    /// `behaviorHints.filename`: the file itself.
    pub filename: Option<&'a str>,
    /// `description` (or its deprecated alias `title`): release names, facts.
    pub description: Option<&'a str>,
    /// `name`: usually the addon and a quality.
    pub name: Option<&'a str>,
    /// `behaviorHints.videoSize`, in bytes.
    pub video_size: Option<u64>,
}

/// How much of each label is read.
pub const MAX_LABEL_BYTES: usize = 4096;

/// `text` up to [`MAX_LABEL_BYTES`], cut at a character boundary.
fn clip(text: &str) -> &str {
    if text.len() <= MAX_LABEL_BYTES {
        return text;
    }
    let mut end = MAX_LABEL_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

impl<'a> StreamText<'a> {
    pub fn of(stream: &'a Stream) -> Self {
        let hints = &stream.behavior_hints;
        Self {
            filename: hints.filename.as_deref().map(clip),
            description: stream.description.as_deref().map(clip),
            name: stream.name.as_deref().map(clip),
            video_size: hints.video_size,
        }
    }

    /// The labels, most specific first.
    pub(crate) fn fields(&self) -> impl Iterator<Item = &'a str> {
        [self.filename, self.description, self.name]
            .into_iter()
            .flatten()
            .filter(|s| !s.trim().is_empty())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub enum Resolution {
    #[serde(rename = "360p")]
    P360,
    #[serde(rename = "480p")]
    P480,
    #[serde(rename = "576p")]
    P576,
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "1440p")]
    P1440,
    #[serde(rename = "2160p")]
    P2160,
}

/// Where the video comes from. The first four are recordings in or of a cinema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Cam,
    Telesync,
    Telecine,
    Screener,
    Remux,
    Bluray,
    WebDl,
    Webrip,
    Hdtv,
    Hdrip,
    Dvd,
}

impl Source {
    /// A copy made in or of a cinema: far below any release.
    pub fn is_low_quality(self) -> bool {
        matches!(
            self,
            Source::Cam | Source::Telesync | Source::Telecine | Source::Screener
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Hdr {
    #[serde(rename = "dv")]
    DolbyVision,
    #[serde(rename = "hdr10+")]
    Hdr10Plus,
    #[serde(rename = "hdr10")]
    Hdr10,
    /// HDR without a named format.
    #[serde(rename = "hdr")]
    Hdr,
    #[serde(rename = "hlg")]
    Hlg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Codec {
    Hevc,
    Av1,
    Vp9,
    Avc,
    Xvid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Audio {
    #[serde(rename = "atmos")]
    Atmos,
    #[serde(rename = "truehd")]
    TrueHd,
    #[serde(rename = "dts-x")]
    DtsX,
    #[serde(rename = "dts-hd-ma")]
    DtsHdMa,
    #[serde(rename = "dts-hd")]
    DtsHd,
    #[serde(rename = "dts")]
    Dts,
    #[serde(rename = "dd+")]
    DolbyDigitalPlus,
    #[serde(rename = "dd")]
    DolbyDigital,
    #[serde(rename = "aac")]
    Aac,
    #[serde(rename = "flac")]
    Flac,
    #[serde(rename = "opus")]
    Opus,
    #[serde(rename = "pcm")]
    Pcm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub enum Channels {
    #[serde(rename = "2.0")]
    Stereo,
    #[serde(rename = "5.1")]
    Surround51,
    #[serde(rename = "7.1")]
    Surround71,
}

/// The picker's and the in-player menu's sections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    #[serde(rename = "4k")]
    Uhd,
    /// 1080p and 1440p
    #[serde(rename = "1080p")]
    FullHd,
    #[serde(rename = "720p")]
    Hd,
    /// 576p and below
    Sd,
    /// no resolution in the labels
    Unknown,
    /// a cinema recording (CAM, telesync, telecine, screener), whatever its resolution
    Low,
}

/// Everything the labels say about one stream's quality.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamTags {
    pub quality: Quality,
    pub resolution: Option<Resolution>,
    pub source: Option<Source>,
    /// best first
    pub hdr: Vec<Hdr>,
    pub codec: Option<Codec>,
    /// best first
    pub audio: Vec<Audio>,
    pub channels: Option<Channels>,
    pub bit_depth: Option<u8>,
    /// bytes: `behaviorHints.videoSize`, else the first size in the labels
    pub size: Option<u64>,
    pub seeders: Option<u32>,
    /// a debrid service has the file (`[RD+]`, `⚡`): `Some(true)`; it would have to
    /// download it first (`[RD download]`, `⏳`): `Some(false)`
    pub cached: Option<bool>,
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("a valid pattern")
}

macro_rules! patterns {
    ($($name:ident = $pattern:expr;)*) => {
        $(static $name: LazyLock<Regex> = LazyLock::new(|| re($pattern));)*
    };
}

patterns! {
    // a pixel count: what the file is
    RES_2160 = r"(?i)\b(?:2160[pi]?|3840x\d{3,4})\b";
    RES_1440 = r"(?i)\b(?:1440[pi]|2560x1440)\b";
    RES_1080 = r"(?i)\b(?:1080[pi]|1920x\d{3,4})\b";
    RES_720 = r"(?i)\b(?:720p|1280x\d{3})\b";
    RES_576 = r"(?i)\b576[pi]\b";
    RES_480 = r"(?i)\b480[pi]\b";
    RES_360 = r"(?i)\b(?:360|240)p\b";
    // a word: only without a pixel count ("1080p.UHD.BluRay" is a 1080p file of a
    // UHD disc, "4K.Remastered.1080p" a 1080p file of a 4K remaster)
    RES_WORD_2160 = r"(?i)\b(?:4k|uhd)\b";
    RES_WORD_1080 = r"(?i)\bfhd\b";
    RES_WORD_480 = r"\bSD\b";

    CAM = r"(?i)\b(?:hd-?cam|cam-?rip|hq-?cam|new-?cam)\b|(?-i:\bCAM\b)";
    TELESYNC = r"(?i)\b(?:hd-?ts|telesync|ts-?rip|pdvd)\b";
    TELECINE = r"(?i)\b(?:telecine|hd-?tc)\b";
    SCREENER = r"(?i)\b(?:screener|dvd-?scr|bd-?scr|web-?scr|scr)\b";
    // the scene's bare TS / TC: upper case, between separators (never `.ts` files)
    BARE_TS_TC = r"(?:^|[\s.\[\(_-])(TS|TC)(?:[\s.\]\)_-]|$)";
    REMUX = r"(?i)\b(?:bd-?)?remux\b";
    BLURAY = r"(?i)\b(?:blu-?ray|bd-?rip|br-?rip|bd-?mux|bd(?:25|50|66|100)|uhd-?bd)\b";
    WEBRIP = r"(?i)\bweb-?rip\b";
    // a bare WEB in upper case only: "Charlotte's Web" is a title
    WEBDL = r"(?i)\bweb-?dl\b|(?-i:\bWEB\b)";
    HDTV = r"(?i)\b(?:hdtv|pdtv|sdtv|tvrip|hdtvrip|satrip|dsr)\b";
    HDRIP = r"(?i)\b(?:hd-?rip|web-?hdrip)\b";
    DVD = r"(?i)\b(?:dvd-?rip|dvd(?:5|9|r)?|dvd-?mux)\b";

    DOLBY_VISION = r"(?i)\b(?:dv|dovi|dolby[\s.-]?vision)\b";
    HDR10_PLUS = r"(?i)\bhdr10(?:\+|plus)";
    HDR10 = r"(?i)\bhdr10\b";
    HDR = r"(?i)\bhdr\b";
    HLG = r"(?i)\bhlg\b";

    HEVC = r"(?i)\b(?:hevc|[xh][\s.]?265)\b";
    AV1 = r"(?i)\bav1\b";
    VP9 = r"(?i)\bvp9\b";
    AVC = r"(?i)\b(?:avc|[xh][\s.]?264)\b";
    XVID = r"(?i)\b(?:xvid|divx)\b";

    // the channels may follow at once: TrueHD7.1, DTS-HDMA5.1, FLAC2.0
    ATMOS = r"(?i)\batmos\b";
    TRUEHD = r"(?i)\btrue-?hd(?:\d|\b)";
    // (not glued to a number: "DTS.x264" is DTS and an encoder)
    DTS_X = r"(?i)\bdts[\s:.-]?x\b";
    DTS_HD_MA = r"(?i)\bdts[\s.-]?hd[\s.-]?ma(?:\d|\b)";
    DTS_HD = r"(?i)\bdts[\s.-]?hd(?:\d|\b)";
    DTS = r"(?i)\bdts(?:\d|\b)";
    DD_PLUS = r"(?i)\bddp|\bdd\+|\be-?ac-?3\b|\bdolby[\s.]?digital[\s.]?plus\b";
    DD = r"(?i)\bdd(?:\d|\b)|\bac-?3\b|\bdolby[\s.]?digital\b";
    AAC = r"(?i)\baac(?:\d|\b)";
    FLAC = r"(?i)\bflac(?:\d|\b)";
    OPUS = r"(?i)\bopus(?:\d|\b)";
    PCM = r"(?i)\bl?pcm(?:\d|\b)";

    // 5.1 after a codec or a dot too (DDP5.1, AAC2.0, Atmos.7.1), never inside a
    // longer number (x265.10bit), nor a size ("💾 5.1 GB": the third group)
    CHANNELS = r"(?:^|[^\d.]|(?:^|[^\d])\.)([257])\.([01])(\s?(?i:[kmgt]i?b)\b)?(?:[^\d]|$)";
    CHANNELS_CH = r"(?i)\b([268])ch\b";
    BIT_DEPTH = r"(?i)\b(8|10|12)[\s.-]?bits?\b";

    SIZE = r"(?i)(\d+(?:[.,]\d+)?)\s?(tib|gib|mib|tb|gb|mb)\b";
    SEEDERS = r"(?i)(?:👤|👥|🌱)\s*(\d+)|\bseed(?:s|ers?)?\s?[:=]?\s?(\d+)\b";
    CACHED = r"(?i)\[(?:rd|ad|pm|dl|tb|ed|oc|pk|en|dls|putio)\+\]|⚡";
    UNCACHED = r"(?i)\[(?:rd|ad|pm|dl|tb|ed|oc|pk|en|dls|putio)\s?(?:download|⬇️?|⏳)\]|⏳";
}

impl StreamTags {
    pub fn parse(text: &StreamText<'_>) -> StreamTags {
        let fields: Vec<&str> = text.fields().collect();
        let all = fields.join("\n");
        let resolution = resolution(&fields);
        let source = source(&all);
        let quality = match (source, resolution) {
            (Some(s), _) if s.is_low_quality() => Quality::Low,
            (_, Some(Resolution::P2160)) => Quality::Uhd,
            (_, Some(Resolution::P1440 | Resolution::P1080)) => Quality::FullHd,
            (_, Some(Resolution::P720)) => Quality::Hd,
            (_, Some(_)) => Quality::Sd,
            (_, None) => Quality::Unknown,
        };
        StreamTags {
            quality,
            resolution,
            source,
            hdr: hdr(&all),
            codec: codec(&all),
            audio: audio(&all),
            channels: channels(&all),
            bit_depth: BIT_DEPTH.captures(&all).and_then(|c| c[1].parse().ok()),
            size: text
                .video_size
                .filter(|s| *s > 0)
                .or_else(|| fields.iter().find_map(|f| size(f))),
            seeders: fields.iter().find_map(|f| seeders(f)),
            cached: if CACHED.is_match(&all) {
                Some(true)
            } else if UNCACHED.is_match(&all) {
                Some(false)
            } else {
                None
            },
        }
    }
}

/// The first field that names a resolution decides (the file before the release, the
/// release before the addon's own label). Within it a pixel count wins over a word
/// (4K, UHD, FHD, SD), and the highest of them.
fn resolution(fields: &[&str]) -> Option<Resolution> {
    let pixels = [
        (&RES_2160, Resolution::P2160),
        (&RES_1440, Resolution::P1440),
        (&RES_1080, Resolution::P1080),
        (&RES_720, Resolution::P720),
        (&RES_576, Resolution::P576),
        (&RES_480, Resolution::P480),
        (&RES_360, Resolution::P360),
    ];
    let words = [
        (&RES_WORD_2160, Resolution::P2160),
        (&RES_WORD_1080, Resolution::P1080),
        (&RES_WORD_480, Resolution::P480),
    ];
    fields.iter().find_map(|field| {
        [&pixels[..], &words[..]].iter().find_map(|ladder| {
            ladder
                .iter()
                .find(|(pattern, _)| pattern.is_match(field))
                .map(|(_, r)| *r)
        })
    })
}

/// A cinema recording is looked for first: a release that says CAM anywhere is one.
fn source(text: &str) -> Option<Source> {
    if CAM.is_match(text) {
        return Some(Source::Cam);
    }
    if TELESYNC.is_match(text) || bare_token(text, "TS") {
        return Some(Source::Telesync);
    }
    if TELECINE.is_match(text) || bare_token(text, "TC") {
        return Some(Source::Telecine);
    }
    let ladder = [
        (&SCREENER, Source::Screener),
        (&REMUX, Source::Remux),
        (&BLURAY, Source::Bluray),
        (&WEBRIP, Source::Webrip),
        (&WEBDL, Source::WebDl),
        (&HDTV, Source::Hdtv),
        (&HDRIP, Source::Hdrip),
        (&DVD, Source::Dvd),
    ];
    ladder
        .iter()
        .find(|(pattern, _)| pattern.is_match(text))
        .map(|(_, s)| *s)
}

/// The scene's bare upper-case `TS` or `TC`, between separators; not a DVD's
/// `VIDEO_TS` folder nor an `MPEG-TS` stream.
fn bare_token(text: &str, token: &str) -> bool {
    BARE_TS_TC.captures_iter(text).any(|c| {
        let found = c.get(1).expect("group 1");
        let before = &text.as_bytes()[..found.start()];
        let ends_with = |suffix: &[u8]| {
            before.len() >= suffix.len()
                && before[before.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
        };
        found.as_str() == token && !ends_with(b"VIDEO_") && !ends_with(b"MPEG-")
    })
}

fn hdr(text: &str) -> Vec<Hdr> {
    let mut found = Vec::new();
    if DOLBY_VISION.is_match(text) {
        found.push(Hdr::DolbyVision);
    }
    if HDR10_PLUS.is_match(text) {
        found.push(Hdr::Hdr10Plus);
    } else if HDR10.is_match(text) {
        found.push(Hdr::Hdr10);
    } else if HDR.is_match(text) {
        found.push(Hdr::Hdr);
    }
    if HLG.is_match(text) {
        found.push(Hdr::Hlg);
    }
    found
}

fn codec(text: &str) -> Option<Codec> {
    [
        (&HEVC, Codec::Hevc),
        (&AV1, Codec::Av1),
        (&VP9, Codec::Vp9),
        (&AVC, Codec::Avc),
        (&XVID, Codec::Xvid),
    ]
    .iter()
    .find(|(pattern, _)| pattern.is_match(text))
    .map(|(_, c)| *c)
}

fn audio(text: &str) -> Vec<Audio> {
    let mut found = Vec::new();
    let mut add = |pattern: &Regex, audio: Audio| {
        let hit = pattern.is_match(text);
        if hit {
            found.push(audio);
        }
        hit
    };
    add(&ATMOS, Audio::Atmos);
    add(&TRUEHD, Audio::TrueHd);
    // the most specific DTS only
    let _ = add(&DTS_X, Audio::DtsX)
        || add(&DTS_HD_MA, Audio::DtsHdMa)
        || add(&DTS_HD, Audio::DtsHd)
        || add(&DTS, Audio::Dts);
    // DD+ is not also plain DD
    let _ = add(&DD_PLUS, Audio::DolbyDigitalPlus) || add(&DD, Audio::DolbyDigital);
    add(&AAC, Audio::Aac);
    add(&FLAC, Audio::Flac);
    add(&OPUS, Audio::Opus);
    add(&PCM, Audio::Pcm);
    found
}

/// The most channels named.
fn channels(text: &str) -> Option<Channels> {
    let dotted = CHANNELS
        .captures_iter(text)
        .filter(|c| c.get(3).is_none())
        .filter_map(|c| match (&c[1], &c[2]) {
            ("7", "1") => Some(Channels::Surround71),
            ("5", "1") => Some(Channels::Surround51),
            ("2", "0") => Some(Channels::Stereo),
            _ => None,
        });
    let counted = CHANNELS_CH.captures_iter(text).map(|c| match &c[1] {
        "8" => Channels::Surround71,
        "6" => Channels::Surround51,
        _ => Channels::Stereo,
    });
    dotted.chain(counted).max()
}

fn size(text: &str) -> Option<u64> {
    let c = SIZE.captures(text)?;
    let number = &c[1];
    // "1,024 MB": a thousands separator; "1,4 GiB": a decimal comma
    let thousands = number
        .split_once(',')
        .is_some_and(|(_, after)| after.len() == 3);
    let value: f64 = if thousands {
        number.replace(',', "").parse().ok()?
    } else {
        number.replace(',', ".").parse().ok()?
    };
    let unit = c[2].to_ascii_lowercase();
    let scale = match unit.as_str() {
        "tb" => 1e12,
        "gb" => 1e9,
        "mb" => 1e6,
        "tib" => 1024f64.powi(4),
        "gib" => 1024f64.powi(3),
        _ => 1024f64.powi(2),
    };
    let bytes = value * scale;
    (1.0..1e15).contains(&bytes).then_some(bytes.round() as u64)
}

fn seeders(text: &str) -> Option<u32> {
    let c = SEEDERS.captures(text)?;
    c.get(1).or_else(|| c.get(2))?.as_str().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(description: &str) -> StreamTags {
        StreamTags::parse(&StreamText {
            description: Some(description),
            ..Default::default()
        })
    }

    #[test]
    fn torrentio_labels() {
        let t = StreamTags::parse(&StreamText {
            name: Some("Torrentio\n4k DV | HDR"),
            description: Some(
                "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1-FGT\n\
                 👤 412 💾 71.3 GB ⚙️ ThePirateBay",
            ),
            ..Default::default()
        });
        assert_eq!(t.quality, Quality::Uhd);
        assert_eq!(t.resolution, Some(Resolution::P2160));
        assert_eq!(t.source, Some(Source::Remux));
        assert_eq!(t.hdr, [Hdr::DolbyVision, Hdr::Hdr]);
        assert_eq!(t.codec, Some(Codec::Hevc));
        assert_eq!(t.audio, [Audio::Atmos, Audio::TrueHd]);
        assert_eq!(t.channels, Some(Channels::Surround71));
        assert_eq!(t.size, Some(71_300_000_000));
        assert_eq!(t.seeders, Some(412));
        assert_eq!(t.cached, None);
    }

    #[test]
    fn debrid_labels_say_whether_the_file_is_ready() {
        let cached = StreamTags::parse(&StreamText {
            name: Some("[RD+] Torrentio\n1080p"),
            description: Some("The.Bear.S03E01.1080p.WEB.h264-ETHEL.mkv\n💾 2.1 GB"),
            ..Default::default()
        });
        assert_eq!(cached.cached, Some(true));
        assert_eq!(cached.source, Some(Source::WebDl));
        assert_eq!(cached.codec, Some(Codec::Avc));
        let uncached = StreamTags::parse(&StreamText {
            name: Some("[RD download] Torrentio\n1080p"),
            ..Default::default()
        });
        assert_eq!(uncached.cached, Some(false));
        assert_eq!(tags("⚡ Comet 1080p").cached, Some(true));
        assert_eq!(tags("⏳ MediaFusion 1080p").cached, Some(false));
    }

    #[test]
    fn resolutions_in_their_many_spellings() {
        let cases = [
            ("Movie.2023.2160p.WEB-DL", Some(Resolution::P2160)),
            ("Movie 4K HDR", Some(Resolution::P2160)),
            ("Movie.UHD.BluRay", Some(Resolution::P2160)),
            ("Movie [3840x2160]", Some(Resolution::P2160)),
            ("Movie.1440p.WEB", Some(Resolution::P1440)),
            ("Movie.1080p.BluRay", Some(Resolution::P1080)),
            ("Movie 1080i HDTV", Some(Resolution::P1080)),
            ("Channel FHD", Some(Resolution::P1080)),
            ("Movie [1920x800]", Some(Resolution::P1080)),
            ("Show.S01E01.720p.HDTV", Some(Resolution::P720)),
            ("Movie.576p.DVD", Some(Resolution::P576)),
            ("Movie.480p.WEBRip", Some(Resolution::P480)),
            ("Movie SD", Some(Resolution::P480)),
            ("Movie.360p", Some(Resolution::P360)),
            ("Movie.2019.WEB-DL", None),
            // not resolutions
            ("Movie.4KHDR.Remastered", None),
            ("Movie 10800p", None),
        ];
        for (text, want) in cases {
            assert_eq!(tags(text).resolution, want, "{text}");
        }
    }

    #[test]
    fn the_file_decides_the_resolution_before_the_addon_label() {
        let t = StreamTags::parse(&StreamText {
            filename: Some("Movie.2022.1080p.WEB-DL.mkv"),
            name: Some("Addon 4k"),
            ..Default::default()
        });
        assert_eq!(t.resolution, Some(Resolution::P1080));
        assert_eq!(t.quality, Quality::FullHd);
    }

    #[test]
    fn a_pixel_count_wins_over_a_word() {
        let cases = [
            (
                "Movie.2019.1080p.UHD.BluRay.DDP7.1.HDR.x265-NCmt",
                Resolution::P1080,
            ),
            (
                "Lawrence.of.Arabia.1962.4K.Remastered.1080p.BluRay",
                Resolution::P1080,
            ),
            ("Movie 4K HDR", Resolution::P2160),
            ("Movie 2160p UHD", Resolution::P2160),
        ];
        for (text, want) in cases {
            assert_eq!(tags(text).resolution, Some(want), "{text}");
        }
    }

    #[test]
    fn sizes_are_no_channel_layouts() {
        assert_eq!(tags("👤 1123 💾 5.1 GB ⚙️ ThePirateBay").channels, None);
        assert_eq!(
            tags("Show.WEB.AAC2.0\n👤 9 💾 7.1 GB").channels,
            Some(Channels::Stereo)
        );
        assert_eq!(tags("💾 5.1GB").channels, None);
        assert_eq!(
            tags("Movie.DDP5.1\n💾 7.1 GiB").channels,
            Some(Channels::Surround51)
        );
    }

    #[test]
    fn audio_with_its_channels_attached() {
        assert_eq!(
            tags("Movie.1080p.BluRay.DTS-HDMA5.1").audio,
            [Audio::DtsHdMa]
        );
        assert_eq!(
            tags("[Group] Show - 03 [BD 1080p FLAC2.0]").audio,
            [Audio::Flac]
        );
        assert_eq!(
            tags("Movie.2160p.TrueHD7.1.Atmos").audio,
            [Audio::Atmos, Audio::TrueHd]
        );
        assert_eq!(tags("Movie.DTS5.1").audio, [Audio::Dts]);
        assert_eq!(tags("Movie.1080p.DTS.x264").audio, [Audio::Dts]);
    }

    #[test]
    fn thousands_separators_and_put_io() {
        assert_eq!(tags("💾 1,024 MB").size, Some(1_024_000_000));
        assert_eq!(tags("💾 1,5 GB").size, Some(1_500_000_000));
        assert_eq!(tags("[Putio+] Torrentio 1080p").cached, Some(true));
        assert_eq!(tags("[Putio download] Torrentio 1080p").cached, Some(false));
    }

    #[test]
    fn long_labels_are_read_in_linear_time_and_clipped() {
        // every TS here is an MPEG-TS, so each one is looked at
        let hostile = "MPEG-TS ".repeat(64 * 1024);
        let started = std::time::Instant::now();
        let t = tags(&hostile);
        assert_eq!(t.source, None);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        // StreamText::of reads a label up to MAX_LABEL_BYTES, at a character boundary
        let stream: Stream = serde_json::from_value(serde_json::json!({
            "url": "https://cdn.example/v.mkv",
            "description": "é".repeat(MAX_LABEL_BYTES),
        }))
        .unwrap();
        let text = StreamText::of(&stream);
        let clipped = text.description.unwrap();
        assert!(clipped.len() <= MAX_LABEL_BYTES && clipped.len() > MAX_LABEL_BYTES - 2);
    }

    #[test]
    fn sources() {
        let cases = [
            ("Movie.2024.HDCAM.x264", Some(Source::Cam)),
            ("Movie 2024 CAM-Rip", Some(Source::Cam)),
            ("Movie.2024.CAM.XviD", Some(Source::Cam)),
            ("Movie.2024.HDTS.x264", Some(Source::Telesync)),
            ("Movie 2024 TELESYNC 720p", Some(Source::Telesync)),
            ("Movie.2024.TS.XviD-GRP", Some(Source::Telesync)),
            ("Movie (2024) TS 1080p", Some(Source::Telesync)),
            ("Movie.2024.HDTC.x264", Some(Source::Telecine)),
            ("Movie.2024.TC.1080p", Some(Source::Telecine)),
            ("Movie.2024.DVDSCR.x264", Some(Source::Screener)),
            ("Movie.2024.2160p.BluRay.REMUX.HEVC", Some(Source::Remux)),
            ("Movie.2024.1080p.BDRemux", Some(Source::Remux)),
            ("Movie.2024.1080p.BluRay.x264", Some(Source::Bluray)),
            ("Movie.2024.1080p.Blu-ray", Some(Source::Bluray)),
            ("Movie.2024.720p.BRRip", Some(Source::Bluray)),
            ("Movie.2024.1080p.BDRip.x265", Some(Source::Bluray)),
            ("Show.S01E01.1080p.WEB-DL.DDP5.1", Some(Source::WebDl)),
            ("Show.S01E01.1080p.WEBDL", Some(Source::WebDl)),
            ("Show.S01E01.1080p.WEB.h264-GRP", Some(Source::WebDl)),
            ("Show.S01E01.1080p.WEBRip.x264", Some(Source::Webrip)),
            ("Show.S01E01.720p.WEB-Rip", Some(Source::Webrip)),
            ("Show.S01E01.720p.HDTV.x264", Some(Source::Hdtv)),
            ("Movie.2010.HDRip.XviD", Some(Source::Hdrip)),
            ("Movie.1999.DVDRip.XviD", Some(Source::Dvd)),
            ("Movie.1999.DVD9", Some(Source::Dvd)),
            ("Movie.2024.1080p.mkv", None),
            // a `.ts` file, a DVD's folder and an MPEG-TS stream are no telesync
            ("Movie.2024.1080p.ts", None),
            ("Movie/VIDEO_TS/VTS_01_1.VOB", None),
            ("Channel HD MPEG-TS", None),
            // words that contain the tags, and titles
            ("Movie.2024.Cameraman.1080p", None),
            ("The Scream 1080p", None),
            ("Charlotte's Web 1973 1080p", None),
        ];
        for (text, want) in cases {
            assert_eq!(tags(text).source, want, "{text}");
        }
        assert_eq!(tags("Movie.2024.HDCAM").quality, Quality::Low);
        assert_eq!(tags("Movie.2024.1080p.HDTS").quality, Quality::Low);
    }

    #[test]
    fn hdr_formats() {
        assert_eq!(
            tags("Movie.2160p.DV.HDR10.HEVC").hdr,
            [Hdr::DolbyVision, Hdr::Hdr10]
        );
        assert_eq!(tags("Movie.2160p.DoVi.HEVC").hdr, [Hdr::DolbyVision]);
        assert_eq!(tags("Movie 2160p Dolby Vision").hdr, [Hdr::DolbyVision]);
        assert_eq!(tags("Movie.2160p.HDR10+.HEVC").hdr, [Hdr::Hdr10Plus]);
        assert_eq!(tags("Movie.2160p.HDR10Plus").hdr, [Hdr::Hdr10Plus]);
        assert_eq!(tags("Movie.2160p.HDR.HEVC").hdr, [Hdr::Hdr]);
        assert_eq!(tags("Channel UHD HLG").hdr, [Hdr::Hlg]);
        assert!(
            tags("Movie.2010.HDRip.XviD").hdr.is_empty(),
            "HDRip is no HDR"
        );
        assert!(tags("Movie.2160p.SDR").hdr.is_empty());
    }

    #[test]
    fn codecs() {
        let cases = [
            ("Movie.1080p.x265", Some(Codec::Hevc)),
            ("Movie.1080p.H.265", Some(Codec::Hevc)),
            ("Movie.1080p.HEVC.10bit", Some(Codec::Hevc)),
            ("Movie 1080p H265", Some(Codec::Hevc)),
            ("Movie.2160p.AV1.Opus", Some(Codec::Av1)),
            ("Movie.1080p.VP9", Some(Codec::Vp9)),
            ("Movie.1080p.x264", Some(Codec::Avc)),
            ("Movie.1080p.H.264", Some(Codec::Avc)),
            ("Movie.1080p.AVC.REMUX", Some(Codec::Avc)),
            ("Movie.1999.DVDRip.XviD", Some(Codec::Xvid)),
            ("Movie.1080p", None),
        ];
        for (text, want) in cases {
            assert_eq!(tags(text).codec, want, "{text}");
        }
    }

    #[test]
    fn audio_formats_and_channels() {
        let t = tags("Movie.2160p.BluRay.REMUX.TrueHD.Atmos.7.1");
        assert_eq!(t.audio, [Audio::Atmos, Audio::TrueHd]);
        assert_eq!(t.channels, Some(Channels::Surround71));
        let t = tags("Movie.1080p.BluRay.DTS-HD.MA.5.1.x264");
        assert_eq!(t.audio, [Audio::DtsHdMa]);
        assert_eq!(t.channels, Some(Channels::Surround51));
        assert_eq!(tags("Movie.2160p.DTS-X.7.1").audio, [Audio::DtsX]);
        assert_eq!(tags("Movie 1080p DTS:X").audio, [Audio::DtsX]);
        assert_eq!(tags("Movie.1080p.DTS-HD.HRA").audio, [Audio::DtsHd]);
        assert_eq!(tags("Movie.1080p.DTS.x264").audio, [Audio::Dts]);
        let t = tags("Show.S01E01.1080p.WEB-DL.DDP5.1.Atmos.H.264");
        assert_eq!(t.audio, [Audio::Atmos, Audio::DolbyDigitalPlus]);
        assert_eq!(t.channels, Some(Channels::Surround51));
        assert_eq!(
            tags("Show.S01E01.WEB-DL.DD+5.1").audio,
            [Audio::DolbyDigitalPlus]
        );
        assert_eq!(
            tags("Show.S01E01.WEB-DL.EAC3").audio,
            [Audio::DolbyDigitalPlus]
        );
        assert_eq!(tags("Movie.DVDRip.AC3.5.1").audio, [Audio::DolbyDigital]);
        assert_eq!(tags("Movie.720p.DD5.1.x264").audio, [Audio::DolbyDigital]);
        let t = tags("Show.S01E01.720p.WEB.AAC2.0.x264");
        assert_eq!(t.audio, [Audio::Aac]);
        assert_eq!(t.channels, Some(Channels::Stereo));
        assert_eq!(tags("Movie.FLAC.2.0").audio, [Audio::Flac]);
        assert_eq!(tags("Movie [6CH]").channels, Some(Channels::Surround51));
        // a codec's version is no channel layout
        assert_eq!(tags("Movie.1080p.x265.10bit").channels, None);
        assert_eq!(tags("Movie.1080p.x265.10bit").bit_depth, Some(10));
        assert_eq!(tags("Movie 10-bit").bit_depth, Some(10));
    }

    #[test]
    fn size_from_the_hint_first_then_the_labels() {
        let t = StreamTags::parse(&StreamText {
            description: Some("💾 4.5 GB"),
            video_size: Some(1_234_567_890),
            ..Default::default()
        });
        assert_eq!(t.size, Some(1_234_567_890));
        assert_eq!(tags("💾 4.5 GB").size, Some(4_500_000_000));
        assert_eq!(tags("Size: 700 MB").size, Some(700_000_000));
        assert_eq!(tags("💾 1,4 GiB").size, Some(1_503_238_554));
        assert_eq!(tags("💾 1.2 TB").size, Some(1_200_000_000_000));
        // the file's size before a pack's
        assert_eq!(tags("💾 1.4 GB / 15.2 GB").size, Some(1_400_000_000));
        assert_eq!(tags("Movie.1080p").size, None);
    }

    #[test]
    fn seeders() {
        assert_eq!(tags("👤 34 💾 4.5 GB").seeders, Some(34));
        assert_eq!(tags("👥 7").seeders, Some(7));
        assert_eq!(tags("Seeders: 120").seeders, Some(120));
        assert_eq!(tags("seeds 5").seeders, Some(5));
        assert_eq!(tags("👤 0").seeders, Some(0));
        assert_eq!(tags("Movie.1080p").seeders, None);
    }
}
