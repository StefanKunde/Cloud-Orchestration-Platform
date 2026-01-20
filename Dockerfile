# Build stage
ARG NODE_BASE=public.ecr.aws/docker/library/node:20-alpine
FROM ${NODE_BASE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
# Installiere NestJS CLI global
RUN npm install -g @nestjs/cli
COPY . .
RUN npm run build

# Run stage
FROM ${NODE_BASE} AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/main"]
EXPOSE 4600
