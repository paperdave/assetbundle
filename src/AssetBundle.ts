// AssetBundle, a simple archive format for bundling assets for browser use.
const td = new TextDecoder();

// "BUNDLE1"
const HEAD = new Uint8Array([0x42, 0x55, 0x4e, 0x44, 0x4c, 0x45, 0x31]);

export type AssetBundleDecodeInput =
  | ReadableStream<Uint8Array>
  | BlobPart
  | { stream: () => ReadableStream<Uint8Array> };

export interface AssetBundleInput {
  name: string;
  type?: string;
  data: Blob | Uint8Array | ArrayBufferLike | string;
}

export interface AssetBundleOutput {
  name: string;
  data: Blob;
}

// WRITING
// - `u8[7]` Start with these bytes "BUNDLE1"
// - For each file
//   - `u16` with byteLength of the following field:
//   - `u8[...]` with file name
//   - `u16` with byteLength of the following field:
//   - `u8[...]` with file type
//   - `u32` size of asset
//   - `u8[...]` Buffer, no compression or processing
//   - `u8[20]` with a SHA-1 digest

export async function encodeAssetBundle(files: AssetBundleInput[]) {
  const chunks: any[] = [];
  let offset = 0;
  const seenFilenames = new Set<string>();
  for (const file of files) {
    const name = file.name;
    if (seenFilenames.has(name)) {
      throw new Error(`Duplicate filename: ${name}`);
    }
    seenFilenames.add(name);

    const data: any = file.data;
    let type = file.type;
    const buffer =
      typeof data === "string"
        ? new TextEncoder().encode(data).buffer
        : data.buffer ??
          (data.arrayBuffer ? (type ??= await data.arrayBuffer()) : data);

    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error(`Could not convert "${name}"'s data to an ArrayBuffer.`);
    }
    const nameBuffer = new TextEncoder().encode(name);
    chunks.push(new Uint16Array([nameBuffer.byteLength]));
    chunks.push(name);
    const typeBuffer = new TextEncoder().encode(type);
    chunks.push(new Uint16Array([typeBuffer.byteLength]));
    chunks.push(typeBuffer);
    offset += buffer.byteLength;
    chunks.push(new Uint32Array([buffer.byteLength]));
    chunks.push(buffer);
    const hash = await crypto.subtle.digest("sha-1", buffer);
    if (hash.byteLength !== 20) {
      throw new Error("Hash is not 20 bytes long");
    }
    chunks.push(hash);
  }
  return new Blob([HEAD, ...chunks], { type: "application/asset-bundle" });
}

// READING
export async function* decodeAssetBundleStream(
  input: AssetBundleDecodeInput,
  options: { verify?: boolean } = {}
): AsyncGenerator<AssetBundleOutput, undefined> {
  const stream =
    input instanceof ReadableStream
      ? input
      : ("stream" in (input as Blob)
          ? (input as Blob)
          : new Blob([input as any])
        ).stream();

  const verify = options.verify ?? true;

  const reader = stream.getReader();

  let chunk = 0;
  let cursor = 0;

  let firstRead = await reader.read();
  if (firstRead.done) {
    throw new Error("Unexpected end of file while reading AssetBundle");
  }
  const chunks: Uint8Array[] = [firstRead.value];

  let running = true;

  async function readBytes(n: number, blobType: string): Promise<Blob>;
  async function readBytes(n: number, blobType: false): Promise<ArrayBuffer>;
  async function readBytes(n: number, blobType: any) {
    const startChunk = chunk;
    const startCursor = cursor;

    let bytes = 0;
    while (bytes < n) {
      if (chunk >= chunks.length) {
        const read = await reader.read();
        if (read.done) {
          throw new Error("Unexpected end of file while reading AssetBundle");
        }
        chunks.push(read.value);
      }
      const chunkBytes = chunks[chunk].byteLength - cursor;
      if (chunkBytes + bytes > n) {
        cursor += n - bytes;
        bytes = n;
      } else {
        bytes += chunkBytes;
        chunk++;
        cursor = 0;
      }
    }

    if (startChunk === chunk) {
      const arrayBuffer = chunks[startChunk].slice(startCursor, cursor).buffer;
      return blobType
        ? new Blob([arrayBuffer], { type: blobType })
        : arrayBuffer;
    } else if (startChunk === chunk - 1 && cursor === 0) {
      const arrayBuffer = chunks[startChunk].slice(startCursor).buffer;
      return blobType
        ? new Blob([arrayBuffer], { type: blobType })
        : arrayBuffer;
    } else {
      const blob = new Blob(
        startChunk === chunk
          ? [chunks[startChunk].slice(startCursor, cursor)]
          : [
              chunks[startChunk].slice(startCursor),
              ...chunks.slice(startChunk + 1, chunk),
              chunks[chunk].slice(0, cursor),
            ],
        { type: blobType }
      );
      return blobType ? blob : blob.arrayBuffer();
    }
  }

  async function maybeReadMore() {
    if (cursor === 0 && chunk >= chunks.length) {
      const read = await reader.read();
      if (read.done) {
        running = false;
        return;
      }
      chunks.push(read.value);
      chunk++;
      cursor = 0;
    }
  }

  const head = await readBytes(7, false);

  const headDV = new Uint8Array(head, 0, 7);
  if (!HEAD.every((v, i) => headDV[i] === v)) {
    throw new Error("Invalid AssetBundle header");
  }

  while (running) {
    const nameLength = new Uint16Array(await readBytes(2, false))[0];
    const name = td.decode(await readBytes(nameLength, false));
    const typeLength = new Uint16Array(await readBytes(2, false))[0];
    const type =
      typeLength === 0
        ? "application/octet-stream"
        : td.decode(await readBytes(typeLength, false));
    const size = new Uint32Array(await readBytes(4, false))[0];
    const data = await readBytes(size, type);
    const hash = await readBytes(20, false);
    if (verify) {
      const hashU8 = new Uint8Array(hash);
      const hash2 = new Uint8Array(
        await crypto.subtle.digest("sha-1", await data.arrayBuffer())
      );
      if (!hashU8.every((v, i) => hash2[i] === v)) {
        throw new Error(`Hash mismatch for ${name}`);
      }
    }

    yield { name, data };
    await maybeReadMore();
  }
}

export async function decodeAssetBundle(
  buffer: Buffer | ArrayBuffer | BlobPart | Blob | ReadableStream<Uint8Array>
) {
  const map = new Map<string, Blob>();
  for await (const file of decodeAssetBundleStream(buffer)) {
    map.set(file.name, file.data);
  }
  return map;
}
