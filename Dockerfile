FROM node:20-alpine3.21

ENV NODE_ENV=production

RUN addgroup -g 1017 appgroup \
  && adduser -D -u 1017 -G appgroup appuser

WORKDIR /app

RUN apk add --no-cache make python3

COPY . .

RUN npm install

RUN chown -R appuser:appgroup /app

USER 1017

RUN chmod +x start.sh

CMD ["./start.sh"]