FROM node:22-alpine

# Set the working directory in the container
WORKDIR /usr/src/app
RUN mkdir -p /usr/src/app/sessions
RUN mkdir -p /usr/src/app/uploads

# Test internet connectivity
RUN apk add --no-cache curl && \
    curl -I https://www.google.com

# Install FFmpeg from the edge repository
RUN apk add --no-cache --repository http://dl-cdn.alpinelinux.org/alpine/edge/community ffmpeg

# Copy the package.json and package-lock.json (if available)
COPY package*.json ./

# Install any needed packages specified in package.json
RUN npm install

# Bundle your app's source code inside the Docker container
COPY . .

# Define environment variable
ENV NODE_ENV production

# Set the executable for the container
ENTRYPOINT ["node", "index.js"]

# Set default CMD arguments (can be overridden from the Docker command line)
CMD ["--help"]