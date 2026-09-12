# Runs the CLI on the Bun runtime with a real node_modules tree.
#
# This is the full-featured distribution: unlike the single-file binaries built
# by `bun run build-native`, the image installs sharp's native binding for its
# own platform, so image resizing works here.
FROM oven/bun:1 AS deps

WORKDIR /app

# Install only production dependencies, using the committed lockfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime

WORKDIR /app

# ffmpeg is required for video metadata extraction
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY .env.example ./

ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["--help"]
