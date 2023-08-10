# @paperdave/asset-bundle

Minimal archive format designed for browser use. Used to bundle and serve image resources for [Scale of the Universe](https://scaleofuniverse.com). Asset Buffers are not intended for large payloads, but rather embedding many small ones. The API allows easy streaming from `fetch` or wherever.

```sh
# install package locally
bun add @paperdave/asset-bundle
npm install @paperdave/asset-bundle

# globally install `abundle` cli
bun add -g @paperdave/asset-bundle
```

```ts
import {
  encodeAssetBundle,
  decodeAssetBundleStream,
  decodeAssetBundle,
} from '@paperdave/asset-bundle';

const encoded = await encodeAssetBundle([
  // data accepts any Buffer/Blob/Stream/string/
  { name: 'hello.txt', data: "world" },
  { name: 'something.png', data: Bun.file("./local.png") },
]);
// -> Blob { type: "application/asset-bundle" }

for (const { name, data } = decodeAssetBundleStream(encoded)) {
  // { name: string, data: Blob }
  console.log({ name, size: data.size });
}

const map = await decodeAssetBundle(encoded);
// -> Map<string, Blob>
```

Decoding supports streams, and in that case will allow you to iterate over partial files. This isnt fully streamed, as each file that is emit is emitted once the entire file has been loaded.

Tree-shaking should also allow you to only include the decoding code if you are writing a web frontend that only consumes bundles.

## CLI

There is a CLI for the bundler which depends on the [Bun runtime](https://bun.sh).

```
abundle: create and read asset bundles

- abundle pack <inputs...> <bundle>
- abundle unpack <bundle> <outdir>
- abundle ls <bundle>
- abundle read <bundle> <file> [output = stdout]
- abundle verify <bundle>
```

## File Format

The format is extremely trivial:

- `u8[7]` Start with these bytes "BUNDLE1"
- For each file
  - `u16` with byteLength of the following field:
  - `u8[...]` with file name
  - `u16` with byteLength of the following field:
  - `u8[...]` with file type
  - `u32` size of asset
  - `u8[...]` Buffer, no compression or processing
  - `u8[20]` SHA-1 hash of this file
  - repeat
