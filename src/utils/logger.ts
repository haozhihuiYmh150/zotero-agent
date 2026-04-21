/**
 * Logger - Unified logging service, output to file
 */

// Get log file path dynamically based on Zotero data directory
function getLogFilePath(): string {
  try {
    const dataDir = Zotero.DataDirectory.dir;
    return `${dataDir}/zotero-agent.log`;
  } catch {
    // Fallback to temp directory
    return "/tmp/zotero-agent.log";
  }
}

export class Logger {
  private static queue: string[] = [];
  private static writing = false;

  /**
   * Write log entry
   */
  static async log(
    level: "INFO" | "WARN" | "ERROR" | "DEBUG",
    module: string,
    message: string,
    data?: any,
  ) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] [${module}] ${message}`;

    if (data !== undefined) {
      try {
        const dataStr =
          typeof data === "string" ? data : JSON.stringify(data, null, 2);
        // Truncate overly long data
        logLine +=
          "\n  " +
          (dataStr.length > 1000
            ? dataStr.substring(0, 1000) + "..."
            : dataStr);
      } catch {
        logLine += "\n  [Cannot serialize data]";
      }
    }

    // Also output to Zotero console
    ztoolkit.log(`[${module}]`, message, data);

    // Add to write queue
    this.queue.push(logLine);
    this.flushQueue();
  }

  /**
   * Asynchronously flush queue to file
   */
  private static async flushQueue() {
    if (this.writing || this.queue.length === 0) return;

    this.writing = true;
    try {
      const lines = this.queue.splice(0, this.queue.length);
      const content = lines.join("\n") + "\n";

      // Read existing content
      let existing = "";
      try {
        existing =
          ((await Zotero.File.getContentsAsync(getLogFilePath())) as string) ||
          "";
      } catch {
        // File does not exist
      }

      // Limit file size (keep recent 100KB)
      if (existing.length > 100000) {
        existing = existing.substring(existing.length - 50000);
      }

      await Zotero.File.putContentsAsync(getLogFilePath(), existing + content);
    } catch (e) {
      // Ignore write errors
    }
    this.writing = false;

    // If there's more content in queue, continue writing
    if (this.queue.length > 0) {
      setTimeout(() => this.flushQueue(), 100);
    }
  }

  // Convenience methods
  static info(module: string, message: string, data?: any) {
    this.log("INFO", module, message, data);
  }

  static warn(module: string, message: string, data?: any) {
    this.log("WARN", module, message, data);
  }

  static error(module: string, message: string, data?: any) {
    this.log("ERROR", module, message, data);
  }

  static debug(module: string, message: string, data?: any) {
    this.log("DEBUG", module, message, data);
  }

  /**
   * Clear log file
   */
  static async clear() {
    try {
      await Zotero.File.putContentsAsync(
        getLogFilePath(),
        `=== Zotero Agent Log Started at ${new Date().toISOString()} ===\n`,
      );
    } catch {
      // Ignore
    }
  }
}
