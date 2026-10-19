// Android TV prototype: Zeiler's player on Android, Media3 ExoPlayer in a SurfaceView
// under the transparent WebView, driven by the Rust shell (src-tauri/src/commands/mpv/
// android.rs). The plugin takes mpv's names (properties, commands and events), so the
// page's player screen drives it unchanged. Not for merging; see
// docs/plan/android-tv-prototype.md.
package io.zeiler.desktop

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaLibraryInfo
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.SubtitleView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import org.json.JSONObject

@InvokeArg
class OpenArgs {
  lateinit var events: Channel
}

@InvokeArg
class LoadArgs {
  lateinit var url: String
  var title: String? = null
  var headers: List<List<String>> = emptyList()
  var userAgent: String? = null
  var referrer: String? = null
  var startAtSec: Double? = null
  var options: List<List<String>> = emptyList()
}

@InvokeArg
class PropertyArgs {
  lateinit var name: String
  // a JSON scalar: Boolean, a Number or a String (mpv's track ids come as either)
  var value: Any? = null
}

private fun Any?.asBoolean(): Boolean? = this as? Boolean
private fun Any?.asDouble(): Double? = (this as? Number)?.toDouble() ?: (this as? String)?.toDoubleOrNull()
private fun Any?.asText(): String? = when (this) {
  null -> null
  is Number -> if (toDouble() % 1.0 == 0.0) toLong().toString() else toString()
  else -> toString()
}

@InvokeArg
class CommandArgs {
  var args: List<String> = emptyList()
}

@InvokeArg
class GeometryArgs {
  var x: Double = 0.0
  var y: Double = 0.0
  var width: Double = 0.0
  var height: Double = 0.0
}

private const val TAG = "ZeilerTvPlayer"

/** One entry of the track list as mpv numbers it (per type, from 1). */
private class TrackRef(val type: String, val id: Int, val group: TrackGroup, val index: Int)

/** The page's video box, in the WebView's px (null: the whole WebView). */
private class Box(val x: Int, val y: Int, val width: Int, val height: Int)

@OptIn(UnstableApi::class)
@TauriPlugin
class TvPlayerPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())
  private var webView: WebView? = null

  private var player: ExoPlayer? = null
  private var surface: SurfaceView? = null
  private var subtitles: SubtitleView? = null
  private var events: Channel? = null

  /** What the current file was loaded from: an added subtitle rebuilds it. */
  private var item: MediaItem? = null
  private var sourceFactory: DefaultMediaSourceFactory? = null
  private var addedSubtitles = mutableListOf<MediaItem.SubtitleConfiguration>()
  /** sub-add's file per subtitle configuration id: mpv's external-filename */
  private var addedPaths = mutableMapOf<String, String>()
  /** sub-add … select: picked once Media3 lists the new track */
  private var pendingSelect: String? = null
  private var lastTracks: JSArray = JSArray()
  private val lastSelected = mutableMapOf("video" to "no", "audio" to "no", "sub" to "no")

  private var fileLoaded = false
  private var seeking = false
  private var volume = 100.0
  private var muted = false
  private var box: Box? = null
  private var videoSize = VideoSize.UNKNOWN
  private var trackRefs = listOf<TrackRef>()
  private var videoDecoder: String? = null
  private var lastTime = -1.0
  private var lastCache = -1.0
  private var lastDuration: Double? = null

  override fun load(webView: WebView) {
    this.webView = webView
  }

  /** ExoPlayer and the views live on the main thread; Tauri calls in on its own. */
  private fun onMain(invoke: Invoke, block: () -> Unit) {
    main.post {
      try {
        block()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  // --- commands ----------------------------------------------------------------------

  @Command
  fun open(invoke: Invoke) {
    val args = invoke.parseArgs(OpenArgs::class.java)
    onMain(invoke) {
      release()
      val web = webView ?: throw IllegalStateException("The WebView is not ready.")
      val parent = web.parent as? FrameLayout
        ?: throw IllegalStateException("The WebView is not in a FrameLayout.")
      // under the page: the video, then the subtitles; the page's transparent pixels
      // show them (SurfaceView punches through the window)
      val video = SurfaceView(activity).apply {
        isFocusable = false
        keepScreenOn = true
      }
      val text = SubtitleView(activity).apply {
        isFocusable = false
        setApplyEmbeddedStyles(true)
        setApplyEmbeddedFontSizes(true)
      }
      parent.addView(video, 0, FrameLayout.LayoutParams(1, 1))
      parent.addView(text, 1, FrameLayout.LayoutParams(1, 1))
      web.setBackgroundColor(Color.TRANSPARENT)

      val exo = ExoPlayer.Builder(activity)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build(),
          true,
        )
        .setHandleAudioBecomingNoisy(true)
        .build()
      exo.setVideoSurfaceView(video)
      exo.addListener(listener)
      exo.addAnalyticsListener(analytics)
      player = exo
      surface = video
      subtitles = text
      events = args.events
      volume = 100.0
      muted = false
      layoutVideo()
      main.post(ticker)
      emitProperty("pause", false)
      emitProperty("volume", volume)
      emitProperty("mute", false)
      emitProperty("speed", 1.0)
      invoke.resolve()
    }
  }

  @Command
  fun load(invoke: Invoke) {
    val args = invoke.parseArgs(LoadArgs::class.java)
    onMain(invoke) {
      val exo = player ?: throw IllegalStateException("The player is not open.")
      val headers = args.headers.filter { it.size == 2 }.associate { it[0] to it[1] }.toMutableMap()
      args.referrer?.let { headers["Referer"] = it }
      val http = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setDefaultRequestProperties(headers)
        .setUserAgent(args.userAgent ?: "Zeiler")
        .setConnectTimeoutMs(30_000)
        .setReadTimeoutMs(30_000)
      // file:// for subtitles the shell wrote to its cache, http(s) for the stream
      val factory = DefaultMediaSourceFactory(DefaultDataSource.Factory(activity, http))
      val media = MediaItem.Builder()
        .setUri(args.url)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(args.title).build())
        .build()
      applyOptions(exo, args.options.filter { it.size == 2 }.associate { it[0] to it[1] })
      item = media
      sourceFactory = factory
      addedSubtitles = mutableListOf()
      addedPaths = mutableMapOf()
      fileLoaded = false
      seeking = false
      lastTime = -1.0
      lastDuration = null
      emit("start-file")
      emitProperty("eof-reached", false)
      emitProperty("media-title", args.title ?: args.url.substringAfterLast('/'))
      val startMs = ((args.startAtSec ?: 0.0) * 1000).toLong()
      exo.setMediaSource(factory.createMediaSource(media), startMs)
      exo.prepare()
      exo.playWhenReady = true
      invoke.resolve()
    }
  }

  @Command
  fun setProperty(invoke: Invoke) {
    val args = invoke.parseArgs(PropertyArgs::class.java)
    Log.d(TAG, "set ${args.name}=${args.value}")
    onMain(invoke) {
      val exo = player ?: throw IllegalStateException("Nothing is playing.")
      val value = args.value
      when (args.name) {
        "pause" -> exo.playWhenReady = !(value?.asBoolean() ?: false)
        "volume" -> {
          volume = value?.asDouble() ?: volume
          applyVolume(exo)
          emitProperty("volume", volume)
        }
        "mute" -> {
          muted = value?.asBoolean() ?: false
          applyVolume(exo)
          emitProperty("mute", muted)
        }
        "speed" -> exo.setPlaybackSpeed((value?.asDouble() ?: 1.0).toFloat())
        "time-pos" -> exo.seekTo(((value?.asDouble() ?: 0.0) * 1000).toLong())
        "aid", "sid", "vid" -> selectTrack(exo, args.name, value?.asText() ?: "auto")
        "sub-visibility" ->
          subtitles?.visibility = if (value?.asBoolean() != false) View.VISIBLE else View.INVISIBLE
        "sub-scale" ->
          subtitles?.setFractionalTextSize(
            SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * (value?.asDouble() ?: 1.0).toFloat()
          )
        // a full-window player on a TV
        "fullscreen" -> {}
        else -> {
          invoke.reject("The TV player can't set ${args.name}.")
          return@onMain
        }
      }
      invoke.resolve()
    }
  }

  @Command
  fun command(invoke: Invoke) {
    val args = invoke.parseArgs(CommandArgs::class.java).args
    Log.d(TAG, "command ${args.firstOrNull()} (${args.size} args)")
    onMain(invoke) {
      val exo = player ?: throw IllegalStateException("Nothing is playing.")
      when (args.firstOrNull()) {
        "seek" -> seek(exo, args.getOrNull(1)?.toDouble() ?: 0.0, args.getOrNull(2) ?: "relative")
        "cycle" -> when (args.getOrNull(1)) {
          "pause" -> exo.playWhenReady = !exo.playWhenReady
          "sid" -> cycleSubtitles(exo)
          else -> {
            invoke.reject("The TV player can't cycle ${args.getOrNull(1)}.")
            return@onMain
          }
        }
        "stop" -> {
          exo.stop()
          emit("end-file", JSObject().put("reason", "stop"))
        }
        // sub-add <file> [select|auto|cached] [title] [lang]
        "sub-add" -> addSubtitle(exo, args)
        else -> {
          invoke.reject("The TV player can't run ${args.firstOrNull()}.")
          return@onMain
        }
      }
      invoke.resolve()
    }
  }

  @Command
  fun getProperty(invoke: Invoke) {
    val name = invoke.parseArgs(PropertyArgs::class.java).name
    onMain(invoke) {
      val exo = player
      val value: Any? = if (exo == null) null else when (name) {
        "time-pos" -> exo.currentPosition / 1000.0
        "duration" -> duration(exo)
        "pause" -> !exo.playWhenReady
        "volume" -> volume
        "mute" -> muted
        "speed" -> exo.playbackParameters.speed.toDouble()
        "video-codec" -> exo.videoFormat?.let { it.codecs ?: it.sampleMimeType }
        "audio-codec" -> exo.audioFormat?.let { it.codecs ?: it.sampleMimeType }
        // the MediaCodec decoder: c2.android.* / OMX.google.* are software
        "hwdec-current" -> videoDecoder
        "container-fps" -> exo.videoFormat?.frameRate?.takeIf { it > 0 }?.toDouble()
        "video-bitrate" -> exo.videoFormat?.bitrate?.takeIf { it > 0 }?.toDouble()
        "audio-bitrate" -> exo.audioFormat?.bitrate?.takeIf { it > 0 }?.toDouble()
        "frame-drop-count" -> exo.videoDecoderCounters?.droppedBufferCount
        "demuxer-cache-duration" -> (exo.bufferedPosition - exo.currentPosition) / 1000.0
        "mpv-version" -> "Media3 ${MediaLibraryInfo.VERSION}"
        "track-list" -> lastTracks
        "aid" -> lastSelected["audio"]
        "sid" -> lastSelected["sub"]
        "vid" -> lastSelected["video"]
        else -> null
      }
      invoke.resolve(JSObject().put("value", value ?: JSONObject.NULL))
    }
  }

  @Command
  fun setGeometry(invoke: Invoke) {
    val g = invoke.parseArgs(GeometryArgs::class.java)
    onMain(invoke) {
      box = if (g.width >= 1 && g.height >= 1) {
        Box(g.x.toInt(), g.y.toInt(), g.width.toInt(), g.height.toInt())
      } else {
        null
      }
      layoutVideo()
      invoke.resolve()
    }
  }

  @Command
  fun quit(invoke: Invoke) {
    onMain(invoke) {
      release()
      invoke.resolve()
    }
  }

  // --- the player --------------------------------------------------------------------

  private fun release() {
    main.removeCallbacks(ticker)
    player?.let {
      it.removeListener(listener)
      it.removeAnalyticsListener(analytics)
      it.release()
    }
    player = null
    surface?.let { (it.parent as? ViewGroup)?.removeView(it) }
    subtitles?.let { (it.parent as? ViewGroup)?.removeView(it) }
    surface = null
    subtitles = null
    item = null
    box = null
    videoSize = VideoSize.UNKNOWN
    trackRefs = listOf()
    videoDecoder = null
    // the replaced session's Rust side forgets it on this
    events?.let { emitOn(it, JSObject().put("type", "shutdown")) }
    events = null
  }

  private fun duration(exo: ExoPlayer): Double? =
    exo.duration.takeIf { it != C.TIME_UNSET && !exo.isCurrentMediaItemLive }?.let { it / 1000.0 }

  private fun applyVolume(exo: ExoPlayer) {
    // Media3 can't amplify: mpv's 100–200 % is 100 % here (a TV has its own volume)
    exo.volume = if (muted) 0f else (volume.coerceIn(0.0, 100.0) / 100.0).toFloat()
  }

  /** The shell's pre-load options: alang/slang (mpv language lists) and sid=no. */
  private fun applyOptions(exo: ExoPlayer, options: Map<String, String>) {
    fun languages(name: String) =
      options[name]?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.toTypedArray() ?: arrayOf()
    exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
      .clearOverrides()
      .setPreferredAudioLanguages(*languages("alang"))
      .setPreferredTextLanguages(*languages("slang"))
      .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, options["sid"] == "no")
      .build()
  }

  private fun seek(exo: ExoPlayer, amount: Double, flags: String) {
    val durationMs = exo.duration.takeIf { it != C.TIME_UNSET }
    val flag = flags.split('+')
    val targetMs = when {
      "absolute-percent" in flag -> (durationMs ?: 0) * amount / 100.0
      "relative-percent" in flag -> exo.currentPosition + (durationMs ?: 0) * amount / 100.0
      "absolute" in flag -> amount * 1000.0
      else -> exo.currentPosition + amount * 1000.0
    }
    val max = durationMs ?: Long.MAX_VALUE
    exo.seekTo(targetMs.toLong().coerceIn(0L, max))
  }

  private fun trackType(type: String) = when (type) {
    "audio" -> C.TRACK_TYPE_AUDIO
    "sub" -> C.TRACK_TYPE_TEXT
    else -> C.TRACK_TYPE_VIDEO
  }

  private fun selectTrack(exo: ExoPlayer, property: String, value: String) {
    val type = when (property) {
      "aid" -> "audio"
      "sid" -> "sub"
      else -> "video"
    }
    val trackType = trackType(type)
    val params = exo.trackSelectionParameters.buildUpon()
    when (value) {
      "no" -> params.setTrackTypeDisabled(trackType, true)
      "auto" -> params.setTrackTypeDisabled(trackType, false).clearOverridesOfType(trackType)
      else -> {
        val ref = trackRefs.find { it.type == type && it.id.toString() == value }
          ?: throw IllegalArgumentException("There is no track $value.")
        // a track with no decoder and no passthrough here would stop playback (Media3
        // fails the renderer), so it is refused and the current one keeps playing
        val supported = exo.currentTracks.groups
          .find { it.mediaTrackGroup == ref.group }
          ?.isTrackSupported(ref.index) ?: false
        if (!supported) throw IllegalArgumentException("This device can't play that track.")
        params.setTrackTypeDisabled(trackType, false)
          .setOverrideForType(TrackSelectionOverride(ref.group, ref.index))
      }
    }
    exo.trackSelectionParameters = params.build()
  }

  private fun cycleSubtitles(exo: ExoPlayer) {
    val subs = trackRefs.filter { it.type == "sub" }
    if (subs.isEmpty()) return
    val disabled = exo.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
    val current = if (disabled) null else exo.currentTracks.groups
      .filter { it.type == C.TRACK_TYPE_TEXT }
      .flatMap { g -> (0 until g.length).filter { g.isTrackSelected(it) }.map { g.mediaTrackGroup to it } }
      .firstOrNull()
    val at = subs.indexOfFirst { current != null && it.group == current.first && it.index == current.second }
    // mpv's order: off → 1 → 2 … → off
    if (at == subs.size - 1) selectTrack(exo, "sid", "no")
    else selectTrack(exo, "sid", subs[at + 1].id.toString())
  }

  /** sub-add: Media3 takes a side-loaded subtitle only with the media item, so the
   *  item is rebuilt with it and prepared again at the same position. */
  private fun addSubtitle(exo: ExoPlayer, args: List<String>) {
    val path = args.getOrNull(1) ?: throw IllegalArgumentException("sub-add needs a file.")
    val media = item ?: throw IllegalStateException("Nothing is playing.")
    val factory = sourceFactory ?: throw IllegalStateException("Nothing is playing.")
    val uri = if (path.contains("://")) Uri.parse(path) else Uri.fromFile(File(path))
    val mime = when (path.substringAfterLast('.').lowercase()) {
      "vtt" -> MimeTypes.TEXT_VTT
      "ass", "ssa" -> MimeTypes.TEXT_SSA
      "ttml", "xml", "dfxp" -> MimeTypes.APPLICATION_TTML
      else -> MimeTypes.APPLICATION_SUBRIP
    }
    val select = args.getOrNull(2) == "select"
    val id = "external:${addedSubtitles.size + 1}"
    addedPaths[id] = path
    if (select) pendingSelect = id
    val subtitle = MediaItem.SubtitleConfiguration.Builder(uri)
      .setId(id)
      .setMimeType(mime)
      .setLabel(args.getOrNull(3))
      .setLanguage(args.getOrNull(4))
      .setSelectionFlags(if (select) C.SELECTION_FLAG_DEFAULT else 0)
      .build()
    addedSubtitles.add(subtitle)
    val rebuilt = media.buildUpon().setSubtitleConfigurations(addedSubtitles.toList()).build()
    item = rebuilt
    val position = exo.currentPosition
    val playing = exo.playWhenReady
    exo.setMediaSource(factory.createMediaSource(rebuilt), position)
    exo.prepare()
    exo.playWhenReady = playing
  }

  /** The video keeps its aspect ratio inside the page's box, as mpv letterboxes. */
  private fun layoutVideo() {
    val video = surface ?: return
    val web = webView ?: return
    val area = box ?: Box(0, 0, web.width.coerceAtLeast(1), web.height.coerceAtLeast(1))
    var width = area.width
    var height = area.height
    if (videoSize.width > 0 && videoSize.height > 0) {
      val aspect = videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height
      if (area.width.toFloat() / area.height > aspect) width = (area.height * aspect).toInt()
      else height = (area.width / aspect).toInt()
    }
    val left = web.left + area.x + (area.width - width) / 2
    val top = web.top + area.y + (area.height - height) / 2
    video.layoutParams = FrameLayout.LayoutParams(width, height).apply {
      leftMargin = left
      topMargin = top
    }
    subtitles?.layoutParams = FrameLayout.LayoutParams(width, height).apply {
      leftMargin = left
      topMargin = top
    }
  }

  // (subtitles parsed while extracting carry their original MIME type in `codecs`)
  private fun codecName(format: Format): String? = when (
    if (format.sampleMimeType == MimeTypes.APPLICATION_MEDIA3_CUES) format.codecs else format.sampleMimeType
  ) {
    MimeTypes.VIDEO_H265 -> "hevc"
    MimeTypes.VIDEO_H264 -> "h264"
    MimeTypes.VIDEO_AV1 -> "av1"
    MimeTypes.VIDEO_VP9 -> "vp9"
    MimeTypes.VIDEO_DOLBY_VISION -> "dvhe"
    MimeTypes.AUDIO_AAC -> "aac"
    MimeTypes.AUDIO_AC3 -> "ac3"
    MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "eac3"
    MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD -> "dts"
    MimeTypes.AUDIO_TRUEHD -> "truehd"
    MimeTypes.AUDIO_OPUS -> "opus"
    MimeTypes.AUDIO_FLAC -> "flac"
    MimeTypes.AUDIO_MPEG -> "mp3"
    MimeTypes.APPLICATION_SUBRIP -> "subrip"
    MimeTypes.TEXT_SSA -> "ass"
    MimeTypes.TEXT_VTT -> "webvtt"
    MimeTypes.APPLICATION_PGS -> "hdmv_pgs_subtitle"
    MimeTypes.APPLICATION_VOBSUB -> "dvd_subtitle"
    else -> format.codecs ?: format.sampleMimeType
  }

  /** Media3's tracks as mpv's track-list, with aid/sid/vid. */
  private fun publishTracks(tracks: Tracks) {
    val list = JSArray()
    val refs = mutableListOf<TrackRef>()
    val counts = mutableMapOf("video" to 0, "audio" to 0, "sub" to 0)
    val selected = mutableMapOf("video" to "no", "audio" to "no", "sub" to "no")
    for (group in tracks.groups) {
      val type = when (group.type) {
        C.TRACK_TYPE_VIDEO -> "video"
        C.TRACK_TYPE_AUDIO -> "audio"
        C.TRACK_TYPE_TEXT -> "sub"
        else -> continue
      }
      for (i in 0 until group.length) {
        val format = group.getTrackFormat(i)
        val id = counts.getValue(type) + 1
        counts[type] = id
        val externalId = format.id?.let { Regex("external:\\d+").find(it)?.value }
        val external = externalId != null
        val entry = JSObject()
          .put("id", id)
          .put("type", type)
          .put("selected", group.isTrackSelected(i))
          .put("default", format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0)
          .put("forced", format.selectionFlags and C.SELECTION_FLAG_FORCED != 0)
          .put("external", external)
        format.language?.takeIf { it != C.LANGUAGE_UNDETERMINED }?.let { entry.put("lang", it) }
        format.label?.let { entry.put("title", it) }
        externalId?.let { addedPaths[it] }?.let { entry.put("external-filename", it) }
        codecName(format)?.let { entry.put("codec", it) }
        if (type == "video" && format.width > 0) entry.put("demux-w", format.width).put("demux-h", format.height)
        if (type == "audio" && format.channelCount > 0) entry.put("demux-channel-count", format.channelCount)
        if (format.bitrate > 0) entry.put("demux-bitrate", format.bitrate)
        // not decodable here (no decoder, no passthrough): shown, but Media3 skips it
        if (!group.isTrackSupported(i)) entry.put("zeiler-unsupported", true)
        list.put(entry)
        refs.add(TrackRef(type, id, group.mediaTrackGroup, i))
        if (group.isTrackSelected(i)) selected[type] = id.toString()
        Log.d(TAG, "track $type #$id formatId=${format.id} lang=${format.language} selected=${group.isTrackSelected(i)} supported=${group.isTrackSupported(i)}")
      }
    }
    trackRefs = refs
    // mpv selects a track added with `select`: Media3 would keep its own pick
    pendingSelect?.let { pending ->
      val group = tracks.groups.firstOrNull { g ->
        g.type == C.TRACK_TYPE_TEXT && (0 until g.length).any { g.getTrackFormat(it).id?.contains(pending) == true }
      } ?: return@let
      pendingSelect = null
      val index = (0 until group.length).first { group.getTrackFormat(it).id?.contains(pending) == true }
      player?.let { exo ->
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
          .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
          .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
          .build()
      }
    }
    lastTracks = list
    lastSelected.putAll(selected)
    emitProperty("track-list", list)
    emitProperty("vid", selected["video"])
    emitProperty("aid", selected["audio"])
    emitProperty("sid", selected["sub"])
  }

  private val listener = object : Player.Listener {
    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      emitProperty("pause", !playWhenReady)
    }

    override fun onPlaybackStateChanged(state: Int) {
      val exo = player ?: return
      when (state) {
        Player.STATE_BUFFERING -> emitProperty("paused-for-cache", true)
        Player.STATE_READY -> {
          emitProperty("paused-for-cache", false)
          if (!fileLoaded) {
            fileLoaded = true
            emitProperty("duration", duration(exo))
            emit("file-loaded")
            emit("playback-restart")
          } else if (seeking) {
            seeking = false
            emitProperty("seeking", false)
            emit("playback-restart")
          }
        }
        // keep-open: the last frame stays, as with mpv's keep-open=yes
        Player.STATE_ENDED -> emitProperty("eof-reached", true)
        else -> {}
      }
    }

    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      if (reason == Player.DISCONTINUITY_REASON_SEEK) {
        seeking = true
        emitProperty("seeking", true)
        emitProperty("eof-reached", false)
        emit("seek")
        emitTime(force = true)
      }
    }

    override fun onTracksChanged(tracks: Tracks) = publishTracks(tracks)

    override fun onVideoSizeChanged(size: VideoSize) {
      videoSize = size
      emitProperty("dwidth", size.width)
      emitProperty("dheight", size.height)
      layoutVideo()
    }

    override fun onCues(cueGroup: CueGroup) {
      subtitles?.setCues(cueGroup.cues)
    }

    override fun onPlaybackParametersChanged(parameters: PlaybackParameters) {
      emitProperty("speed", parameters.speed.toDouble())
    }

    override fun onPlayerError(error: PlaybackException) {
      emit("end-file", JSObject().put("reason", "error").put("fileError", error.errorCodeName))
    }
  }

  private val analytics = object : AnalyticsListener {
    override fun onVideoDecoderInitialized(
      eventTime: AnalyticsListener.EventTime,
      decoderName: String,
      initializedTimestampMs: Long,
      initializationDurationMs: Long,
    ) {
      videoDecoder = decoderName
    }

    override fun onVideoInputFormatChanged(
      eventTime: AnalyticsListener.EventTime,
      format: Format,
      decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {}
  }

  /** time-pos four times a second, as mpv's observed value is throttled to 200 ms. */
  private val ticker = object : Runnable {
    override fun run() {
      emitTime(force = false)
      main.postDelayed(this, 250)
    }
  }

  private fun emitTime(force: Boolean) {
    val exo = player ?: return
    val time = exo.currentPosition / 1000.0
    if (force || time != lastTime) {
      lastTime = time
      emitProperty("time-pos", time)
    }
    val cache = exo.bufferedPosition / 1000.0
    if (cache != lastCache) {
      lastCache = cache
      emitProperty("demuxer-cache-time", cache)
    }
    val total = duration(exo)
    if (fileLoaded && total != lastDuration) {
      lastDuration = total
      emitProperty("duration", total)
    }
  }

  // --- events --------------------------------------------------------------------------

  private fun emitOn(channel: Channel, event: JSObject) {
    try {
      channel.send(event)
    } catch (_: Exception) {
    }
  }

  private fun emit(type: String, event: JSObject = JSObject()) {
    events?.let { emitOn(it, event.put("type", type)) }
  }

  private fun emitProperty(name: String, value: Any?) {
    emit("property", JSObject().put("name", name).put("value", value ?: JSONObject.NULL))
  }
}
