FROM node:24-bookworm-slim AS node

FROM ubuntu:24.04

ARG RUST_VERSION=1.99.0

ENV DEBIAN_FRONTEND=noninteractive \
    CARGO_HOME=/usr/local/cargo \
    CARGO_BUILD_JOBS=2 \
    CARGO_PROFILE_DEV_DEBUG=0 \
    CARGO_PROFILE_DEV_INCREMENTAL=false \
    RUSTUP_HOME=/usr/local/rustup \
    RUSTFLAGS="-C link-arg=-fuse-ld=lld" \
    PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    dbus-x11 \
    file \
    git \
    gosu \
    libayatana-appindicator3-dev \
    libdbus-1-dev \
    libegl-mesa0 \
    libgl1-mesa-dri \
    libglx-mesa0 \
    libmpv-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libxdo-dev \
    librsvg2-dev \
    lld \
    mesa-utils \
    mpv \
    novnc \
    openbox \
    patchelf \
    pkg-config \
    tigervnc-standalone-server \
    websockify \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/ /usr/local/

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal \
        --default-toolchain "$RUST_VERSION" --component clippy,rustfmt \
    && rm /tmp/rustup-init.sh

RUN groupadd --gid 10001 zeiler \
    && useradd --uid 10001 --gid zeiler --create-home --shell /bin/bash zeiler \
    && mkdir -p /workspace/node_modules /workspace/target \
        /usr/local/cargo/registry /usr/local/cargo/git /home/zeiler/.npm \
    && chown -R zeiler:zeiler /workspace /home/zeiler /usr/local/cargo \
    && rm -f /usr/share/novnc/index.html

COPY docker/entrypoint.sh /usr/local/bin/zeiler-entrypoint
COPY docker/start-dev.sh /usr/local/bin/zeiler-start-dev
COPY docker/mpv.conf /etc/mpv/mpv.conf
COPY docker/novnc-index.html /usr/share/novnc/index.html

RUN chmod 0755 /usr/local/bin/zeiler-entrypoint /usr/local/bin/zeiler-start-dev

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/zeiler-entrypoint"]
