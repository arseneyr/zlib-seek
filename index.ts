import { Transform } from "node:stream";
import { ZlibOptions } from "node:zlib";
import { Readable } from "stream";
import { Unzip, Inflate, constants } from "zlib";

declare module "zlib" {
  export class Inflate {
    constructor(options?: ZlibOptions);
    _processChunk(chunk: Buffer, flush: number, cb?: () => void): void;
  }
  export class Unzip {
    constructor(options?: ZlibOptions);
    _processChunk(chunk: Buffer, flush: number, cb?: () => void): void;
  }
  // interface Unzip {
  //   _processChunk(chunk: Buffer, flush: number, cb?: () => void): void;
  // }
}

interface SeekPoint {
  compressedOffset: number;
  uncompressedOffset: number;
  dictionary: Buffer;
}

interface ZlibSeekOptions extends ZlibOptions {
  seekSpan?: number;
}

type GConstructor<T = {}> = new (...args: any[]) => T;

function WithSeek<TBase extends GConstructor<Unzip>>(Base: TBase) {
  return class ZlibSeek extends Base {
    readonly _uncompressedSlidingWindow: Buffer[] = [];
    _uncompressedSlidingWindowLength = 0;
    _totalIn = 0;
    _totalOut = 0;
    readonly _seekPoints: SeekPoint[] = [];
    _lastSeekPoint: SeekPoint | null = null;
    _seekStreamFlowing = false;
    readonly _seekSpan: number;

    seekStream = new Readable({
      objectMode: true,
      read: () => {
        this._seekStreamFlowing = true;
        this._pushAllSeekPoints();
      },
    });

    constructor(...args: any[]) {
      super({ ...(args[0] || {}), flush: constants.Z_BLOCK });

      this._seekSpan = args[0]?.seekSpan || 5 * 1024 * 1024;

      this.seekStream = new Readable({
        objectMode: true,
        read: () => {
          this._seekStreamFlowing = true;
          this._pushAllSeekPoints();
        },
      });
    }

    push(outChunk: Buffer | null): boolean {
      if (!outChunk) {
        if (this.writableFinished) {
          return super.push(null);
        }
        return true;
      }
      this._totalOut += outChunk.byteLength;

      this._uncompressedSlidingWindow.push(outChunk);
      this._uncompressedSlidingWindowLength += outChunk.byteLength;
      if (
        this._uncompressedSlidingWindowLength -
          this._uncompressedSlidingWindow[0].byteLength >=
        32 * 1024
      ) {
        this._uncompressedSlidingWindow.shift();
      }
      return super.push(outChunk);
    }

    _pushAllSeekPoints() {
      if (!this._seekStreamFlowing) {
        return;
      }
      while (this._seekPoints.length > 0) {
        if (!this.seekStream.push(this._seekPoints.shift())) {
          this._seekStreamFlowing = false;
          return;
        }
      }
    }

    _onNewBlock() {
      const lastOffset = this._lastSeekPoint?.compressedOffset || 0;

      if (this.bytesWritten - lastOffset >= this._seekSpan) {
        let dictionary = Buffer.concat(this._uncompressedSlidingWindow);
        dictionary = dictionary.slice(dictionary.length - 32 * 1024);

        const newIndexPoint = {
          compressedOffset: this.bytesWritten,
          uncompressedOffset: this._totalOut,
          dictionary,
        };
        this._seekPoints.push(newIndexPoint);
        this._lastSeekPoint = newIndexPoint;
        this._pushAllSeekPoints();
      }
    }

    _transform(chunk: Buffer, encoding: any, cb: () => void) {
      this._totalIn += chunk.byteLength;
      const onDone = () => {
        const inRemaining = this._totalIn - this.bytesWritten;

        if (inRemaining > 0) {
          this._onNewBlock();

          super._transform(
            chunk.slice(chunk.byteLength - inRemaining),
            encoding,
            onDone
          );
        } else {
          cb();
        }
      };

      super._transform(chunk, encoding, onDone);
    }
  };
}

export const UnzipSeek = WithSeek(Unzip);
export const InflateSeek = WithSeek(Inflate);
