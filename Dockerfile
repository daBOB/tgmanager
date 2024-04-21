# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app
RUN mkdir -p /usr/src/app/sessions
RUN mkdir -p /usr/src/app/uploads

# Install FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

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
