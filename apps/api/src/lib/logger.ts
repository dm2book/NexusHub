import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino(
  env.isProd
    ? { level: 'info' }
    : {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      },
);

export const log = logger;
