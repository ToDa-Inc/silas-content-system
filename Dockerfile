# Next.js dashboard — supports two Docker build contexts:
#   1) Monorepo root (context = repo root): app lives in content-machine/
#   2) App-only (context = content-machine/): app files are at context root (Railway Root Directory)
#
# Railway: either Root Directory empty + this Dockerfile, OR Root Directory = content-machine
# and this Dockerfile as the selected file (same file works for both).

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY . /src
RUN if [ -d /src/content-machine ]; then \
      cp /src/content-machine/package.json /src/content-machine/package-lock.json . ; \
    else \
      cp /src/package.json /src/package-lock.json . ; \
    fi && rm -rf /src
RUN npm ci

FROM base AS builder
ENV DOCKER=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=6144
COPY --from=deps /app/node_modules ./node_modules
COPY . /src
RUN if [ -d /src/content-machine ]; then \
      cp -a /src/content-machine/. . ; \
    else \
      cp -a /src/. . ; \
    fi && rm -rf /src

ARG SUPABASE_URL
ARG SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG CONTENT_API_URL
ARG NEXT_PUBLIC_CONTENT_API_URL
ENV SUPABASE_URL=${SUPABASE_URL}
ENV SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV CONTENT_API_URL=${CONTENT_API_URL}
ENV NEXT_PUBLIC_CONTENT_API_URL=${NEXT_PUBLIC_CONTENT_API_URL}

RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
