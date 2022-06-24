FROM node:16-alpine

ENV CI_HOME /usr/local/chip-in

RUN apk --update add pcre-dev openssl-dev curl git \
  && mkdir -p ${CI_HOME}/ 

COPY . ${CI_HOME}/rn-contents-server

RUN cd ${CI_HOME}/rn-contents-server \
  && npm i \
  && npm run cleanbuild

WORKDIR ${CI_HOME}/rn-contents-server

ENTRYPOINT ["npm", "start", "--"]

