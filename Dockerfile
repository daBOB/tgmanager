FROM node:18-slim AS builder

WORKDIR /usr/src/app

# Install build dependencies
RUN apt-get update && \
    apt-get install -y python3 make g++ curl git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set npm config to use python3
ENV npm_config_python=/usr/bin/python3

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install --build-from-source && \
    npm install -g pkg

# Copy source files
COPY src ./src
COPY .env.example ./

# Build TypeScript
RUN npm run build:ts

# Create dist directory if needed
RUN mkdir -p dist

# Build for the same architecture as the base image
RUN pkg dist/index.js \
    --compress GZip \
    --public-packages "*" \
    --public \
    --no-bytecode \
    --target node18-linux-x64 \
    --output /usr/src/app/dist/uploader-linux-docker

FROM debian:bookworm-slim

WORKDIR /app

# Copy the built binary from the builder stage
COPY --from=builder /usr/src/app/dist/uploader-linux-docker /app/uploader

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Make the binary executable
RUN chmod +x /app/uploader

ENTRYPOINT ["/app/uploader"]
CMD ["--help"]
