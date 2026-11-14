import AppKit
import CoreText

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let fonts = [
  "public/fonts/sora-600.ttf",
  "public/fonts/manrope-400.ttf",
  "public/fonts/manrope-600.ttf",
]
for font in fonts {
  CTFontManagerRegisterFontsForURL(root.appendingPathComponent(font) as CFURL, .process, nil)
}

func color(_ hex: UInt32) -> NSColor {
  NSColor(
    calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
    green: CGFloat((hex >> 8) & 0xff) / 255,
    blue: CGFloat(hex & 0xff) / 255,
    alpha: 1
  )
}

let canvas = color(0x0a161a)
let ink = color(0xf4efe3)
let muted = color(0xb0a998)
let accent = color(0xd9a63a)
let edge = color(0x2e4a57)
let logo = NSImage(contentsOf: root.appendingPathComponent("assets/brand/zeiler-logo-white.png"))!

func font(_ name: String, _ size: CGFloat) -> NSFont {
  NSFont(name: name, size: size) ?? NSFont.systemFont(ofSize: size)
}

func scene() -> NSImage {
  let image = NSImage(size: NSSize(width: 1600, height: 900))
  image.lockFocus()
  let rect = NSRect(x: 0, y: 0, width: 1600, height: 900)
  NSGradient(colors: [color(0x07151c), color(0x163d46), color(0x31595b)])!
    .draw(in: rect, angle: 40)
  accent.withAlphaComponent(0.82).setFill()
  NSBezierPath(ovalIn: NSRect(x: 1110, y: 530, width: 150, height: 150)).fill()
  for index in 0..<8 {
    color(index % 2 == 0 ? 0x0a242d : 0x12343b).withAlphaComponent(0.74).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: index * 48, width: 1600, height: 50)).fill()
  }
  ink.withAlphaComponent(0.88).setFill()
  let sail = NSBezierPath()
  sail.move(to: NSPoint(x: 730, y: 260))
  sail.line(to: NSPoint(x: 730, y: 610))
  sail.line(to: NSPoint(x: 520, y: 330))
  sail.close()
  sail.fill()
  let otherSail = NSBezierPath()
  otherSail.move(to: NSPoint(x: 750, y: 590))
  otherSail.line(to: NSPoint(x: 750, y: 290))
  otherSail.line(to: NSPoint(x: 930, y: 340))
  otherSail.close()
  otherSail.fill()
  let hull = NSBezierPath()
  hull.move(to: NSPoint(x: 500, y: 270))
  hull.line(to: NSPoint(x: 960, y: 270))
  hull.line(to: NSPoint(x: 875, y: 220))
  hull.line(to: NSPoint(x: 570, y: 220))
  hull.close()
  hull.fill()
  image.unlockFocus()
  return image
}

func render(
  source: String,
  output: String,
  width: Int,
  height: Int,
  title: String,
  body: String,
  phone: Bool
) throws {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else { fatalError("Could not allocate the screenshot canvas") }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  canvas.setFill()
  NSRect(x: 0, y: 0, width: width, height: height).fill()

  func topRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
    NSRect(x: x, y: CGFloat(height) - y - h, width: w, height: h)
  }
  func text(_ value: String, _ rect: NSRect, _ typeface: NSFont, _ foreground: NSColor, tracking: CGFloat = 0) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byWordWrapping
    value.draw(in: rect, withAttributes: [
      .font: typeface,
      .foregroundColor: foreground,
      .paragraphStyle: paragraph,
      .kern: tracking,
    ])
  }

  if phone {
    logo.draw(in: topRect(64, 64, 76, 76))
    text("ZEILER ON ANDROID", topRect(164, 92, 700, 28), font("Manrope", 24), accent, tracking: 2.4)
    text(title, topRect(64, 178, 940, 165), font("Sora", 62), ink)
    text(body, topRect(64, 350, 900, 74), font("Manrope", 31), muted)
  } else {
    logo.draw(in: topRect(64, 64, 76, 76))
    text("ZEILER ON ANDROID TV", topRect(164, 92, 400, 28), font("Manrope", 22), accent, tracking: 2)
    text(title, topRect(64, 205, 470, 220), font("Sora", 58), ink)
    text(body, topRect(64, 455, 450, 130), font("Manrope", 29), muted)
  }

  let image = NSImage(contentsOf: root.appendingPathComponent(source))!
  let frame = phone ? topRect(117, 460, 846, 1880) : topRect(590, 202, 1270, 714)
  let clip = NSBezierPath(roundedRect: frame, xRadius: phone ? 34 : 20, yRadius: phone ? 34 : 20)
  clip.addClip()
  image.draw(in: frame)
  if source.contains("player") {
    if phone {
      scene().draw(in: topRect(117, 1160, 846, 482))
    } else {
      scene().draw(in: frame)
      canvas.withAlphaComponent(0.56).setFill()
      topRect(590, 202, 1270, 72).fill()
      text("← Back", topRect(618, 224, 120, 28), font("Manrope", 22), ink)
      text("Voyage Home", topRect(760, 224, 420, 28), font("Manrope", 22), ink)
      canvas.withAlphaComponent(0.92).setFill()
      topRect(590, 794, 1270, 122).fill()
      muted.setFill()
      topRect(630, 810, 1180, 3).fill()
      accent.setFill()
      topRect(630, 810, 480, 3).fill()
      text("Ⅱ", topRect(630, 840, 34, 34), font("Manrope", 24), ink)
      text("1:17 / 2:00", topRect(690, 844, 170, 28), font("Manrope", 20), muted)
      text("Streams", topRect(1320, 842, 130, 28), font("Manrope", 20), muted)
      text("Audio", topRect(1460, 842, 90, 28), font("Manrope", 20), muted)
      text("Subtitles", topRect(1580, 842, 140, 28), font("Manrope", 20), muted)
      text("1×", topRect(1760, 842, 40, 28), font("Manrope", 20), muted)
      text("⛶", topRect(1810, 840, 40, 34), font("Manrope", 24), muted)
    }
  }
  NSGraphicsContext.current?.restoreGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  edge.setStroke()
  clip.lineWidth = 2
  clip.stroke()

  let destination = root.appendingPathComponent(output)
  try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode \(output)")
  }
  try data.write(to: destination)
  print("\(output): \(width)x\(height)")
}

let jobs = [
  (
    "fastlane/source-screenshots/phone/01-title.png",
    "fastlane/metadata/android/en-US/images/phoneScreenshots/01-title.png",
    "Your library.\nRight where you left off.",
    "Resume episodes and keep every profile’s place.",
    true
  ),
  (
    "fastlane/source-screenshots/phone/02-player.png",
    "fastlane/metadata/android/en-US/images/phoneScreenshots/02-player.png",
    "Native playback.\nNothing else to install.",
    "Touch controls, subtitles, audio tracks, and fullscreen.",
    true
  ),
  (
    "fastlane/source-screenshots/tv/01-title.png",
    "fastlane/metadata/android/en-US/images/tvScreenshots/01-title.png",
    "Your titles. Your add-ons.\nYour screen.",
    "A cinematic home for the catalogs you choose.",
    false
  ),
  (
    "fastlane/source-screenshots/tv/02-stream-picker.png",
    "fastlane/metadata/android/en-US/images/tvScreenshots/02-stream-picker.png",
    "Pick the stream\nthat fits.",
    "Quality, source, and episode matching in one focused picker.",
    false
  ),
  (
    "fastlane/source-screenshots/tv/03-player.png",
    "fastlane/metadata/android/en-US/images/tvScreenshots/03-player.png",
    "Built for the\nbig screen.",
    "D-pad navigation, native playback, and saved progress.",
    false
  ),
]

for job in jobs {
  try render(
    source: job.0,
    output: job.1,
    width: job.4 ? 1080 : 1920,
    height: job.4 ? 2400 : 1080,
    title: job.2,
    body: job.3,
    phone: job.4
  )
}
