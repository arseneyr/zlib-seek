const { UnzipSeek } = require("./index");
const { randomBytes } = require("crypto");
const { createGzip } = require("zlib");

const rawBuffer = randomBytes(20 * 1024 * 1024);
let compressedBuffer = null;
beforeAll(async () => {
  const zipper = createGzip();
  zipper.end(rawBuffer);
  compressedBuffer = await streamToBuffer(zipper);
});

function streamToBuffer(stream) {
  return new Promise((resolve) => {
    const bufs = [];
    stream.on("data", (data) => bufs.push(data));
    stream.on("end", () => resolve(Buffer.concat(bufs)));
  });
}

test("compresses", async () => {
  const seekUnzipper = new UnzipSeek();
  seekUnzipper.end(compressedBuffer);
  const uncompressed = await streamToBuffer(seekUnzipper);
  expect(Buffer.compare(uncompressed, rawBuffer)).toBe(0);
});
