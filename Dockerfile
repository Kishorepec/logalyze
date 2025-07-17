# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy files
COPY . .

# Install dependencies
RUN npm install

# Expose app port
EXPOSE 3000

# Start app
CMD ["node", "app.js"]
