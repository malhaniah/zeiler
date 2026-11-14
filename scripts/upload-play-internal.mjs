#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "zeiler.com";
const track = "internal";
const locale = "en-US";
const aabPath = "src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab";
const outputMetadataPath = "src-tauri/gen/android/app/build/outputs/apk/universal/release/output-metadata.json";
const metadataRoot = "fastlane/metadata/android/en-US";
const apiRoot = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const uploadRoot = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";
const quotaProject = "driven-tape-411211";
const screenshotTypes = ["phoneScreenshots", "tvScreenshots"];
const imageTypes = ["icon", "featureGraphic", ...screenshotTypes];
const skippedDirectories = new Set([".git", ".gradle", ".kotlin", ".cxx", "build", "node_modules", "target"]);
const sourceInputs = [
  "src",
  "public",
  "crates",
  "src-tauri",
  "Cargo.toml",
  "Cargo.lock",
  "package.json",
  "package-lock.json",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
];

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => arg !== "--check")) {
  throw new Error("Usage: node scripts/upload-play-internal.mjs [--check]");
}
const checkOnly = args.has("--check");

function absolute(path) {
  return join(root, path);
}

function readText(path) {
  return readFileSync(absolute(path), "utf8").trim();
}

function assertImage(path) {
  const data = readFileSync(absolute(path));
  const isPng = data.length > 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new Error(`${path} must be a PNG or JPEG image.`);
  }
}

function assertText(path, value, maximum) {
  if (!value || value.length > maximum) {
    throw new Error(`${path} must contain between 1 and ${maximum} characters.`);
  }
}

function* sourceFiles(path) {
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info || info.isSymbolicLink()) return;
  if (info.isFile()) {
    yield path;
    return;
  }
  if (!info.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (skippedDirectories.has(entry.name) || entry.name === ".DS_Store") continue;
    yield* sourceFiles(join(path, entry.name));
  }
}

function assertFreshArtifact() {
  const aabModified = statSync(absolute(aabPath)).mtimeMs;
  const newer = [];
  for (const input of sourceInputs) {
    for (const path of sourceFiles(absolute(input))) {
      if (statSync(path).mtimeMs > aabModified) {
        newer.push(relative(root, path));
      }
    }
  }
  if (newer.length > 0) {
    const preview = newer.sort().slice(0, 10).join("\n  ");
    throw new Error(
      `The AAB is older than ${newer.length} build input(s):\n  ${preview}\n` +
        "Rebuild the signed release after the current app changes are finished, then rerun --check.",
    );
  }
}

function preflight() {
  const outputMetadata = JSON.parse(readText(outputMetadataPath));
  if (outputMetadata.applicationId !== packageName) {
    throw new Error(`Release application ID is ${outputMetadata.applicationId}, expected ${packageName}.`);
  }
  const element = outputMetadata.elements?.[0];
  const versionCode = Number(element?.versionCode);
  const versionName = element?.versionName;
  if (!Number.isSafeInteger(versionCode) || !versionName) {
    throw new Error("The release output metadata does not contain a valid version code and version name.");
  }

  const title = readText(`${metadataRoot}/title.txt`);
  const shortDescription = readText(`${metadataRoot}/short_description.txt`);
  const fullDescription = readText(`${metadataRoot}/full_description.txt`);
  const changelogPath = `${metadataRoot}/changelogs/${versionCode}.txt`;
  const changelog = readText(changelogPath);
  assertText(`${metadataRoot}/title.txt`, title, 30);
  assertText(`${metadataRoot}/short_description.txt`, shortDescription, 80);
  assertText(`${metadataRoot}/full_description.txt`, fullDescription, 4000);
  assertText(changelogPath, changelog, 500);

  for (const type of imageTypes) {
    if (screenshotTypes.includes(type)) {
      const directory = absolute(`${metadataRoot}/images/${type}`);
      const files = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort();
      if (files.length === 0 || files.length > 8) {
        throw new Error(`${type} must contain between 1 and 8 PNG or JPEG screenshots.`);
      }
      for (const file of files) assertImage(`${metadataRoot}/images/${type}/${file}`);
    } else {
      assertImage(`${metadataRoot}/images/${type}.png`);
    }
  }

  execFileSync("jarsigner", ["-verify", absolute(aabPath)], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  console.log(`Verified AAB signature: ${aabPath}`);
  assertFreshArtifact();

  const sha256 = createHash("sha256").update(readFileSync(absolute(aabPath))).digest("hex");
  console.log(`Preflight passed for ${packageName} ${versionName} (${versionCode}).`);
  console.log(`AAB SHA-256: ${sha256}`);
  console.log(`Validated ${locale} listing, changelog, icon, feature graphic, and prepared screenshots.`);
  console.log("Release target: internal track only.");

  return { versionCode, versionName, title, shortDescription, fullDescription, changelog };
}

function userAccessToken() {
  try {
    const token = execFileSync(
      "gcloud",
      ["auth", "application-default", "print-access-token", "--scopes=https://www.googleapis.com/auth/androidpublisher"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024,
      },
    ).trim();
    if (!token) throw new Error("empty token");
    return token;
  } catch {
    throw new Error(
      "No user OAuth access token is available. Run: gcloud auth application-default login --no-launch-browser " +
        "--disable-quota-project --scopes=openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/androidpublisher",
    );
  }
}

async function request(token, method, url, body, contentType = "application/json") {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "x-goog-user-project": quotaProject,
        ...(body === undefined ? {} : { "Content-Type": contentType }),
      },
      body,
    });
  } catch (error) {
    throw new Error(`Google Play API network request failed: ${error.message}`);
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const detail = data.error?.message || data.message || response.statusText;
    throw new Error(`Google Play API returned ${response.status}: ${detail}`);
  }
  return data;
}

async function upload(token, release) {
  const editsUrl = `${apiRoot}/${packageName}/edits`;
  let edit;
  try {
    edit = await request(token, "POST", editsUrl, "{}");
  } catch (error) {
    throw new Error(
      `${error.message}\nConfirm that Google Play Developer API access is enabled for this user and that the user signed in with ` +
        "https://www.googleapis.com/auth/androidpublisher.",
    );
  }
  const editUrl = `${editsUrl}/${edit.id}`;
  const uploadEditUrl = `${uploadRoot}/${packageName}/edits/${edit.id}`;
  console.log(`Created Google Play edit ${edit.id}.`);

  try {
    const bundle = await request(
      token,
      "POST",
      `${uploadEditUrl}/bundles?uploadType=media`,
      readFileSync(absolute(aabPath)),
      "application/octet-stream",
    );
    if (Number(bundle.versionCode) !== release.versionCode) {
      throw new Error(`Uploaded AAB reports version code ${bundle.versionCode}, expected ${release.versionCode}.`);
    }
    console.log(`Uploaded AAB version code ${bundle.versionCode}.`);

    await request(
      token,
      "PUT",
      `${editUrl}/listings/${locale}`,
      JSON.stringify({
        language: locale,
        title: release.title,
        shortDescription: release.shortDescription,
        fullDescription: release.fullDescription,
      }),
    );
    console.log(`Updated ${locale} store listing.`);

    for (const type of screenshotTypes) {
      await request(token, "DELETE", `${editUrl}/listings/${locale}/${type}`);
      const directory = absolute(`${metadataRoot}/images/${type}`);
      const files = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort();
      for (const file of files) {
        const data = readFileSync(join(directory, file));
        const contentType = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
        await request(token, "POST", `${uploadEditUrl}/listings/${locale}/${type}?uploadType=media`, data, contentType);
        console.log(`Uploaded ${type}/${file}.`);
      }
    }

    for (const type of ["icon", "featureGraphic"]) {
      await request(
        token,
        "POST",
        `${uploadEditUrl}/listings/${locale}/${type}?uploadType=media`,
        readFileSync(absolute(`${metadataRoot}/images/${type}.png`)),
        "image/png",
      );
      console.log(`Uploaded ${type}.png.`);
    }

    await request(
      token,
      "PUT",
      `${editUrl}/tracks/${track}`,
      JSON.stringify({
        track,
        releases: [
          {
            name: `${release.versionName} (${release.versionCode})`,
            status: "completed",
            versionCodes: [String(release.versionCode)],
            releaseNotes: [{ language: locale, text: release.changelog }],
          },
        ],
      }),
    );
    console.log(`Updated the ${track} track with version code ${release.versionCode} and its changelog.`);

    await request(token, "POST", `${editUrl}:validate`, "{}");
    await request(token, "POST", `${editUrl}:commit`, "{}");
    console.log(`Committed ${release.versionName} (${release.versionCode}) to the Google Play internal track.`);
  } catch (error) {
    try {
      await request(token, "DELETE", editUrl);
      console.error("Discarded the uncommitted Google Play edit.");
    } catch (cleanupError) {
      console.error(`Could not discard edit ${edit.id}: ${cleanupError.message}`);
    }
    throw error;
  }
}

try {
  const release = preflight();
  if (checkOnly) {
    console.log("Check complete; no authentication or upload was attempted.");
  } else {
    await upload(userAccessToken(), release);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
