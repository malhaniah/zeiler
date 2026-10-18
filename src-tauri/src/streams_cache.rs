//! An in-memory cache of the stream fan-out, so the player's Streams menu and the next
//! episode's lookup reuse the stream picker's answer rather than ask the addons again.
//! Keyed by the addons in effect (their transport URLs, in order) and the type and video
//! id, so a profile switch or an added, removed or reordered addon asks again. An answer
//! is kept for [`TTL`], one in which an addon failed only for [`TTL_WITH_ERRORS`] (a
//! timeout is soon tried again), and one in which every addon failed not at all; at most
//! [`CAPACITY`] answers, the oldest going first. A reader may want a younger answer (the
//! picker takes one up to 2 min old: seeders and debrid availability change, and
//! opening it again is how a user asks again). Answers are kept as the addons sent them: the ranking and
//! the episode filter run on every request. Nothing is written to disk.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use url::Url;
use zeiler_addon::AddonStreams;

/// Long enough for the Streams menu of a film to find the picker's answer.
pub const TTL: Duration = Duration::from_secs(60 * 60);
pub const TTL_WITH_ERRORS: Duration = Duration::from_secs(60);
pub const CAPACITY: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct StreamsKey {
    pub addons: Vec<Url>,
    pub r#type: String,
    pub id: String,
}

#[derive(Default)]
pub struct StreamsCache {
    answers: Mutex<HashMap<StreamsKey, (Instant, Vec<AddonStreams>)>>,
}

/// How long `answer` stays fresh.
fn ttl(answer: &[AddonStreams]) -> Duration {
    if answer.iter().any(|g| g.error.is_some()) {
        TTL_WITH_ERRORS
    } else {
        TTL
    }
}

fn fresh(at: Instant, answer: &[AddonStreams], now: Instant) -> bool {
    now.saturating_duration_since(at) < ttl(answer)
}

impl StreamsCache {
    /// The cached answer for `key`, while it is fresh and, with `max_age`, no older.
    pub fn get(
        &self,
        key: &StreamsKey,
        max_age: Option<Duration>,
        now: Instant,
    ) -> Option<Vec<AddonStreams>> {
        let answers = self.answers.lock().unwrap_or_else(|e| e.into_inner());
        answers
            .get(key)
            .filter(|(at, answer)| fresh(*at, answer, now))
            .filter(|(at, _)| max_age.is_none_or(|age| now.saturating_duration_since(*at) < age))
            .map(|(_, answer)| answer.clone())
    }

    /// Keeps `answer`, unless every addon in it failed.
    pub fn put(&self, key: StreamsKey, answer: Vec<AddonStreams>, now: Instant) {
        if !answer.is_empty() && answer.iter().all(|g| g.error.is_some()) {
            return;
        }
        let mut answers = self.answers.lock().unwrap_or_else(|e| e.into_inner());
        answers.retain(|_, (at, answer)| fresh(*at, answer, now));
        if !answers.contains_key(&key)
            && answers.len() >= CAPACITY
            && let Some(oldest) = answers
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone())
        {
            answers.remove(&oldest);
        }
        answers.insert(key, (now, answer));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl StreamsCache {
        fn get_any(&self, key: &StreamsKey, now: Instant) -> Option<Vec<AddonStreams>> {
            self.get(key, None, now)
        }
    }

    fn key(id: &str, addons: &[&str]) -> StreamsKey {
        StreamsKey {
            addons: addons.iter().map(|a| Url::parse(a).unwrap()).collect(),
            r#type: "series".into(),
            id: id.into(),
        }
    }

    fn answer(error: Option<&str>) -> Vec<AddonStreams> {
        vec![AddonStreams {
            transport_url: Url::parse("https://a.example/manifest.json").unwrap(),
            addon_name: "A".into(),
            streams: Vec::new(),
            error: error.map(str::to_string),
        }]
    }

    const A: &str = "https://a.example/manifest.json";
    const B: &str = "https://b.example/manifest.json";

    #[test]
    fn an_answer_is_served_until_it_expires() {
        let cache = StreamsCache::default();
        let start = Instant::now();
        cache.put(key("tt1:1:3", &[A]), answer(None), start);
        let later = start + Duration::from_secs(5 * 60);
        assert!(cache.get_any(&key("tt1:1:3", &[A]), later).is_some());
        assert!(cache.get_any(&key("tt1:1:3", &[A]), start + TTL).is_none());
        assert!(
            cache.get_any(&key("tt1:1:4", &[A]), start).is_none(),
            "another video"
        );
    }

    #[test]
    fn other_addons_ask_again() {
        let cache = StreamsCache::default();
        let start = Instant::now();
        cache.put(key("tt1:1:3", &[A, B]), answer(None), start);
        assert!(
            cache.get_any(&key("tt1:1:3", &[A]), start).is_none(),
            "one removed"
        );
        assert!(
            cache.get_any(&key("tt1:1:3", &[B, A]), start).is_none(),
            "reordered"
        );
        assert!(cache.get_any(&key("tt1:1:3", &[A, B]), start).is_some());
    }

    #[test]
    fn an_answer_with_a_failed_addon_is_kept_briefly() {
        let cache = StreamsCache::default();
        let start = Instant::now();
        let one_failed = [answer(None), answer(Some("timed out"))].concat();
        cache.put(key("tt1:1:3", &[A, B]), one_failed, start);
        let soon = start + Duration::from_secs(30);
        assert!(cache.get_any(&key("tt1:1:3", &[A, B]), soon).is_some());
        let later = start + TTL_WITH_ERRORS;
        assert!(cache.get_any(&key("tt1:1:3", &[A, B]), later).is_none());
    }

    #[test]
    fn an_answer_in_which_every_addon_failed_is_not_kept() {
        let cache = StreamsCache::default();
        let start = Instant::now();
        cache.put(key("tt1:1:3", &[A]), answer(Some("timed out")), start);
        let all_failed = [answer(Some("x")), answer(Some("y"))].concat();
        cache.put(key("tt1:1:4", &[A, B]), all_failed, start);
        assert!(cache.get_any(&key("tt1:1:3", &[A]), start).is_none());
        assert!(cache.get_any(&key("tt1:1:4", &[A, B]), start).is_none());
        // no addon serves it: nothing to ask again until the addons change
        cache.put(key("tt1:1:5", &[A]), Vec::new(), start);
        assert!(cache.get_any(&key("tt1:1:5", &[A]), start).is_some());
    }

    #[test]
    fn the_picker_wants_a_younger_answer() {
        const PICKER_MAX_AGE: Duration = Duration::from_secs(120);
        let cache = StreamsCache::default();
        let start = Instant::now();
        cache.put(key("tt1:1:3", &[A]), answer(None), start);
        let later = start + PICKER_MAX_AGE;
        assert!(
            cache
                .get(&key("tt1:1:3", &[A]), Some(PICKER_MAX_AGE), later)
                .is_none()
        );
        assert!(
            cache.get(&key("tt1:1:3", &[A]), None, later).is_some(),
            "the menu's"
        );
    }

    #[test]
    fn the_oldest_answer_makes_room() {
        let cache = StreamsCache::default();
        let start = Instant::now();
        for i in 0..CAPACITY {
            let at = start + Duration::from_millis(i as u64);
            cache.put(key(&format!("tt{i}"), &[A]), answer(None), at);
        }
        let later = start + Duration::from_secs(1);
        cache.put(key("tt-new", &[A]), answer(None), later);
        assert!(
            cache.get_any(&key("tt0", &[A]), later).is_none(),
            "oldest evicted"
        );
        assert!(cache.get_any(&key("tt1", &[A]), later).is_some());
        assert!(cache.get_any(&key("tt-new", &[A]), later).is_some());
        assert_eq!(cache.answers.lock().unwrap().len(), CAPACITY);
    }
}
