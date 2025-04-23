FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies
RUN apk add --no-cache python3 make g++ curl git

# Set npm config to use python3
ENV npm_config_python=/usr/bin/python3

# Copy package files
COPY package*.json ./

# Install dependencies including pkg locally
RUN npm install --build-from-source && \
    npm install -g pkg

# Create a dummy accounts.js file if it doesn't exist
RUN touch accounts.js

# Copy source files
COPY . .

# Create dist directory
RUN mkdir -p dist

# Build for the same architecture as the base image
RUN pkg package.json \
    --compress GZip \
    --public-packages "*" \
    --public \
    --no-bytecode \
    --target node18-linux-$(uname -m) \
    --output /usr/src/app/dist/uploader-linux-docker

FROM alpine:latest

WORKDIR /app

# Copy the built binary from the builder stage
COPY --from=builder /usr/src/app/dist/uploader-linux-docker /app/uploader

# Install runtime dependencies
RUN apk add --no-cache --repository http://dl-cdn.alpinelinux.org/alpine/edge/community ffmpeg

# Make the binary executable
RUN chmod +x /app/uploader

ENTRYPOINT ["/app/uploader"]
CMD ["--help"]
