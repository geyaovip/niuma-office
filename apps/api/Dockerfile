FROM node:24.15.0-alpine AS build
WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/channel-adapter/package.json packages/channel-adapter/tsconfig.json ./packages/channel-adapter/
RUN npm ci --workspace @niuma/api --workspace @niuma/contracts --workspace @niuma/channel-adapter --include-workspace-root=false

COPY apps/api/src ./apps/api/src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/channel-adapter/src ./packages/channel-adapter/src
RUN npm --workspace @niuma/contracts run build \
  && npm --workspace @niuma/channel-adapter run build \
  && npm --workspace @niuma/api run build \
  && npm prune --omit=dev --workspace @niuma/api --workspace @niuma/contracts --workspace @niuma/channel-adapter --include-workspace-root=false

FROM node:24.15.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/packages/channel-adapter/package.json ./packages/channel-adapter/package.json
COPY --from=build /workspace/packages/channel-adapter/dist ./packages/channel-adapter/dist
USER node
EXPOSE 4310
CMD ["node", "apps/api/dist/server.js"]
