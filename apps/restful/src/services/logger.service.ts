import { provide } from "@inversifyjs/binding-decorators";
import { injectable } from "inversify";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { LOG_DIR } from "../constants";
import fs from "node:fs";

@injectable()
@provide()
export default class Logger {
  private logger: winston.Logger;

  constructor() {
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        const msg = stack || message;
        return `${timestamp} [${level.toUpperCase()}] ${msg}`;
      }),
    );

    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), logFormat),
      }),
    ];

    if (process.env.NODE_ENV === "production") {
      transports.push(
        new DailyRotateFile({
          dirname: LOG_DIR,
          filename: "restful-%DATE%.log",
          datePattern: "YYYY-MM-DD",
          maxSize: "20m",
          maxFiles: "14d",
          format: logFormat,
        }),
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || "info",
      transports,
    });
  }

  info(message: string, ...args: any[]): void {
    this.logger.info(this.formatMessage(message, args));
  }

  warn(message: string, ...args: any[]): void {
    this.logger.warn(this.formatMessage(message, args));
  }

  error(message: string | Error, ...args: any[]): void {
    if (message instanceof Error) {
      this.logger.error(message);
    } else {
      this.logger.error(this.formatMessage(message, args));
    }
  }

  debug(message: string, ...args: any[]): void {
    this.logger.debug(this.formatMessage(message, args));
  }

  private formatMessage(message: string, args: any[]): string {
    if (args.length === 0) return message;
    return `${message} ${args.map((a) => JSON.stringify(a)).join(" ")}`;
  }
}
