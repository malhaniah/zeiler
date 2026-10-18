//! Which episode a stream is, from its labels, and whether that is the one asked for.
//!
//! A line of a label makes one [`Claim`]: an episode or a run of them (`S01E03`,
//! `1x03`, `Season 1 Episode 3`, `S01E01-E03`, an anime's absolute `- 1071`, `S2 - 03`,
//! `Overlord IV - 03`), whole seasons (`S01`, `Season 2`, `S01-S03`, `2nd Season`), the
//! complete series, or nothing. A run continues only right after the episode
//! (`S01E01-03`, `S01E01E02`, `S01E01 - E03`): a spaced number after a dash is an
//! episode's title (`S01E02 - 10 Things I Hate`, Sonarr's names) and a number before a
//! size unit a size. [`match_episode`] then reads the stream's lines from the most
//! specific on:
//!
//! 1. **The file**: `behaviorHints.filename`, and any line that ends in a video file's
//!    extension (Torrentio's second line, a pack's file; a name without a season takes
//!    its folder's, `Season 2/Episode 03.mkv`). An episode claim here decides.
//! 2. **The release**: every other line of the description and the name; the most
//!    specific claim decides (episodes before seasons before "complete").
//!
//! A single episode must be the one asked for. Several episodes, a season or the whole
//! series contain it at best, so they count only when the addon says which file plays
//! (`fileIdx`, `fileMustInclude`, or `behaviorHints.filename`, by which the engine picks
//! the file): otherwise the player would open whatever file the pack starts with (the
//! largest). A file line in the description decides when it names the episode, but
//! does not by itself pick a pack's file. No claim at all keeps the stream: nothing
//! says it is another episode.
//!
//! Seasons are compared as the video's own (`S02E03` is never season 1's episode 3).
//! An absolute number (anime: `[SubsPlease] Show - 27`) is the episode's absolute
//! number when the UI knows it, else the episode number of a first season. For an
//! anime id (Kitsu, MyAnimeList, AniList, AniDB) every entry numbers its episodes from
//! one and the season numbers of releases are not the database's, so only the episode
//! number is compared. Fansub groups that keep counting across the entries Kitsu splits
//! (`Jujutsu Kaisen - 25` for the second season's first episode) are therefore left
//! out: the offset is not known, and keeping them would offer other episodes.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::tags::StreamText;

/// The episode a stream request is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoTarget {
    /// None: compare episode numbers only (anime ids).
    pub season: Option<u32>,
    pub episode: u32,
    /// the episode's number counted across the regular seasons, when known
    pub absolute: Option<u32>,
}

/// Id prefixes of the anime databases, whose episode numbers start at one per entry.
const ANIME_ID_PREFIXES: [&str; 4] = ["kitsu:", "mal:", "anilist:", "anidb:"];

impl VideoTarget {
    /// The episode `id` names, with the numbers the UI read from the meta's video taking
    /// precedence over the id's. None for a movie, a channel, or a video with no episode
    /// number: nothing is filtered then.
    pub fn for_request(
        r#type: &str,
        id: &str,
        season: Option<u32>,
        episode: Option<u32>,
        absolute: Option<u32>,
    ) -> Option<VideoTarget> {
        if matches!(r#type, "movie" | "tv" | "channel") {
            return None;
        }
        let anime = ANIME_ID_PREFIXES.iter().any(|p| id.starts_with(p));
        let (id_season, id_episode) = numbers_in_id(id, anime);
        let episode = episode.or(id_episode)?;
        Some(VideoTarget {
            season: if anime { None } else { season.or(id_season) },
            episode,
            absolute: absolute.filter(|a| *a > 0),
        })
    }
}

/// `tt0944947:1:3` and `tmdb:1399:1:3` name a season and an episode; an anime id
/// (`kitsu:7442:3`) only an episode.
fn numbers_in_id(id: &str, anime: bool) -> (Option<u32>, Option<u32>) {
    let parts: Vec<&str> = id.split(':').collect();
    let number = |i: usize| parts.get(i).and_then(|p| p.parse::<u32>().ok());
    match parts.as_slice() {
        [base, _, _] if base.starts_with("tt") && !anime => (number(1), number(2)),
        ["tmdb", _, _, _] => (number(2), number(3)),
        [_, _, _] if anime => (None, number(2)),
        _ => (None, None),
    }
}

/// What one line of a label says about episodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Claim {
    None,
    /// episodes `first..=last` (one when equal) of `season`; no season: an absolute
    /// number, or an episode whose season is not named
    Episodes {
        season: Option<u32>,
        first: u32,
        last: u32,
    },
    /// whole seasons `first..=last`
    Seasons {
        first: u32,
        last: u32,
    },
    /// the whole series
    Complete,
}

impl Claim {
    /// Episodes say more than seasons, seasons more than "complete".
    fn specificity(self) -> u8 {
        match self {
            Claim::None => 0,
            Claim::Complete => 1,
            Claim::Seasons { .. } => 2,
            Claim::Episodes { .. } => 3,
        }
    }
}

/// How a kept stream relates to the episode asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EpisodeMatch {
    /// it is that episode
    Exact,
    /// a pack (several episodes, a season, the series) with that episode in it, and
    /// the addon names the file
    Pack,
    /// the labels name no episode
    Unknown,
}

/// The longest run of episodes one claim may cover; a longer one is a misreading.
const MAX_RUN: u32 = 2000;
/// The longest run after an episode (`S01E01-E24`); a longer one is a misreading
/// (`S01E03-1080`).
const MAX_TAIL_RUN: u32 = 200;

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("a valid pattern")
}

macro_rules! patterns {
    ($($name:ident = $pattern:expr;)*) => {
        $(static $name: LazyLock<Regex> = LazyLock::new(|| re($pattern));)*
    };
}

// Every pattern runs on a normalized line: lower case, `.` and `_` as spaces (but a dot
// between digits stays: `12.4 GB`, `5.1`).
patterns! {
    // S01E03, S01 E03, S1E3, S01 - E03, S01EP03, S01 Ep 03
    SXXEYY = r"\bs(\d{1,4}) ?(?:- ?)?e(?:p ?)?(\d{1,4})";
    // after it: E04, -E04, E04E05, & E05
    TAIL_E = r"^(?: ?- ?| ?& ?| )?e(?:p ?)?(\d{1,4})";
    // after it: -S01E04, & S01E04
    TAIL_SXXEYY = r"^ ?(?:-|&) ?s(\d{1,4}) ?e(\d{1,4})";
    // after it, with nothing between: -04 (S01E01-04, Episodes 1-5); a spaced " - 10" is
    // an episode title ("S01E02 - 10 Things I Hate"), Sonarr's way
    TAIL_NUMBER = r"^(?:-|~)(\d{1,4})";
    // 1x03, 01x03 (two digits after the x, so 4x3 and 16x9 are aspect ratios)
    NX = r"\b(\d{1,2})x(\d{2,3})\b";
    // after it: -04, or 1x04 (spaced or not)
    TAIL_NX = r"^(?:-(\d{2,3})\b| ?- ?\d{1,2}x(\d{2,3})\b)";
    // Season 1 Episode 3, Saison 1 Épisode 3, Staffel 1 Folge 3, Season 01 Ep 03
    SEASON_EPISODE_WORDS = r"\b(?:season|saison|staffel|temporada|stagione|seizoen|sezon) ?(\d{1,3}) ?(?:- ?|, ?)?(?:episode|episodio|épisode|folge|ep|e|capitulo|cap) ?(\d{1,4})\b";
    // a season named on its own: S02, Season 2, 2nd Season
    SEASON = r"\b(?:s(\d{1,2})|(?:season|saison|staffel|temporada|stagione|seizoen|sezon) ?(\d{1,2})|(\d{1,2})(?:st|nd|rd|th) season)\b";
    // an anime's later season as a Roman numeral, with its episode: "Overlord IV - 03"
    // (not V or X alone, which are titles)
    ROMAN_SEASON_DASH = r"\b(ii|iii|iv|vi|vii|viii|ix) - (\d{1,4})(?:v\d{1,2})?(?: |$|[\[\(])";
    // S01-S03, S1-3, S01 to S05
    SEASON_RANGE = r"\bs(\d{1,2}) ?(?:-|~|to) ?s?(\d{1,2})\b";
    // Seasons 1-3, Season 1 to 5, Season 1 & 2
    SEASON_RANGE_WORDS = r"\b(?:seasons?|saisons?|staffeln?|temporadas?) ?(\d{1,2}) ?(?:-|~|to|&|and) ?(?:season )?(\d{1,2})\b";
    COMPLETE = r"\b(?:complete|completa|completo|integrale|all seasons|full series)\b";
    // the anime way: " - 03", " - 1071v2", before a space, a bracket or the end
    DASH_NUMBER = r" - (\d{1,4})(?:v\d{1,2})?(?: |$|[\[\(])";
    // a batch: " - 01-24", "(01-24)", "[01 ~ 24]"
    DASH_RANGE = r" - (\d{1,4}) ?(?:-|~) ?(\d{1,4})(?: |$|[\[\(])";
    BRACKET_RANGE = r"[\[\(](\d{1,4}) ?(?:-|~) ?(\d{1,4})[\]\)]";
    // Episode 3, Ep 03, Folge 3, E03
    EPISODE_WORD = r"\b(?:episodes?|episodios?|épisodes?|folgen?|eps?) ?(\d{1,4})\b|\be(\d{2,4})\b";
    // a line that is a file: ends in a video extension
    FILE_LINE = r"(?i)\.(?:mkv|mp4|m4v|avi|mov|webm|wmv|ts|m2ts|mpg|mpeg|flv|ogm)\s*$";
    // what follows a number that is a size: "- 23 GB", "-12.4 GB"
    SIZE_UNIT = r"^(?:\.\d+)? ?[kmgt]i?b\b";
}

/// Lower case, `.` and `_` as spaces (except a dot between two digits), runs of white
/// space as one.
fn normalize(line: &str) -> String {
    let lower: Vec<char> = line.to_lowercase().chars().collect();
    let digit = |i: Option<usize>| {
        i.and_then(|i| lower.get(i))
            .is_some_and(char::is_ascii_digit)
    };
    let spaced: String = lower
        .iter()
        .enumerate()
        .map(|(i, &c)| match c {
            '.' if digit(i.checked_sub(1)) && digit(Some(i + 1)) => '.',
            '.' | '_' => ' ',
            c => c,
        })
        .collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn number(m: Option<regex::Match<'_>>) -> Option<u32> {
    m?.as_str().parse().ok()
}

/// A four-digit year, which an anime-style `- 2019` is not an episode of.
fn is_year(n: u32) -> bool {
    (1900..=2099).contains(&n)
}

/// `first..=last` as a claim when it is a sensible run.
fn run(season: Option<u32>, first: u32, last: u32) -> Claim {
    if last >= first && last - first <= MAX_RUN {
        Claim::Episodes {
            season,
            first,
            last,
        }
    } else {
        Claim::Episodes {
            season,
            first,
            last: first,
        }
    }
}

/// Where a run of episodes that starts at `first` ends, from what follows it.
fn run_end(rest: &str, first: u32, tails: &[&Regex]) -> u32 {
    let mut last = first;
    let mut rest = rest;
    'more: loop {
        for tail in tails {
            if let Some(c) = tail.captures(rest) {
                let whole = c.get(0).expect("group 0");
                let after = &rest[whole.end()..];
                // a resolution or a size, not an episode (S01E01-1080p, S01E03 & 4K,
                // S01E01-12.4 GB); only another episode may follow directly (S01E01E02)
                if after.starts_with(|c: char| c.is_alphanumeric() && c != 'e')
                    || SIZE_UNIT.is_match(after)
                {
                    break 'more;
                }
                // the tail's number (in whichever of its groups matched)
                let Some(n) = number((1..c.len()).rev().find_map(|i| c.get(i))) else {
                    break 'more;
                };
                if n <= last || n - first > MAX_TAIL_RUN {
                    break 'more;
                }
                last = n;
                rest = after;
                continue 'more;
            }
        }
        break;
    }
    last
}

/// The first anime-style ` - 03` in `text` that is an episode: not a year, not a size.
fn dash_number(text: &str) -> Option<u32> {
    DASH_NUMBER.captures_iter(text).find_map(|c| {
        let found = c.get(1).expect("group 1");
        let n: u32 = found.as_str().parse().ok()?;
        (!is_year(n) && !SIZE_UNIT.is_match(&text[found.end()..])).then_some(n)
    })
}

/// The claim one line of a label makes.
pub fn claim_of(line: &str) -> Claim {
    let s = normalize(line);
    if s.is_empty() {
        return Claim::None;
    }

    if let Some(c) = SXXEYY.captures(&s) {
        let (season, first) = (number(c.get(1)), number(c.get(2)).unwrap_or(0));
        let rest = &s[c.get(0).expect("group 0").end()..];
        let mut last = run_end(rest, first, &[&TAIL_E, &TAIL_NUMBER]);
        if let Some(t) = TAIL_SXXEYY.captures(rest)
            && number(t.get(1)) == season
            && let Some(end) = number(t.get(2))
            && end > last
        {
            last = end;
        }
        return run(season, first, last);
    }

    if let Some(c) = SEASON_EPISODE_WORDS.captures(&s) {
        let (season, first) = (number(c.get(1)), number(c.get(2)).unwrap_or(0));
        let rest = &s[c.get(0).expect("group 0").end()..];
        return run(season, first, run_end(rest, first, &[&TAIL_NUMBER]));
    }

    if let Some(c) = NX.captures(&s) {
        let (season, first) = (number(c.get(1)), number(c.get(2)).unwrap_or(0));
        let rest = &s[c.get(0).expect("group 0").end()..];
        return run(season, first, run_end(rest, first, &[&TAIL_NX]));
    }

    // the seasons named, and where the first one ends
    let seasons: Vec<(u32, usize)> = SEASON
        .captures_iter(&s)
        .filter_map(|c| {
            let n = number(c.get(1).or(c.get(2)).or(c.get(3)))?;
            Some((n, c.get(0).expect("group 0").end()))
        })
        .collect();

    // an anime season and its episode: "S2 - 03", "2nd Season - 03", "Season 2 - 01-12"
    if let Some(&(season, end)) = seasons.first() {
        let rest = &s[end..];
        if let Some(c) = DASH_RANGE.captures(rest)
            && let (Some(first), Some(last)) = (number(c.get(1)), number(c.get(2)))
            && !is_year(first)
        {
            return run(Some(season), first, last);
        }
        if let Some(n) = dash_number(rest) {
            return run(Some(season), n, n);
        }
    }
    if seasons.is_empty()
        && let Some(c) = ROMAN_SEASON_DASH.captures(&s)
        && let Some(n) = number(c.get(2))
        && !is_year(n)
    {
        let season = match &c[1] {
            "ii" => 2,
            "iii" => 3,
            "iv" => 4,
            "vi" => 6,
            "vii" => 7,
            "viii" => 8,
            _ => 9,
        };
        return run(Some(season), n, n);
    }

    // whole seasons
    let range = SEASON_RANGE
        .captures(&s)
        .or_else(|| SEASON_RANGE_WORDS.captures(&s))
        .and_then(|c| Some((number(c.get(1))?, number(c.get(2))?)))
        .filter(|(first, last)| last > first);
    if let Some((first, last)) = range {
        return Claim::Seasons { first, last };
    }
    // several seasons named one by one: a run of them (S01 S02 S03); with a gap
    // (S01 S03) only the first counts, so the pack never stands for the season between
    let mut named: Vec<u32> = seasons.iter().map(|(n, _)| *n).collect();
    if let Some(&(first_named, _)) = seasons.first() {
        named.sort_unstable();
        named.dedup();
        let (first, last) = (named[0], named[named.len() - 1]);
        let contiguous = (last - first) as usize + 1 == named.len();
        return if contiguous {
            Claim::Seasons { first, last }
        } else {
            Claim::Seasons {
                first: first_named,
                last: first_named,
            }
        };
    }
    if COMPLETE.is_match(&s) {
        return Claim::Complete;
    }

    // episodes of no named season: an episode word, a batch, an absolute number
    if let Some(c) = EPISODE_WORD.captures(&s)
        && let Some(n) = number(c.get(1).or(c.get(2)))
    {
        let rest = &s[c.get(0).expect("group 0").end()..];
        return run(None, n, run_end(rest, n, &[&TAIL_NUMBER]));
    }
    for pattern in [&DASH_RANGE, &BRACKET_RANGE] {
        for c in pattern.captures_iter(&s) {
            if let (Some(first), Some(last)) = (number(c.get(1)), number(c.get(2)))
                && !is_year(first)
                && !is_year(last)
                && last > first
            {
                return run(None, first, last);
            }
        }
    }
    if let Some(n) = dash_number(&s) {
        return run(None, n, n);
    }
    Claim::None
}

/// Whether a claim of episodes `first..=last` (of `season`) holds `target`.
fn holds(season: Option<u32>, first: u32, last: u32, target: &VideoTarget) -> bool {
    let within = |n: u32| (first..=last).contains(&n);
    match (season, target.season) {
        (Some(s), Some(t)) => s == t && within(target.episode),
        // an anime id: its episode number is all there is to compare
        (_, None) => within(target.episode),
        // an absolute number, or an episode of an unnamed season
        (None, Some(t)) => {
            target.absolute.is_some_and(within) || (t == 1 && within(target.episode))
        }
    }
}

fn seasons_hold(first: u32, last: u32, target: &VideoTarget) -> bool {
    target.season.is_none_or(|s| (first..=last).contains(&s))
}

/// A file's claim: its name's, with the season of its folder when the name has none
/// (a pack's "Show/Season 2/Episode 03.mkv").
fn file_claim(path: &str) -> Claim {
    let mut parts = path.rsplit(['/', '\\']);
    let name = parts.next().unwrap_or(path);
    match claim_of(name) {
        Claim::Episodes {
            season: None,
            first,
            last,
        } => {
            let folder = parts.find_map(|dir| match claim_of(dir) {
                Claim::Seasons { first, last } if first == last => Some(first),
                _ => None,
            });
            Claim::Episodes {
                season: folder,
                first,
                last,
            }
        }
        claim => claim,
    }
}

/// How a stream relates to `target`: `None` when it is another episode (or a pack
/// that holds this one but does not say which file plays). `designated`: the addon
/// names the file to play (`fileIdx` or `fileMustInclude`); `behaviorHints.filename`
/// does too (the engine picks the torrent's file by it). A file line in the
/// description decides when it names an episode, but does not by itself pick a file.
pub fn match_episode(
    text: &StreamText<'_>,
    designated: bool,
    target: &VideoTarget,
) -> Option<EpisodeMatch> {
    let lines: Vec<&str> = [text.description, text.name]
        .into_iter()
        .flatten()
        .flat_map(str::lines)
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let (file_lines, release_lines): (Vec<&str>, Vec<&str>) =
        lines.into_iter().partition(|l| FILE_LINE.is_match(l));
    let filename = text.filename.map(str::trim).filter(|f| !f.is_empty());
    let designated = designated || filename.is_some();
    let files: Vec<&str> = filename.into_iter().chain(file_lines).collect();

    // 1. the file
    for file in &files {
        if let Claim::Episodes {
            season,
            first,
            last,
        } = file_claim(file)
        {
            return holds(season, first, last, target).then_some(if first == last {
                EpisodeMatch::Exact
            } else {
                EpisodeMatch::Pack
            });
        }
    }

    // 2. the release: its most specific claim
    let claim = release_lines
        .iter()
        .map(|l| claim_of(l))
        .fold(Claim::None, |best, c| {
            if c.specificity() > best.specificity() {
                c
            } else {
                best
            }
        });
    match claim {
        Claim::None => Some(EpisodeMatch::Unknown),
        Claim::Episodes {
            season,
            first,
            last,
        } if first == last => holds(season, first, last, target).then_some(EpisodeMatch::Exact),
        Claim::Episodes {
            season,
            first,
            last,
        } => (designated && holds(season, first, last, target)).then_some(EpisodeMatch::Pack),
        Claim::Seasons { first, last } => {
            (designated && seasons_hold(first, last, target)).then_some(EpisodeMatch::Pack)
        }
        Claim::Complete => designated.then_some(EpisodeMatch::Pack),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn episodes(season: Option<u32>, first: u32, last: u32) -> Claim {
        Claim::Episodes {
            season,
            first,
            last,
        }
    }

    #[test]
    fn single_episodes_in_every_spelling() {
        let cases = [
            (
                "Breaking.Bad.S01E03.720p.BluRay.x264-DEMAND.mkv",
                episodes(Some(1), 3, 3),
            ),
            ("Breaking Bad S01E03 1080p", episodes(Some(1), 3, 3)),
            ("breaking_bad_s01e03_720p", episodes(Some(1), 3, 3)),
            ("Show S1E3 WEB", episodes(Some(1), 3, 3)),
            ("Show.S01.E03.1080p", episodes(Some(1), 3, 3)),
            ("Show - S01 - E03 - Title", episodes(Some(1), 3, 3)),
            ("Show S01EP03 1080p", episodes(Some(1), 3, 3)),
            ("Show S01 Ep 03", episodes(Some(1), 3, 3)),
            ("Show.1x03.HDTV.XviD", episodes(Some(1), 3, 3)),
            ("Show 01x03 Title", episodes(Some(1), 3, 3)),
            ("Show Season 1 Episode 3", episodes(Some(1), 3, 3)),
            ("Show.Season.01.Episode.03.1080p", episodes(Some(1), 3, 3)),
            ("Show Saison 1 Épisode 3 FRENCH", episodes(Some(1), 3, 3)),
            ("Show Staffel 1 Folge 3 German", episodes(Some(1), 3, 3)),
            ("Show S00E05 Special", episodes(Some(0), 5, 5)),
            (
                "The.Simpsons.S35E1071.1080p",
                episodes(Some(35), 1071, 1071),
            ),
            // numbers in the title stay out of it
            ("9-1-1.S05E03.1080p.WEB.h264", episodes(Some(5), 3, 3)),
            ("The.100.S03E03.720p.HDTV", episodes(Some(3), 3, 3)),
            ("24.S04E03.DVDRip.XviD", episodes(Some(4), 3, 3)),
            ("1883.S01E03.1080p.AMZN.WEB-DL", episodes(Some(1), 3, 3)),
            ("Show.2024.S01E03.1080p", episodes(Some(1), 3, 3)),
            ("Show.S01E03.REPACK.1080p", episodes(Some(1), 3, 3)),
        ];
        for (line, want) in cases {
            assert_eq!(claim_of(line), want, "{line}");
        }
    }

    #[test]
    fn several_episodes() {
        let cases = [
            ("Show.S01E01E02.1080p", episodes(Some(1), 1, 2)),
            ("Show.S01E01-E03.1080p", episodes(Some(1), 1, 3)),
            ("Show.S01E01-03.1080p", episodes(Some(1), 1, 3)),
            ("Show S01E01 E02 E03", episodes(Some(1), 1, 3)),
            ("Show.S01E01-S01E04.720p", episodes(Some(1), 1, 4)),
            ("Show.S01E01-E10.Complete.1080p", episodes(Some(1), 1, 10)),
            ("Show 1x01-1x02 HDTV", episodes(Some(1), 1, 2)),
            ("Show 1x01-02 HDTV", episodes(Some(1), 1, 2)),
            ("Show Season 1 Episode 1-5", episodes(Some(1), 1, 5)),
            ("Show Episodes 1-5", episodes(None, 1, 5)),
            // a resolution after a dash is no episode
            ("Show.S01E01-1080p.WEB", episodes(Some(1), 1, 1)),
            // nor is a run that goes backwards
            ("Show.S01E05-E02", episodes(Some(1), 5, 5)),
        ];
        for (line, want) in cases {
            assert_eq!(claim_of(line), want, "{line}");
        }
    }

    #[test]
    fn season_packs_and_complete_series() {
        let cases = [
            (
                "Show.S01.1080p.BluRay.x264",
                Claim::Seasons { first: 1, last: 1 },
            ),
            (
                "Show S01 COMPLETE 1080p WEB-DL",
                Claim::Seasons { first: 1, last: 1 },
            ),
            ("Show Season 2 1080p", Claim::Seasons { first: 2, last: 2 }),
            ("Show.Season.02.720p", Claim::Seasons { first: 2, last: 2 }),
            ("Show Saison 3 FRENCH", Claim::Seasons { first: 3, last: 3 }),
            (
                "Show 2nd Season [BD 1080p]",
                Claim::Seasons { first: 2, last: 2 },
            ),
            ("Show.S01-S03.1080p", Claim::Seasons { first: 1, last: 3 }),
            ("Show S1-3 720p", Claim::Seasons { first: 1, last: 3 }),
            (
                "Show Seasons 1-5 Complete",
                Claim::Seasons { first: 1, last: 5 },
            ),
            ("Show Season 1 & 2", Claim::Seasons { first: 1, last: 2 }),
            (
                "Show S01 S02 S03 1080p",
                Claim::Seasons { first: 1, last: 3 },
            ),
            ("Show The Complete Series 1080p BluRay", Claim::Complete),
            ("Show COMPLETE 720p", Claim::Complete),
        ];
        for (line, want) in cases {
            assert_eq!(claim_of(line), want, "{line}");
        }
    }

    #[test]
    fn anime_absolute_numbers_and_batches() {
        let cases = [
            (
                "[SubsPlease] Sousou no Frieren - 03 (1080p) [A1B2C3D4].mkv",
                episodes(None, 3, 3),
            ),
            (
                "[Erai-raws] One Piece - 1071 [1080p][Multiple Subtitle].mkv",
                episodes(None, 1071, 1071),
            ),
            (
                "[SubsPlease] Jujutsu Kaisen - 27v2 (720p) [ABCDEF12].mkv",
                episodes(None, 27, 27),
            ),
            ("Bleach - 366 [480p]", episodes(None, 366, 366)),
            (
                "[Judas] Show - 01-12 (Batch) [1080p]",
                episodes(None, 1, 12),
            ),
            ("[Group] Show (01-24) [BD 1080p]", episodes(None, 1, 24)),
            ("[Group] Show [01 ~ 13] [1080p]", episodes(None, 1, 13)),
            ("Show Episode 3 [1080p]", episodes(None, 3, 3)),
            ("Show Ep 03 1080p", episodes(None, 3, 3)),
            ("Show E03 1080p", episodes(None, 3, 3)),
            // a season and the anime's episode
            (
                "[SubsPlease] Mushoku Tensei S2 - 03 (1080p) [ABCD1234].mkv",
                episodes(Some(2), 3, 3),
            ),
            (
                "[Erai-raws] Show 2nd Season - 03 [1080p]",
                episodes(Some(2), 3, 3),
            ),
            (
                "[Group] Show Season 2 - 01-12 [Batch]",
                episodes(Some(2), 1, 12),
            ),
            // years and resolutions after a dash are none
            ("Movie - 2019 [1080p]", Claim::None),
            ("Show - 1080p WEB", Claim::None),
            ("[Group] Show (2019-2021) [BD]", Claim::None),
        ];
        for (line, want) in cases {
            assert_eq!(claim_of(line), want, "{line}");
        }
    }

    #[test]
    fn episode_titles_sizes_and_resolutions_are_no_runs() {
        let cases = [
            // Sonarr's names: the episode, then its title
            (
                "Show - S01E02 - 10 Things I Hate.mkv",
                episodes(Some(1), 2, 2),
            ),
            (
                "Jujutsu Kaisen - S02E01 - 025 - Hidden Inventory [Bluray-1080p].mkv",
                episodes(Some(2), 1, 1),
            ),
            ("Doctor Who - S03E07 - 42.mkv", episodes(Some(3), 7, 7)),
            (
                "24 - S01E01 - 12-00 A.M. - 1-00 A.M..mkv",
                episodes(Some(1), 1, 1),
            ),
            (
                "Show (2019) - S01E01 - 100 Days.mkv",
                episodes(Some(1), 1, 1),
            ),
            (
                "Battlestar Galactica - 1x01 - 33.avi",
                episodes(Some(1), 1, 1),
            ),
            ("Show Episode 3 - 10 Things.mkv", episodes(None, 3, 3)),
            // a resolution or a size after a dash
            ("Show.S01E03-1080.WEB", episodes(Some(1), 3, 3)),
            ("Show S01E03-12.4 GB", episodes(Some(1), 3, 3)),
            (
                "Show S01 - 1080p - 12.4 GB",
                Claim::Seasons { first: 1, last: 1 },
            ),
            (
                "Show S01 1080p WEB-DL - 23 GB",
                Claim::Seasons { first: 1, last: 1 },
            ),
            // still runs: nothing between, or an explicit E or 1x
            ("Show.S01E01-03.1080p", episodes(Some(1), 1, 3)),
            ("Show S01E01 - E03 1080p", episodes(Some(1), 1, 3)),
            ("Show 1x01 - 1x02", episodes(Some(1), 1, 2)),
            ("Show S01E03 & S01E04", episodes(Some(1), 3, 4)),
            ("Show S01E03 & E04", episodes(Some(1), 3, 4)),
        ];
        for (line, want) in cases {
            assert_eq!(claim_of(line), want, "{line}");
        }
    }

    #[test]
    fn seasons_with_a_gap_stand_for_the_first_only() {
        assert_eq!(
            claim_of("Show S01 S03 1080p"),
            Claim::Seasons { first: 1, last: 1 }
        );
        assert_eq!(
            claim_of("Show S03 S01"),
            Claim::Seasons { first: 3, last: 3 }
        );
        assert_eq!(
            claim_of("Show S02 S01 S03"),
            Claim::Seasons { first: 1, last: 3 }
        );
    }

    #[test]
    fn roman_numeral_anime_seasons() {
        assert_eq!(
            claim_of("[SubsPlease] Overlord IV - 03 (1080p) [ABCD1234].mkv"),
            episodes(Some(4), 3, 3)
        );
        assert_eq!(
            claim_of("[SubsPlease] Mob Psycho 100 III - 03 (1080p).mkv"),
            episodes(Some(3), 3, 3)
        );
        // V and X alone are titles, not seasons
        assert_eq!(claim_of("[Group] V - 03 [1080p]"), episodes(None, 3, 3));
    }

    #[test]
    fn lines_that_name_no_episode() {
        for line in [
            "Torrentio",
            "4k DV | HDR",
            "👤 34 💾 4.5 GB ⚙️ ThePirateBay",
            "1080p WEB-DL x265 HEVC",
            "Movie.2019.1080p.BluRay",
            "Daily.Show.2024.10.17.720p.WEB",
            "Movie [1920x1080] 16x9",
            // one digit after the x reads as an aspect ratio (4x3): the scene writes 1x03
            "Show 1x3 HDTV",
            "",
        ] {
            assert_eq!(claim_of(line), Claim::None, "{line}");
        }
    }

    fn target(season: u32, episode: u32) -> VideoTarget {
        VideoTarget {
            season: Some(season),
            episode,
            absolute: None,
        }
    }

    fn described(description: &str) -> StreamText<'_> {
        StreamText {
            description: Some(description),
            ..Default::default()
        }
    }

    const S01E03: VideoTarget = VideoTarget {
        season: Some(1),
        episode: 3,
        absolute: Some(3),
    };

    #[test]
    fn s01e03_never_offers_another_episode() {
        let exact = Some(EpisodeMatch::Exact);
        let cases = [
            ("Show.S01E03.1080p.WEB-DL.mkv", exact),
            ("Show 1x03 720p HDTV", exact),
            ("Show Season 1 Episode 3", exact),
            ("Show.S01E02.1080p.WEB-DL", None),
            ("Show.S01E04.1080p.WEB-DL", None),
            ("Show 1x02 720p", None),
            // a single episode of another season
            ("Show.S02E03.1080p", None),
            ("Show 2x03", None),
            ("Show.S00E03.Special", None),
            // nothing named: kept
            ("1080p WEB-DL", Some(EpisodeMatch::Unknown)),
        ];
        for (description, want) in cases {
            assert_eq!(
                match_episode(&described(description), false, &S01E03),
                want,
                "{description}"
            );
        }
    }

    #[test]
    fn a_pack_counts_only_when_the_addon_names_the_file() {
        let pack = "Show.S01.COMPLETE.1080p.BluRay.x264";
        assert_eq!(match_episode(&described(pack), false, &S01E03), None);
        assert_eq!(
            match_episode(&described(pack), true, &S01E03),
            Some(EpisodeMatch::Pack),
            "fileIdx"
        );
        // the filename says which file: it decides
        let with_file = |filename| StreamText {
            filename: Some(filename),
            description: Some(pack),
            ..Default::default()
        };
        assert_eq!(
            match_episode(
                &with_file("Show.S01E03.1080p.BluRay.x264.mkv"),
                false,
                &S01E03
            ),
            Some(EpisodeMatch::Exact)
        );
        assert_eq!(
            match_episode(
                &with_file("Show.S01E04.1080p.BluRay.x264.mkv"),
                true,
                &S01E03
            ),
            None
        );
        // a filename without an episode still names the file
        assert_eq!(
            match_episode(&with_file("video.mkv"), false, &S01E03),
            Some(EpisodeMatch::Pack)
        );
        // Torrentio's way: the torrent, then the file, on the description's lines
        let torrentio = "Show.S01.1080p.BluRay.x264-GRP\nShow.S01.1080p/Show.S01E03.1080p.BluRay.x264-GRP.mkv\n👤 52 💾 2.3 GB ⚙️ RARBG";
        assert_eq!(
            match_episode(&described(torrentio), false, &S01E03),
            Some(EpisodeMatch::Exact)
        );
        let wrong_file = torrentio.replace("S01E03.1080p", "S01E05.1080p");
        assert_eq!(match_episode(&described(&wrong_file), true, &S01E03), None);
        // a pack of other seasons never holds it
        assert_eq!(
            match_episode(&described("Show.S02-S04.1080p"), true, &S01E03),
            None
        );
        assert_eq!(
            match_episode(&described("Show.S01-S04.1080p"), true, &S01E03),
            Some(EpisodeMatch::Pack)
        );
        assert_eq!(
            match_episode(&described("Show The Complete Series"), false, &S01E03),
            None
        );
        assert_eq!(
            match_episode(&described("Show The Complete Series"), true, &S01E03),
            Some(EpisodeMatch::Pack)
        );
    }

    #[test]
    fn several_episodes_hold_the_ones_they_run_over() {
        // a run in the release's name is a pack: it needs the file
        assert_eq!(
            match_episode(&described("Show.S01E01-E05.1080p"), false, &S01E03),
            None
        );
        assert_eq!(
            match_episode(&described("Show.S01E01-E05.1080p"), true, &S01E03),
            Some(EpisodeMatch::Pack)
        );
        assert_eq!(
            match_episode(&described("Show.S01E04-E06.1080p"), true, &S01E03),
            None
        );
        // a file of two episodes is that file
        let double = StreamText {
            filename: Some("Show.S01E02E03.1080p.mkv"),
            ..Default::default()
        };
        assert_eq!(
            match_episode(&double, false, &S01E03),
            Some(EpisodeMatch::Pack)
        );
        assert_eq!(match_episode(&double, false, &target(1, 4)), None);
    }

    #[test]
    fn the_file_wins_over_the_release() {
        // the release says one episode, the file another: the file is what plays
        let text = StreamText {
            filename: Some("Show.S01E03.mkv"),
            description: Some("Show.S01E01.1080p"),
            ..Default::default()
        };
        assert_eq!(
            match_episode(&text, false, &S01E03),
            Some(EpisodeMatch::Exact)
        );
        // a file line without an episode leaves it to the release
        let text = described("Show.S01E02.1080p\nvideo.mkv");
        assert_eq!(match_episode(&text, true, &S01E03), None);
    }

    #[test]
    fn anime_numbering() {
        // a first season: absolute and episode numbers agree
        let frieren = "[SubsPlease] Sousou no Frieren - 03 (1080p) [A1B2C3D4].mkv";
        assert_eq!(
            match_episode(&described(frieren), false, &S01E03),
            Some(EpisodeMatch::Exact)
        );
        assert_eq!(
            match_episode(&described(frieren), false, &target(1, 4)),
            None
        );
        // the second season's third episode is the 31st: "- 03" is the first season's
        let s02e03 = VideoTarget {
            season: Some(2),
            episode: 3,
            absolute: Some(31),
        };
        assert_eq!(match_episode(&described(frieren), false, &s02e03), None);
        let absolute = "[SubsPlease] Sousou no Frieren - 31 (1080p).mkv";
        assert_eq!(
            match_episode(&described(absolute), false, &s02e03),
            Some(EpisodeMatch::Exact)
        );
        // without the absolute number known, a later season's episode stays out
        assert_eq!(
            match_episode(&described(absolute), false, &target(2, 3)),
            None
        );
        // a season named with the anime's number
        let named = "[SubsPlease] Mushoku Tensei S2 - 03 (1080p).mkv";
        assert_eq!(
            match_episode(&described(named), false, &target(2, 3)),
            Some(EpisodeMatch::Exact)
        );
        assert_eq!(match_episode(&described(named), false, &S01E03), None);
        // an anime id: Kitsu numbers each entry from one, so only episodes compare
        let kitsu =
            VideoTarget::for_request("series", "kitsu:46474:3", Some(1), Some(3), None).unwrap();
        assert_eq!(kitsu.season, None);
        assert_eq!(
            match_episode(&described(named), false, &kitsu),
            Some(EpisodeMatch::Exact)
        );
        assert_eq!(
            match_episode(&described(frieren), false, &kitsu),
            Some(EpisodeMatch::Exact)
        );
        let one_piece =
            VideoTarget::for_request("series", "kitsu:12:1071", None, None, None).unwrap();
        assert_eq!(
            match_episode(
                &described("[Erai-raws] One Piece - 1071 [1080p].mkv"),
                false,
                &one_piece
            ),
            Some(EpisodeMatch::Exact)
        );
        assert_eq!(
            match_episode(
                &described("[Erai-raws] One Piece - 1070 [1080p].mkv"),
                false,
                &one_piece
            ),
            None
        );
        // a batch is a pack
        let batch = "[Judas] Sousou no Frieren - 01-28 (Batch) [1080p]";
        assert_eq!(match_episode(&described(batch), false, &S01E03), None);
        assert_eq!(
            match_episode(&described(batch), true, &S01E03),
            Some(EpisodeMatch::Pack)
        );
    }

    #[test]
    fn a_pack_file_takes_its_folder_s_season() {
        let pack = |file: &str| format!("Show.Complete.1080p.BluRay\n{file}");
        let s02e03 = target(2, 3);
        let text = pack("Show.Complete.1080p/Season 2/Episode 03.mkv");
        assert_eq!(
            match_episode(&described(&text), true, &s02e03),
            Some(EpisodeMatch::Exact)
        );
        assert_eq!(
            match_episode(&described(&text), true, &S01E03),
            None,
            "season 2's file"
        );
        let text = pack("Show/S02/Show - 03.mkv");
        assert_eq!(
            match_episode(&described(&text), true, &s02e03),
            Some(EpisodeMatch::Exact)
        );
    }

    #[test]
    fn a_file_line_alone_does_not_pick_a_pack_s_file() {
        // the engine plays the largest file of a torrent without fileIdx or filename,
        // whatever the description says
        let text = described("Show.S01.1080p.BluRay.x264-GRP\nShow.S01.1080p.BluRay.x264-GRP.mkv");
        assert_eq!(match_episode(&text, false, &S01E03), None);
        assert_eq!(
            match_episode(&text, true, &S01E03),
            Some(EpisodeMatch::Pack)
        );
        // a file line that names the episode decides
        let text = described("Show.S01.1080p.BluRay.x264-GRP\nShow.S01E03.1080p.mkv");
        assert_eq!(
            match_episode(&text, false, &S01E03),
            Some(EpisodeMatch::Exact)
        );
    }

    #[test]
    fn targets_from_the_request() {
        assert_eq!(
            VideoTarget::for_request("series", "tt0944947:1:3", None, None, None),
            Some(target(1, 3))
        );
        assert_eq!(
            VideoTarget::for_request("series", "tt0944947:1:3", Some(2), Some(5), Some(15)),
            Some(VideoTarget {
                season: Some(2),
                episode: 5,
                absolute: Some(15)
            }),
            "the UI's numbers win"
        );
        assert_eq!(
            VideoTarget::for_request("series", "tmdb:1399:1:3", None, None, None),
            Some(target(1, 3))
        );
        assert_eq!(
            VideoTarget::for_request("anime", "mal:5114:7", None, None, None),
            Some(VideoTarget {
                season: None,
                episode: 7,
                absolute: None
            })
        );
        assert_eq!(
            VideoTarget::for_request("movie", "tt0111161", None, None, None),
            None
        );
        assert_eq!(
            VideoTarget::for_request("movie", "tt0111161", None, Some(1), None),
            None
        );
        assert_eq!(
            VideoTarget::for_request("tv", "tv:1", None, Some(1), None),
            None
        );
        assert_eq!(
            VideoTarget::for_request("series", "tt0944947", None, None, None),
            None
        );
        assert_eq!(
            VideoTarget::for_request("series", "custom:abc", None, None, None),
            None
        );
    }
}
