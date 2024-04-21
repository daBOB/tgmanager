# Use a base image with Node.js, for example
FROM oven/bun:1 AS base

# Set the working directory inside the container
WORKDIR /app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . /app

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /app/index.js .
COPY --from=prerelease /app/package.json .


# Create a directory for sessions
RUN mkdir /sessions

# Mount the sessions directory as a volume
VOLUME /sessions

USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "index.js" ]
