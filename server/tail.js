import fsp from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

const CHUNK = 1024 * 1024;

/**
 * Incrementally reads complete lines appended to a file. Handles partial trailing lines,
 * multi-byte UTF-8 split across reads, and truncation (restarts from the top).
 */
export class FileTailer {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.partial = '';
    this.decoder = new StringDecoder('utf8');
    this.dropFirstLine = false;
  }

  /** Start reading at most `maxBytes` from the end (dropping the first, likely partial, line). */
  async startNear(maxBytes) {
    const { size } = await fsp.stat(this.file);
    if (size > maxBytes) {
      this.offset = size - maxBytes;
      this.dropFirstLine = true;
    } else {
      this.offset = 0;
    }
  }

  async seekToEnd() {
    const { size } = await fsp.stat(this.file);
    this.offset = size;
    this.partial = '';
  }

  /** Read everything new; calls onLine for each complete line. Returns number of bytes read. */
  async readNew(onLine) {
    let handle;
    try {
      handle = await fsp.open(this.file, 'r');
    } catch {
      return 0;
    }
    try {
      const { size } = await handle.stat();
      if (size < this.offset) {
        // File was truncated or replaced: start over.
        this.offset = 0;
        this.partial = '';
        this.decoder = new StringDecoder('utf8');
      }
      let total = 0;
      const buf = Buffer.allocUnsafe(CHUNK);
      while (this.offset < size) {
        const want = Math.min(CHUNK, size - this.offset);
        const { bytesRead } = await handle.read(buf, 0, want, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        total += bytesRead;
        const text = this.partial + this.decoder.write(buf.subarray(0, bytesRead));
        const lines = text.split('\n');
        this.partial = lines.pop();
        for (let line of lines) {
          if (this.dropFirstLine) {
            this.dropFirstLine = false;
            continue;
          }
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line) onLine(line);
        }
      }
      return total;
    } finally {
      await handle.close();
    }
  }
}
